import { db } from "@/lib/db";
import { ValidationError } from "@/lib/validate";

/** Recomputes a fund's units / average NAV / first purchase date from its
 * purchases (the lots are the source of truth). Deletes the holding when its
 * last purchase is removed. */
export async function recomputeFundFromLots(holdingId: string) {
  const lots = await db.mutualFundLot.findMany({ where: { holdingId } });
  if (lots.length === 0) {
    await db.mutualFundHolding.delete({ where: { id: holdingId } });
    return null;
  }
  const units = lots.reduce((s, l) => s + Number(l.units), 0);
  if (!(units > 0)) throw new ValidationError("A fund's total units must be greater than zero.");
  const avgNav = lots.reduce((s, l) => s + Number(l.units) * Number(l.nav), 0) / units;
  const first = lots.reduce((m, l) => (l.purchaseDate < m ? l.purchaseDate : m), lots[0].purchaseDate);
  return db.mutualFundHolding.update({
    where: { id: holdingId },
    data: { units, avgNav, purchaseDate: first },
    include: { lots: { orderBy: { purchaseDate: "asc" } } },
  });
}
