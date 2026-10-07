import { db } from "@/lib/db";
import { ValidationError } from "@/lib/validate";
import type { Tx } from "@/lib/ledger";

/** Recomputes a holding's aggregate quantity/avgBuyPrice/purchaseDate from
 * all of its purchase lots — the holding row is always a derived total, the
 * lots are the source of truth for individual purchases. Deletes the
 * holding if its last lot was just removed (a holding can't exist with zero
 * purchases behind it). */
export async function recomputeHoldingFromLots(stockHoldingId: string, client: Tx = db) {
  const lots = await client.stockPurchaseLot.findMany({ where: { stockHoldingId } });
  if (lots.length === 0) {
    await client.stockHolding.delete({ where: { id: stockHoldingId } });
    return null;
  }

  const totalQty = lots.reduce((s, l) => s + Number(l.quantity), 0);
  if (!(totalQty > 0)) {
    throw new ValidationError("A holding's total quantity across all purchases must be greater than zero.");
  }
  const weightedAvg = lots.reduce((s, l) => s + Number(l.quantity) * Number(l.price), 0) / totalQty;
  const earliestDate = lots.reduce((min, l) => (l.purchaseDate < min ? l.purchaseDate : min), lots[0].purchaseDate);

  return client.stockHolding.update({
    where: { id: stockHoldingId },
    data: { quantity: totalQty, avgBuyPrice: weightedAvg, purchaseDate: earliestDate },
    include: { lots: { orderBy: { purchaseDate: "desc" } } },
  });
}
