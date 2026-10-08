import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { reinvestSchema } from "@/lib/schemas";
import { markReinvested } from "@/lib/investment-sales";

export const dynamic = "force-dynamic";

/** Records that some of a sale's kept proceeds went into another investment. */
export const POST = authed<{ id: string }>(async (req, { userId, params }) => {
  const input = await parseJson(req, reinvestSchema);
  return { sale: await markReinvested(userId, params.id, input) };
});
