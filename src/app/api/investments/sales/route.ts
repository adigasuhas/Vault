import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { createSaleSchema } from "@/lib/schemas";
import { listSales, proceedsLeft, recordSale } from "@/lib/investment-sales";

export const dynamic = "force-dynamic";

/** Every sale and closure, newest first, including undone ones, each with
 * the proceeds still waiting to be reinvested. */
export const GET = authed(async (_req, { userId }) => ({
  sales: (await listSales(userId)).map((s) => ({ ...s, proceedsLeft: proceedsLeft(s) })),
}));

export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, createSaleSchema);
  const sale = await recordSale(userId, input);
  return Response.json({ sale }, { status: 201 });
});
