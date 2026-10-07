import { ValidationError, roundMoney } from "@/lib/validate";
import { dateOnly } from "@/lib/dates";

/** Lot matching for sales. No database access, so the sell dialog can preview
 * exactly what the server will record. */

/** One purchase (or part of one) used up by a sale. */
export interface SoldLot {
  lotId: string | null;
  purchaseDate: string; // ISO
  quantity: number | null;
  price: number | null;
  cost: number;
}

export const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
export const EPS = 1e-9;

/** First in, first out: takes `quantity` from the oldest purchases made on or
 * before `soldOn`. Pure, so it is unit-tested directly. */
export function matchLotsFifo(
  lots: { id: string; quantity: number; price: number; purchaseDate: Date }[],
  quantity: number,
  soldOn: Date
): { used: SoldLot[]; remaining: { id: string; quantity: number }[]; held: number } {
  const eligible = lots
    .filter((l) => dateOnly(l.purchaseDate) <= dateOnly(soldOn))
    .sort((a, b) => a.purchaseDate.getTime() - b.purchaseDate.getTime());
  const held = r6(eligible.reduce((s, l) => s + l.quantity, 0));
  if (quantity > held + EPS) {
    throw new ValidationError(
      held > 0
        ? `You held ${held} on that date, so you can sell at most that many.`
        : "Nothing of this holding had been bought by that date."
    );
  }
  let left = quantity;
  const used: SoldLot[] = [];
  const remaining: { id: string; quantity: number }[] = [];
  for (const l of eligible) {
    if (left <= EPS) break;
    const take = Math.min(l.quantity, left);
    left = r6(left - take);
    used.push({ lotId: l.id, purchaseDate: l.purchaseDate.toISOString(), quantity: r6(take), price: l.price, cost: roundMoney(take * l.price) });
    remaining.push({ id: l.id, quantity: r6(l.quantity - take) });
  }
  return { used, remaining, held };
}

/** "45 days", "8 months", "2 years 3 months": how long something was held. */
export function heldFor(from: Date | string, to: Date | string): string {
  const a = new Date(from), b = new Date(to);
  const days = Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"}`;
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months--;
  const y = Math.floor(months / 12), m = months % 12;
  const ys = y ? `${y} ${y === 1 ? "year" : "years"}` : "";
  const ms = m ? `${m} ${m === 1 ? "month" : "months"}` : "";
  return [ys, ms].filter(Boolean).join(" ") || `${days} days`;
}
