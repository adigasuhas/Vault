import { z } from "zod";
import { refundPurchase, unfundPurchase } from "@/lib/investment-funding";
import { unlinkHolding } from "@/lib/investment-categories";
import type { Tx } from "@/lib/ledger";
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
  const holding = await db.$transaction(async (tx: Tx) => {
    const updated = await tx.mutualFundLot.update({ where: { id: lot.id }, data: input, include: { holding: true } });
    await refundPurchase(tx, userId, `FUND_LOT:${lot.id}`, { cost: Number(updated.units) * Number(updated.nav), currency: updated.holding.currency, date: updated.purchaseDate, label: updated.holding.fundName });
    return recomputeFundFromLots(params.id, tx);
  });
  return { holding };
});

/** Removes one purchase; the last one takes the fund with it. */
export const DELETE = authed<{ id: string; lotId: string }>(async (_req, { userId, params }) => {
  const lot = await ownedLot(userId, params.id, params.lotId);
  if (!lot) return notFound("Purchase not found.");
  const holding = await db.$transaction(async (tx: Tx) => {
    await unfundPurchase(tx, userId, `FUND_LOT:${lot.id}`, "Fund purchase");
    await tx.mutualFundLot.delete({ where: { id: lot.id } });
    const left = await recomputeFundFromLots(params.id, tx);
    if (left === null) await unlinkHolding(tx, userId, "MUTUAL_FUND", params.id);
    return left;
  });
  return { holding, holdingDeleted: holding === null };
});
