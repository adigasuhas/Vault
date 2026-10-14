import { authed } from "@/lib/api";
import { cashBalances, undoMove } from "@/lib/investment-cash";

export const dynamic = "force-dynamic";

/** Undoes a move between an account and investment cash (both sides). */
export const POST = authed<{ id: string }>(async (_req, { userId, params }) => {
  const reversal = await undoMove(userId, params.id);
  return { reversal, balances: await cashBalances(userId) };
});
