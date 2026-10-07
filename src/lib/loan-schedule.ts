import { loanAmortization } from "@/lib/loans";
import { createSchedule } from "@/lib/schedules";
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
  const rows = loanAmortization(loan);
  const paid = await tx.loanPayment.count({ where: { loanId: loan.id, reversedAt: null } });
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
      startDate: dateOnly(first.dueDate),
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
  // The schedule now carries the EMI into each month's budget.
  await tx.category.update({ where: { id: loan.categoryId }, data: { isDefault: false, defaultAmount: 0 } });
  await tx.loan.update({ where: { id: loan.id }, data: { linkedAccountId: input.accountId } });
  return schedule;
}
