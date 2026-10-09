import { z } from "zod";
import { authed } from "@/lib/api";
import { parseJson, zId } from "@/lib/validate";
import { applyLotCategories, setHoldingCategories } from "@/lib/investment-categories";
import { db } from "@/lib/db";
import type { Tx } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** STOCK_LOT: one stock purchase; holdingId is then the purchase's id. */
  kind: z.enum(["STOCK", "MUTUAL_FUND", "FIXED_DEPOSIT", "OTHER", "STOCK_LOT"]),
  holdingId: zId,
  categoryIds: z.array(zId).max(50).optional(),
  /** New categories to create (or match by name) and assign. */
  newNames: z.array(z.string().max(80)).max(20).optional(),
  /** replace (default): exactly these. add: keep the ones it already has. */
  mode: z.enum(["replace", "add"]).optional(),
});

/** Sets which categories an investment (or one stock purchase) is in. */
export const PUT = authed(async (req, { userId }) => {
  const { kind, holdingId, ...input } = await parseJson(req, schema);
  if (kind === "STOCK_LOT") return { links: await db.$transaction((tx: Tx) => applyLotCategories(tx, userId, holdingId, input)) };
  return { links: await setHoldingCategories(userId, { kind, holdingId, ...input }) };
});
