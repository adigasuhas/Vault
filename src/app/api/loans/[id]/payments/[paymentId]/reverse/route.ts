import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { reverseLoanPayment, type Tx } from "@/lib/ledger";
import { parseJson, ValidationError } from "@/lib/validate";
import { noteSchema } from "@/lib/schemas";
import { ensureRecurringLine, syncLoanSchedule } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** Reverses a loan payment (a mistake, or a payment that bounced). The money
 * goes back to the account through a REVERSAL entry, the loan owes it again,
 * and its remaining plan re-forms around it. */
export const POST = authed<{ id: string; paymentId: string }>(async (req, { userId, params }) => {
  const body = await parseJson(req, noteSchema).catch(() => ({ reason: undefined, note: undefined }));
  return db.$transaction(async (tx: Tx) => {
    const p = await reverseLoanPayment(tx, userId, params.paymentId, body.reason ?? body.note);
    if (p.loanId !== params.id) throw new ValidationError("That payment belongs to another loan.");
    const loan = await tx.loan.findUniqueOrThrow({ where: { id: p.loanId }, include: { schedule: true } });
    if (loan.schedule) {
      await syncLoanSchedule(tx, userId, loan.id);
    } else if (loan.categoryId && loan.status === "ACTIVE") {
      // An unscheduled loan carries its EMI as a recurring budget line again.
      await tx.category.update({ where: { id: loan.categoryId }, data: { isDefault: true, defaultAmount: loan.emiAmount } });
      await ensureRecurringLine(tx, userId, loan.categoryId);
    }
    return { ok: true };
  });
});
