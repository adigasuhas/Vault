import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { createSaleSchema } from "@/lib/schemas";
import { listSales, recordSale } from "@/lib/investment-sales";

export const dynamic = "force-dynamic";

/** Every sale and closure, newest first, including undone ones. */
export const GET = authed(async (_req, { userId }) => ({ sales: await listSales(userId) }));

export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, createSaleSchema);
  const { sale, replay } = await recordSale(userId, input);
  return Response.json({ sale, duplicate: replay }, { status: replay ? 200 : 201 });
});
