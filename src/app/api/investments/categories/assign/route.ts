import { z } from "zod";
import { authed } from "@/lib/api";
import { parseJson, zId } from "@/lib/validate";
import { setHoldingCategories } from "@/lib/investment-categories";

export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.enum(["STOCK", "MUTUAL_FUND", "FIXED_DEPOSIT", "OTHER"]),
  holdingId: zId,
  categoryIds: z.array(zId).max(50).optional(),
  /** New categories to create (or match by name) and assign. */
  newNames: z.array(z.string().max(80)).max(20).optional(),
  /** replace (default): exactly these. add: keep the ones it already has. */
  mode: z.enum(["replace", "add"]).optional(),
});

/** Sets which categories an investment is in. */
export const PUT = authed(async (req, { userId }) => {
  const input = await parseJson(req, schema);
  return { links: await setHoldingCategories(userId, input) };
});
