import { z } from "zod";
import { authed } from "@/lib/api";
import { recordLoanPayment } from "@/lib/ledger";
import { parseJson, zPositive, zId, zIsoDate } from "@/lib/validate";
import { userToday } from "@/lib/schedules";

export const dynamic = "force-dynamic";

const schema = z.object({
  amount: zPositive,
  paidOn: zIsoDate.optional(),
  fromAccountId: zId.optional(),
  note: z.string().trim().max(300).optional(),
});

/** Records a loan payment by hand (e.g. an installment from before the EMI
 * schedule existed, or a prepayment). */
export const POST = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, schema);
  const payment = await recordLoanPayment(userId, {
    loanId: params.id,
    amount: input.amount,
    paidOn: input.paidOn ?? (await userToday(userId)),
    fromAccountId: input.fromAccountId,
    note: input.note,
  });
  return Response.json({ payment }, { status: 201 });
});
