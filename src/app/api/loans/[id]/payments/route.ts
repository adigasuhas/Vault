import { z } from "zod";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { recordLoanPayment, type Tx } from "@/lib/ledger";
import { parseJson, zPositive, zId, zIsoDate } from "@/lib/validate";
import { payNextLoanEmi, syncLoanSchedule, userToday } from "@/lib/schedules";

export const dynamic = "force-dynamic";

const schema = z.object({
  amount: zPositive,
  paidOn: zIsoDate.optional(),
  fromAccountId: zId.optional(),
  note: z.string().trim().max(300).optional(),
  /** EMI: an installment. PREPAYMENT: extra towards principal; later EMIs are re-planned. */
  kind: z.enum(["EMI", "PREPAYMENT"]).default("EMI"),
});

/** Records a loan payment by hand: an installment (e.g. from before the EMI
 * schedule existed) or an extra payment towards principal. The loan's
 * remaining plan and EMI schedule follow. */
export const POST = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, schema);
  const paidOn = input.paidOn ?? (await userToday(userId));
  // An EMI paid from an account on a scheduled loan settles the schedule's
  // next EMI (a due one first), so it can't be asked for — and paid — again.
  if (input.kind === "EMI" && input.fromAccountId) {
    const live = await db.scheduledCredit.findFirst({ where: { loanId: params.id, isActive: true }, select: { id: true } });
    if (live) {
      const r = await payNextLoanEmi(userId, { loanId: params.id, amount: input.amount, date: paidOn, accountId: input.fromAccountId });
      return Response.json({ settledScheduledEmi: true, paidCount: r.paidCount }, { status: 201 });
    }
  }
  const payment = await db.$transaction(async (tx: Tx) => {
    const p = await recordLoanPayment(
      userId,
      { loanId: params.id, amount: input.amount, paidOn, fromAccountId: input.fromAccountId, note: input.note, kind: input.kind },
      tx
    );
    await syncLoanSchedule(tx, userId, params.id);
    return p;
  });
  return Response.json({ payment }, { status: 201 });
});
