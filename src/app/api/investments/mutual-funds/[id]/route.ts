import { db } from "@/lib/db";
import { refundPurchase, unfundPurchase } from "@/lib/investment-funding";
import { unlinkHolding } from "@/lib/investment-categories";
import type { Tx } from "@/lib/ledger";
import { authed, notFound } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { patchFundSchema } from "@/lib/schemas";
import { recomputeFundFromLots } from "@/lib/funds";

export const dynamic = "force-dynamic";

/** Scheme code can always change; units/NAV only on a single-purchase fund
 * (otherwise edit the individual purchase). */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const existing = await db.mutualFundHolding.findFirst({ where: { id: params.id, userId }, include: { lots: true } });
  if (!existing) return notFound("Fund not found.");
  const input = await parseJson(req, patchFundSchema);
  if ((input.units !== undefined || input.avgNav !== undefined) && existing.lots.length > 1) {
    throw new ValidationError("This fund is made of several purchases. Open its details and edit the purchase you want to fix.");
  }
  const holding = await db.$transaction(async (tx: Tx) => {
    if (input.schemeCode !== undefined) await tx.mutualFundHolding.update({ where: { id: existing.id }, data: { schemeCode: input.schemeCode || null } });
    if ((input.units !== undefined || input.avgNav !== undefined) && existing.lots[0]) {
      const lot = await tx.mutualFundLot.update({
        where: { id: existing.lots[0].id },
        data: { ...(input.units !== undefined ? { units: input.units } : {}), ...(input.avgNav !== undefined ? { nav: input.avgNav } : {}) },
      });
      await refundPurchase(tx, userId, `FUND_LOT:${lot.id}`, { cost: Number(lot.units) * Number(lot.nav), currency: existing.currency, date: lot.purchaseDate, label: existing.fundName });
    }
    return recomputeFundFromLots(existing.id, tx);
  });
  return { holding };
});

export const DELETE = authed<{ id: string }>(async (_req, { userId, params }) => {
  const existing = await db.mutualFundHolding.findFirst({ where: { id: params.id, userId }, include: { lots: true } });
  if (!existing) return notFound("Fund not found.");
  // A fund added by mistake: whatever paid for its purchases goes back.
  await db.$transaction(async (tx: Tx) => {
    for (const lot of existing.lots) await unfundPurchase(tx, userId, `FUND_LOT:${lot.id}`, `${existing.fundName} purchase`);
    await unlinkHolding(tx, userId, "MUTUAL_FUND", existing.id);
    await tx.mutualFundHolding.delete({ where: { id: existing.id } });
  });
  return { ok: true };
});
