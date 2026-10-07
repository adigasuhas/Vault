import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { loanAmortization, loanProgress, resolveLoanTerms } from "@/lib/loans";
import { createEmiSchedule } from "@/lib/loan-schedule";
import { syncScheduledBudgets } from "@/lib/schedules";
import { dateOnly } from "@/lib/dates";
import { parseJson, ValidationError } from "@/lib/validate";
import { patchLoanSchema } from "@/lib/schemas";
import { audit, loanOutstanding, type Tx } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, { userId, params }) => {
  const loan = await db.loan.findFirst({
    where: { id: params.id, userId },
    include: {
      linkedAccount: { select: { id: true, name: true, currency: true } },
      category: { select: { id: true, name: true } },
      payments: { orderBy: { paidOn: "asc" } },
      schedule: { select: { id: true, isActive: true, requiresConfirmation: true, receivingAccountId: true, _count: { select: { executions: true } } } },
    },
  });
  if (!loan) return notFound("Loan not found.");
  const schedule = loanAmortization(loan);
  const progress = loanProgress(
    schedule,
    loan.payments
      .filter((p) => !p.reversedAt)
      .map((p) => ({ principalComponent: Number(p.principalComponent), interestComponent: Number(p.interestComponent), amount: Number(p.amount) }))
  );
  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  // Terms can be edited only while nothing has been paid or skipped.
  const termsLocked = loan.payments.length > 0 || (loan.schedule?._count.executions ?? 0) > 0;
  return { loan, schedule, progress, totalInterest, termsLocked };
});

/** `{ status }` closes (paid off / settled elsewhere) or re-opens: closing
 * ends the EMI schedule and stops the loan's budget line; history stays.
 * Otherwise edits the loan: the name and paid-from account any time; the
 * terms only while no EMI has been paid or skipped (the EMI schedule is
 * rebuilt to match). */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const existing = await db.loan.findFirst({
    where: { id: params.id, userId },
    include: { schedule: { include: { _count: { select: { executions: true } } } }, _count: { select: { payments: true } } },
  });
  if (!existing) return notFound("Loan not found.");
  const input = await parseJson(req, patchLoanSchema);
  if (input.status) {
    const { status } = input;
    // A loan with something still owed is closed by paying it off
    // (POST /api/loans/:id/payoff), not just marked closed.
    if (status === "CLOSED" && existing.status === "ACTIVE" && (await loanOutstanding(db, existing)) > 0.004) {
      throw new ValidationError("This loan still has money owed on it. Pay it off to close it.");
    }
    return db.$transaction(async (tx: Tx) => {
      if (status === "CLOSED") {
        if (existing.schedule?.isActive) {
          await tx.scheduledCredit.update({ where: { id: existing.schedule.id }, data: { isActive: false, cancelledAt: new Date() } });
        }
        if (existing.categoryId) await tx.category.update({ where: { id: existing.categoryId }, data: { isDefault: false, defaultAmount: 0 } });
      } else if (existing.categoryId && !existing.schedule) {
        await tx.category.update({ where: { id: existing.categoryId }, data: { isDefault: true, defaultAmount: existing.emiAmount } });
      }
      const loan = await tx.loan.update({ where: { id: existing.id }, data: { status } });
      if (existing.categoryId) await syncScheduledBudgets(tx, userId, [existing.categoryId]);
      await audit(tx, userId, "loan", existing.id, status === "CLOSED" ? "loan.close" : "loan.reopen", `${status === "CLOSED" ? "Closed" : "Re-opened"} loan ${existing.name}`);
      return { loan };
    });
  }

  const termsChanged =
    (input.principal !== undefined && input.principal !== Number(existing.principal)) ||
    (input.interestRate !== undefined && input.interestRate !== Number(existing.interestRate)) ||
    (input.installments !== undefined && input.installments !== existing.installments) ||
    (input.startDate !== undefined && dateOnly(input.startDate).getTime() !== dateOnly(existing.startDate).getTime()) ||
    (input.emiAmount !== undefined && (input.emiAmount === null || input.emiAmount !== Number(existing.emiAmount)));
  const history = existing._count.payments + (existing.schedule?._count.executions ?? 0);
  if (termsChanged && history > 0) {
    throw new ValidationError("This loan already has EMIs paid or skipped, so its amount, rate, months and EMI can't change. You can still rename it or change the account. To restructure it, close this loan and add a new one.");
  }
  if (termsChanged && existing.status === "CLOSED") throw new ValidationError("Re-open the loan before changing its terms.");
  const accountId = input.linkedAccountId ?? existing.linkedAccountId;
  if (input.linkedAccountId) {
    const account = await db.account.findFirst({ where: { id: input.linkedAccountId, userId, status: { not: "CLOSED" } } });
    if (!account) throw new ValidationError("Account not found.");
    if (account.currency !== existing.currency) throw new ValidationError(`The loan is in ${existing.currency}; ${account.name} is in ${account.currency}.`);
  }

  try {
    return await db.$transaction(async (tx: Tx) => {
      const data: Prisma.LoanUpdateInput = {};
      if (input.name && input.name !== existing.name) {
        data.name = input.name;
        const catName = `Loan: ${input.name}`;
        const clash = await tx.category.findFirst({ where: { userId, name: catName, NOT: { id: existing.categoryId ?? undefined } } });
        if (clash) {
          if (await tx.loan.findFirst({ where: { userId, categoryId: clash.id }, select: { id: true } })) {
            throw new ValidationError(`You already have a loan called ${input.name}.`);
          }
          // Left behind by a deleted loan of that name: move it out of the way.
          await tx.category.update({ where: { id: clash.id }, data: { name: `${catName} (deleted loan ${clash.id.slice(0, 4)})` } });
        }
        if (existing.categoryId) await tx.category.update({ where: { id: existing.categoryId }, data: { name: catName } });
        if (existing.schedule) await tx.scheduledCredit.update({ where: { id: existing.schedule.id }, data: { name: `${input.name} EMI` } });
      }
      if (input.linkedAccountId) data.linkedAccount = { connect: { id: input.linkedAccountId } };
      if (termsChanged) {
        const principal = input.principal ?? Number(existing.principal);
        const interestRate = input.interestRate ?? Number(existing.interestRate);
        const startDate = input.startDate ? dateOnly(input.startDate) : existing.startDate;
        const custom = input.emiAmount === undefined ? undefined : input.emiAmount;
        const terms = resolveLoanTerms({ principal, interestRate, installments: input.installments ?? existing.installments, startDate, emiAmount: custom });
        Object.assign(data, { principal, interestRate, startDate, emiAmount: terms.emiAmount, installments: terms.installments, endDate: terms.endDate });
      }
      let loan = await tx.loan.update({ where: { id: existing.id }, data });
      if (termsChanged) {
        if (existing.schedule) {
          // Nothing booked against it yet: rebuild it from the new terms.
          const requiresConfirmation = existing.schedule.requiresConfirmation;
          const wasActive = existing.schedule.isActive;
          await tx.scheduledCredit.delete({ where: { id: existing.schedule.id } });
          if (wasActive && accountId) await createEmiSchedule(tx, userId, loan, { accountId, requiresConfirmation });
        } else if (existing.categoryId && existing.status === "ACTIVE") {
          await tx.category.update({ where: { id: existing.categoryId }, data: { defaultAmount: loan.emiAmount } });
        }
      } else if (input.linkedAccountId && existing.schedule?.isActive) {
        await tx.scheduledCredit.update({ where: { id: existing.schedule.id }, data: { receivingAccountId: input.linkedAccountId } });
      }
      loan = await tx.loan.findUniqueOrThrow({ where: { id: existing.id } });
      // Coming months' budget lines follow the rebuilt (or renamed) EMI schedule.
      if (existing.categoryId) await syncScheduledBudgets(tx, userId, [existing.categoryId]);
      await audit(tx, userId, "loan", existing.id, "loan.edit", `Edited loan ${loan.name}`, {
        name: loan.name,
        principal: Number(loan.principal),
        rate: Number(loan.interestRate),
        installments: loan.installments,
        emi: Number(loan.emiAmount),
        termsChanged,
      });
      return { loan };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ValidationError("You already have a loan (or category) with this name.");
    }
    throw err;
  }
});

/** A loan with nothing paid on it can be deleted outright (its EMI schedule
 * and any EMIs merely waiting go with it); one with payments is closed by
 * paying it off instead. */
export const DELETE = authed<{ id: string }>(async (_req, { userId, params }) => {
  const existing = await db.loan.findFirst({
    where: { id: params.id, userId },
    include: {
      _count: { select: { payments: true } },
      schedule: { include: { _count: { select: { executions: { where: { status: { in: ["CONFIRMED", "REVERSED"] } } } } } } },
    },
  });
  if (!existing) return notFound("Loan not found.");
  if (existing._count.payments > 0 || (existing.schedule?._count.executions ?? 0) > 0) {
    throw new ValidationError("This loan has payments on record, so it can't be deleted. Pay it off to close it; the history stays.");
  }
  return db.$transaction(async (tx: Tx) => {
    if (existing.schedule) await tx.scheduledCredit.delete({ where: { id: existing.schedule.id } });
    if (existing.categoryId) await tx.category.update({ where: { id: existing.categoryId }, data: { isDefault: false, defaultAmount: 0 } });
    await tx.loan.delete({ where: { id: existing.id } });
    if (existing.categoryId) await syncScheduledBudgets(tx, userId, [existing.categoryId]);
    await audit(tx, userId, "loan", existing.id, "loan.delete", `Deleted loan ${existing.name} (no payments)`);
    return { ok: true };
  });
});
