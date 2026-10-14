import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { cashMoveSchema } from "@/lib/schemas";
import { addFromAccount, cashBalances, cashHistory, withdrawToAccount } from "@/lib/investment-cash";

export const dynamic = "force-dynamic";

/** Investment cash balances (one per currency) and every movement, newest first. */
export const GET = authed(async (req, { userId }) => {
  const currency = req.nextUrl.searchParams.get("currency") || undefined;
  const [balances, history] = await Promise.all([cashBalances(userId), cashHistory(userId, { currency })]);
  return { balances, history };
});

/** Moves money between an account and investment cash: IN adds from the
 * account, OUT withdraws to it. A repeat with the same key changes nothing. */
export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, cashMoveSchema);
  const result =
    input.direction === "IN"
      ? await addFromAccount(userId, input)
      : await withdrawToAccount(userId, input);
  return Response.json({ ...result, balances: await cashBalances(userId) }, { status: result.duplicate ? 200 : 201 });
});
