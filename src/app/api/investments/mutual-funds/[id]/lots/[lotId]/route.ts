import { z } from "zod";
import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { parseJson, zIsoDate, zPositive, zNonNegative } from "@/lib/validate";
import { recomputeFundFromLots } from "@/lib/funds";

export const dynamic = "force-dynamic";

const schema = z.object({ units: zPositive.optional(), nav: zNonNegative.optional(), purchaseDate: zIsoDate.optional() });

async function ownedLot(userId: string, holdingId: string, lotId: string) {
  return db.mutualFundLot.findFirst({ where: { id: lotId, holdingId, holding: { userId } } });
}

/** Fixes one purchase; the fund's totals are recomputed. */
export const PATCH = authed<{ id: string; lotId: string }>(async (req, { userId, params }) => {
  const lot = await ownedLot(userId, params.id, params.lotId);
  if (!lot) return notFound("Purchase not found.");
  const input = await parseJson(req, schema);
  await db.mutualFundLot.update({ where: { id: lot.id }, data: input });
  return { holding: await recomputeFundFromLots(params.id) };
});

/** Removes one purchase; the last one takes the fund with it. */
export const DELETE = authed<{ id: string; lotId: string }>(async (_req, { userId, params }) => {
  const lot = await ownedLot(userId, params.id, params.lotId);
  if (!lot) return notFound("Purchase not found.");
  await db.mutualFundLot.delete({ where: { id: lot.id } });
  const holding = await recomputeFundFromLots(params.id);
  return { holding, holdingDeleted: holding === null };
});
