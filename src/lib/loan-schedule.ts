import { loanAmortization } from "@/lib/loans";
import { createSchedule, loanScheduleDates, retireLoanBudget } from "@/lib/schedules";
import { db } from "@/lib/db";
import type { AmortizationRow } from "@/lib/loans";
import { ValidationError } from "@/lib/validate";
import type { Tx } from "@/lib/ledger";
import type { Loan } from "@prisma/client";
import { dateOnly, todayIn } from "@/lib/dates";

/** Creates the monthly EMI schedule for a loan: one occurrence per remaining
 * installment, paid from `accountId`, booked under the loan's category. The
 * final installment's amount is overridden to the schedule's exact last EMI
 * (it absorbs rounding). */
export async function createEmiSchedule(
  tx: Tx,
  userId: string,
  loan: Loan,
  input: { accountId: string; requiresConfirmation: boolean }
) {
  if (!loan.categoryId) throw new ValidationError("This loan has no budget category.");
  const live = await tx.loanPayment.findMany({ where: { loanId: loan.id, reversedAt: null } });
  const rows = loanAmortization(loan, live);
  const paid = live.filter((p) => p.kind !== "PREPAYMENT").length;
  // Installments already past are left for the user to record (or not) by
  // hand — the schedule only drives EMIs from today on.
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const today = todayIn(user.timezone || "UTC");
  const remaining = rows.slice(paid).filter((r) => dateOnly(r.dueDate) >= today);
  if (!remaining.length) throw new ValidationError("There are no installments left from today on. Record any remaining payments by hand.");
  const first = remaining[0];
  const last = remaining[remaining.length - 1];
  const schedule = await createSchedule(
    userId,
    {
      direction: "PAYMENT",
      kind: "EMI",
      name: `${loan.name} EMI`,
      amount: Math.round(first.emi * 100) / 100,
      accountId: input.accountId,
      categoryId: loan.categoryId,
      frequency: "MONTHLY",
      // Anchored on the loan's first EMI so the day of the month holds (a
      // 31st stays the 31st after February); processing starts at `first`.
      startDate: dateOnly(loan.startDate),
      firstDue: dateOnly(first.dueDate),
      endDate: dateOnly(last.dueDate),
      requiresConfirmation: input.requiresConfirmation,
      loanId: loan.id,
      overrides:
        Math.abs(last.emi - first.emi) > 0.005 && remaining.length > 1
          ? [{ occurrenceDate: dateOnly(last.dueDate), amount: Math.round(last.emi * 100) / 100 }]
          : [],
    },
    tx
  );
  // The schedule now carries the EMI into each month's budget; lines the
  // category stamped as a recurring EMI give way to it.
  await tx.category.update({ where: { id: loan.categoryId }, data: { isDefault: false, defaultAmount: 0 } });
  await retireLoanBudget(tx, userId, loan.categoryId);
  await tx.loan.update({ where: { id: loan.id }, data: { linkedAccountId: input.accountId } });
  return schedule;
}

/** The budget category for a loan named `name` ("Loan: <name>"). A category
 * left behind by a deleted loan of the same name is reused rather than
 * blocking the new one. */
export async function loanCategory(
  tx: Tx,
  userId: string,
  name: string,
  data: { isDefault: boolean; defaultAmount: number; defaultSince: string; defaultCurrency?: string }
) {
  const catName = `Loan: ${name}`;
  const existing = await tx.category.findFirst({ where: { userId, name: catName } });
  if (existing) {
    const owner = await tx.loan.findFirst({ where: { userId, categoryId: existing.id }, select: { id: true } });
    if (owner) throw new ValidationError(`You already have a loan called ${name}.`);
    return tx.category.update({ where: { id: existing.id }, data });
  }
  const max = await tx.category.aggregate({ where: { userId }, _max: { sortOrder: true } });
  return tx.category.create({ data: { userId, name: catName, ...data, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
}

/** The loan's plan with its remaining EMIs dated by its live EMI schedule,
 * so the loan page and Loans & payments agree on when each one is due (e.g.
 * when an early EMI was never scheduled, or a date was moved). */
export async function withScheduleDates(loanId: string, rows: AmortizationRow[], payments: { kind?: string | null }[]) {
  const paid = payments.filter((p) => p.kind !== "PREPAYMENT").length;
  const dates = await loanScheduleDates(db, loanId, rows.length - paid);
  if (!dates) return rows;
  return rows.map((r, i) => (i >= paid && dates[i - paid] ? { ...r, dueDate: dates[i - paid] } : r));
}
