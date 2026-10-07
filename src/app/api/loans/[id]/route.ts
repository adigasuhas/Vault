import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { amortizationSchedule, loanProgress } from "@/lib/loans";
import { parseJson, ValidationError } from "@/lib/validate";
import { patchLoanSchema } from "@/lib/schemas";
import { audit, type Tx } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, { userId, params }) => {
  const loan = await db.loan.findFirst({
    where: { id: params.id, userId },
    include: {
      linkedAccount: { select: { id: true, name: true, currency: true } },
      category: { select: { id: true, name: true } },
      payments: { orderBy: { paidOn: "asc" } },
      schedule: { select: { id: true, isActive: true, requiresConfirmation: true, receivingAccountId: true } },
    },
  });
  if (!loan) return notFound("Loan not found.");
  const schedule = amortizationSchedule(Number(loan.principal), Number(loan.interestRate), loan.installments, loan.startDate);
  const progress = loanProgress(
    schedule,
    loan.payments
      .filter((p) => !p.reversedAt)
      .map((p) => ({ principalComponent: Number(p.principalComponent), interestComponent: Number(p.interestComponent), amount: Number(p.amount) }))
  );
  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  return { loan, schedule, progress, totalInterest };
});

/** Close (paid off / settled elsewhere) or re-open. Closing ends the EMI
 * schedule and stops the loan's budget line; history stays. */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const existing = await db.loan.findFirst({ where: { id: params.id, userId }, include: { schedule: true } });
  if (!existing) return notFound("Loan not found.");
  const { status } = await parseJson(req, patchLoanSchema);
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
    await audit(tx, userId, "loan", existing.id, status === "CLOSED" ? "loan.close" : "loan.reopen", `${status === "CLOSED" ? "Closed" : "Re-opened"} loan ${existing.name}`);
    return { loan };
  });
});

/** Only a loan with no recorded payments can be deleted (a mistaken entry);
 * anything with history is closed instead. */
export const DELETE = authed<{ id: string }>(async (_req, { userId, params }) => {
  const existing = await db.loan.findFirst({
    where: { id: params.id, userId },
    include: { _count: { select: { payments: true } }, schedule: { include: { _count: { select: { executions: true } } } } },
  });
  if (!existing) return notFound("Loan not found.");
  if (existing._count.payments > 0 || (existing.schedule?._count.executions ?? 0) > 0) {
    throw new ValidationError("This loan has payments on record, so it can't be deleted. Close it instead and the history stays.");
  }
  return db.$transaction(async (tx: Tx) => {
    if (existing.schedule) await tx.scheduledCredit.delete({ where: { id: existing.schedule.id } });
    if (existing.categoryId) await tx.category.update({ where: { id: existing.categoryId }, data: { isDefault: false, defaultAmount: 0 } });
    await tx.loan.delete({ where: { id: existing.id } });
    await audit(tx, userId, "loan", existing.id, "loan.delete", `Deleted loan ${existing.name} (no payments)`);
    return { ok: true };
  });
});
