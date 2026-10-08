import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { creditProceedsSchema } from "@/lib/schemas";
import { creditProceeds } from "@/lib/investment-sales";

export const dynamic = "force-dynamic";

/** Moves what's left of a sale's kept proceeds into an account. */
export const POST = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, creditProceedsSchema);
  return { sale: await creditProceeds(userId, params.id, input) };
});
