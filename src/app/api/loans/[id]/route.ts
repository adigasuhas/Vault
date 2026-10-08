import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withScheduleDates } from "@/lib/loan-schedule";
import { authed, notFound } from "@/lib/api";
import { computeEmi, loanAmortization, loanProgress, resolveLoanTerms } from "@/lib/loans";
import { createEmiSchedule } from "@/lib/loan-schedule";
import { ensureRecurringLine, retireLoanBudget, runDueSchedules, syncLoanSchedule, syncScheduledBudgets } from "@/lib/schedules";
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
  const live = loan.payments.filter((p) => !p.reversedAt);
  const schedule = await withScheduleDates(loan.id, loanAmortization(loan, live), live);
  const progress = loanProgress(
    schedule,
    live.map((p) => ({ principalComponent: Number(p.principalComponent), interestComponent: Number(p.interestComponent), amount: Number(p.amount), kind: p.kind })),
    Number(loan.principal)
  );
  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  // Once something is paid, the amount borrowed and the first EMI date are
  // history; the EMI, rate and number of EMIs can still change (the rest of
  // the schedule is re-planned from what's owed).
  const termsLocked = live.length > 0;
  // Deleting is for loans with nothing paid (or every payment reversed); the
  // ledger keeps any reversed entries either way.
  const confirmed = loan.schedule ? await db.creditExecution.count({ where: { scheduledCreditId: loan.schedule.id, status: "CONFIRMED" } }) : 0;
  const deletable = live.length === 0 && confirmed === 0;
  return { loan, schedule, progress, totalInterest, termsLocked, deletable };
});

/** `{ status }` closes or re-opens. A loan still owed money is closed by
 * paying it off (POST /api/loans/:id/payoff); closing ends its EMI schedule
 * and its budget lines from this month on; history stays.
 *
 * Otherwise edits the loan. The name and paid-from account can change any
 * time. With nothing paid yet, every term can change and the EMI schedule is
 * rebuilt. Once EMIs are paid, the amount borrowed and the first EMI date are
 * history, but the EMI, rate and number of EMIs can still change: the rest of
 * the schedule is re-planned from what's actually owed, and paid EMIs stay
 * exactly as they were. */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const existing = await db.loan.findFirst({
    where: { id: params.id, userId },
    include: { schedule: true, payments: { where: { reversedAt: null } } },
  });
  if (!existing) return notFound("Loan not found.");
  const input = await parseJson(req, patchLoanSchema);
  if (input.status) {
    const { status } = input;
    if (status === "CLOSED" && existing.status === "ACTIVE" && (await loanOutstanding(db, existing)) > 0.004) {
      throw new ValidationError("This loan still has money owed on it. Pay it off to close it, or reverse its payments and delete it.");
    }
    return db.$transaction(async (tx: Tx) => {
      if (status === "CLOSED" && existing.schedule?.isActive) {
        await tx.scheduledCredit.update({ where: { id: existing.schedule.id }, data: { isActive: false, cancelledAt: new Date() } });
      }
      if (existing.categoryId) {
        const reopenAsRecurring = status === "ACTIVE" && !existing.schedule;
        await tx.category.update({
          where: { id: existing.categoryId },
          data: reopenAsRecurring ? { isDefault: true, defaultAmount: existing.emiAmount } : { isDefault: false, defaultAmount: 0 },
        });
        if (status === "CLOSED") await retireLoanBudget(tx, userId, existing.categoryId);
      }
      const loan = await tx.loan.update({ where: { id: existing.id }, data: { status } });
      await audit(tx, userId, "loan", existing.id, status === "CLOSED" ? "loan.close" : "loan.reopen", `${status === "CLOSED" ? "Closed" : "Re-opened"} loan ${existing.name}`);
      return { loan };
    });
  }

  const paid = existing.payments.length > 0;
  const changed = {
    principal: input.principal !== undefined && input.principal !== Number(existing.principal),
    startDate: input.startDate !== undefined && dateOnly(input.startDate).getTime() !== dateOnly(existing.startDate).getTime(),
    rate: input.interestRate !== undefined && input.interestRate !== Number(existing.interestRate),
    installments: input.installments !== undefined && input.installments !== existing.installments,
    emi: input.emiAmount !== undefined && (input.emiAmount === null || input.emiAmount !== Number(existing.emiAmount)),
  };
  const termsChanged = Object.values(changed).some(Boolean);
  if (paid && (changed.principal || changed.startDate)) {
    throw new ValidationError("EMIs have been paid on this loan, so the amount borrowed and the first EMI date can't change. You can change the EMI, interest rate or number of EMIs, make an extra payment, or reverse the payments first.");
  }
  if (termsChanged && existing.status === "CLOSED") throw new ValidationError("Re-open the loan before changing its terms.");
  const accountId = input.linkedAccountId ?? existing.linkedAccountId;
  if (input.linkedAccountId) {
    const account = await db.account.findFirst({ where: { id: input.linkedAccountId, userId, status: { not: "CLOSED" } } });
    if (!account) throw new ValidationError("Account not found.");
    if (account.currency !== existing.currency) throw new ValidationError(`The loan is in ${existing.currency}; ${account.name} is in ${account.currency}.`);
  }

  try {
    const result = await db.$transaction(async (tx: Tx) => {
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
      if (input.linkedAccountId) {
        data.linkedAccount = { connect: { id: input.linkedAccountId } };
        if (existing.schedule?.isActive) await tx.scheduledCredit.update({ where: { id: existing.schedule.id }, data: { receivingAccountId: input.linkedAccountId } });
      }

      if (termsChanged && !paid) {
        const principal = input.principal ?? Number(existing.principal);
        const interestRate = input.interestRate ?? Number(existing.interestRate);
        const startDate = input.startDate ? dateOnly(input.startDate) : existing.startDate;
        const terms = resolveLoanTerms({ principal, interestRate, installments: input.installments ?? existing.installments, startDate, emiAmount: input.emiAmount });
        Object.assign(data, { principal, interestRate, startDate, emiAmount: terms.emiAmount, installments: terms.installments, endDate: terms.endDate });
      } else if (termsChanged && paid) {
        // Re-plan the rest from what's owed now.
        const owed = await loanOutstanding(tx, existing);
        const paidEmis = existing.payments.filter((p) => p.kind !== "PREPAYMENT").length;
        const interestRate = input.interestRate ?? Number(existing.interestRate);
        const installments = input.installments ?? existing.installments;
        if (installments <= paidEmis) throw new ValidationError(`${paidEmis} EMIs are already paid, so the loan needs more than ${paidEmis} in total. To finish it now, pay it off.`);
        const remaining = installments - paidEmis;
        const emi = Math.round((input.emiAmount ?? computeEmi(owed, interestRate, remaining)) * 100) / 100;
        if (emi <= Math.round((owed * interestRate) / 1200 * 100) / 100) throw new ValidationError("The EMI has to be more than a month's interest on what's owed.");
        const rows = loanAmortization({ ...existing, interestRate, installments, emiAmount: emi }, existing.payments);
        Object.assign(data, { interestRate, emiAmount: emi, installments: rows.length, endDate: rows.length ? dateOnly(rows[rows.length - 1].dueDate) : existing.endDate });
      }

      let loan = await tx.loan.update({ where: { id: existing.id }, data });
      if (termsChanged && !paid) {
        if (existing.schedule) {
          // Nothing paid against it: rebuild it from the new terms.
          const { requiresConfirmation, isActive } = existing.schedule;
          await tx.scheduledCredit.delete({ where: { id: existing.schedule.id } });
          if (isActive && accountId) await createEmiSchedule(tx, userId, loan, { accountId, requiresConfirmation });
        } else if (existing.categoryId && existing.status === "ACTIVE") {
          await tx.category.update({ where: { id: existing.categoryId }, data: { defaultAmount: loan.emiAmount } });
          await retireLoanBudget(tx, userId, existing.categoryId);
          await ensureRecurringLine(tx, userId, existing.categoryId);
        }
      } else if (termsChanged && paid) {
        await syncLoanSchedule(tx, userId, existing.id);
        if (!existing.schedule && existing.categoryId && existing.status === "ACTIVE") {
          await tx.category.update({ where: { id: existing.categoryId }, data: { defaultAmount: loan.emiAmount } });
          await retireLoanBudget(tx, userId, existing.categoryId);
          await ensureRecurringLine(tx, userId, existing.categoryId);
        }
      }
      loan = await tx.loan.findUniqueOrThrow({ where: { id: existing.id } });
      if (existing.categoryId) await syncScheduledBudgets(tx, userId, [existing.categoryId]);
      await audit(tx, userId, "loan", existing.id, "loan.edit", `Edited loan ${loan.name}`, {
        name: loan.name,
        principal: Number(loan.principal),
        rate: Number(loan.interestRate),
        installments: loan.installments,
        emi: Number(loan.emiAmount),
        termsChanged,
        afterPayments: paid,
      });
      return { loan };
    });
    // A rebuilt schedule may have an EMI due today.
    if (termsChanged) await runDueSchedules(new Date(), userId);
    return result;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ValidationError("You already have a loan (or category) with this name.");
    }
    throw err;
  }
});

/** A loan with nothing paid on it (or every payment reversed) can be deleted:
 * its EMI schedule and any EMIs merely waiting go with it, its budget lines
 * from this month on are removed, and any reversed entries stay in the ledger.
 * One with payments standing is paid off, or modified, instead. */
export const DELETE = authed<{ id: string }>(async (_req, { userId, params }) => {
  const existing = await db.loan.findFirst({
    where: { id: params.id, userId },
    include: {
      _count: { select: { payments: { where: { reversedAt: null } } } },
      schedule: { include: { _count: { select: { executions: { where: { status: "CONFIRMED" } } } } } },
    },
  });
  if (!existing) return notFound("Loan not found.");
  if (existing._count.payments > 0 || (existing.schedule?._count.executions ?? 0) > 0) {
    throw new ValidationError("Payments on this loan are on record, so deleting it would erase them. Pay it off or change its terms instead, or reverse those payments first if they were mistakes.");
  }
  return db.$transaction(async (tx: Tx) => {
    if (existing.schedule) await tx.scheduledCredit.delete({ where: { id: existing.schedule.id } });
    await tx.loan.delete({ where: { id: existing.id } });
    if (existing.categoryId) await retireLoanBudget(tx, userId, existing.categoryId, { dropCategoryIfUnused: true });
    await audit(tx, userId, "loan", existing.id, "loan.delete", `Deleted loan ${existing.name} (nothing paid)`);
    return { ok: true };
  });
});
