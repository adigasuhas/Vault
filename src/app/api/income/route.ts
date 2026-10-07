import { z } from "zod";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { recordManualIncome, audit } from "@/lib/ledger";
import { parseJson, ValidationError, zId, zIsoDate, zPositive } from "@/lib/validate";
import { userToday } from "@/lib/schedules";

export const dynamic = "force-dynamic";

const schema = z.object({
  accountId: zId,
  amount: zPositive,
  date: zIsoDate.optional(),
  description: z.string().trim().min(1, "is required").max(200),
});

/** One-off money received that wasn't scheduled (a refund, a gift, prize money). */
export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, schema);
  const account = await db.account.findFirst({ where: { id: input.accountId, userId } });
  if (!account) throw new ValidationError("Account not found.");
  const entry = await recordManualIncome(userId, {
    accountId: account.id,
    amount: input.amount,
    currency: account.currency,
    date: input.date ?? (await userToday(userId)),
    description: input.description,
  });
  await db.$transaction((tx) => audit(tx, userId, "income", entry.id, "income.record", `Recorded ${input.description}`, { amount: input.amount }));
  return Response.json({ entry }, { status: 201 });
});
