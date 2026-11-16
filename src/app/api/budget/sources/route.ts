import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { budgetSourceSchema } from "@/lib/schemas";
import { ensureMonthPlan } from "@/lib/budget";
import { setSource } from "@/lib/budget-funding";

export const dynamic = "force-dynamic";

/** Adds money to a month's budget: an income occurrence (everything left of
 * it, or `amount`) or part of an account's balance. Planning only: no
 * transaction is created and no balance changes. */
export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, budgetSourceSchema);
  await ensureMonthPlan(userId, input.month);
  const ref = "receivable" in input ? { receivable: input.receivable } : { accountId: input.accountId };
  const source = await setSource(userId, input.month, ref, input.amount);
  return Response.json({ source }, { status: 201 });
});
