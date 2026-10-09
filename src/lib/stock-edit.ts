import { ValidationError } from "@/lib/validate";
import { refundPurchase } from "@/lib/investment-funding";
import { applyHoldingCategories } from "@/lib/investment-categories";
import { recomputeHoldingFromLots } from "@/lib/stocks";
import type { Tx } from "@/lib/ledger";

/**
 * One edit of a stock holding, used by every way into editing a stock: what
 * it is (ticker, exchange, currency), each purchase (quantity, price, date)
 * and its categories, saved together or not at all.
 *
 * What a purchase cost and when stays editable (a typo fix): whatever paid
 * for it is re-booked at the new cost, and a purchase a sale has drawn on
 * can't be re-priced once paid for (see refundPurchase). How it was paid
 * isn't editable here — that's an entry in an account's history; delete the
 * purchase and add it again to change it. Recorded sales keep the details
 * they were made with.
 */
export interface StockEdit {
  ticker?: string;
  exchange?: string | null;
  currency?: string;
  lots?: { id: string; quantity?: number; price?: number; purchaseDate?: Date }[];
  /** Replaces the holding's categories when given. */
  categories?: { categoryIds?: string[]; newNames?: string[] };
}

export async function editStock(tx: Tx, userId: string, id: string, input: StockEdit) {
  const existing = await tx.stockHolding.findFirst({ where: { id, userId }, include: { lots: true } });
  if (!existing) throw new ValidationError("Stock not found.");

  const ticker = input.ticker !== undefined ? input.ticker.trim().toUpperCase() : existing.ticker;
  const exchange = input.exchange !== undefined ? input.exchange?.trim() || null : existing.exchange;
  const currency = input.currency ?? existing.currency;
  if (!ticker) throw new ValidationError("Enter the ticker.");
  const tickerChanged = ticker !== existing.ticker;
  const currencyChanged = currency !== existing.currency;

  if (tickerChanged || exchange !== existing.exchange || currencyChanged) {
    // The same stock is always one row; adding it again merges into it.
    const clash = await tx.stockHolding.findFirst({ where: { userId, ticker, exchange, currency, NOT: { id } }, select: { id: true } });
    if (clash) {
      throw new ValidationError(`You already hold ${ticker}${exchange ? ` on ${exchange}` : ""} in ${currency}. Edit that one, or delete this one and add its purchases there.`);
    }
  }

  if (currencyChanged) {
    const refs = existing.lots.map((l) => `STOCK_LOT:${l.id}`);
    const [paid, reinvested, sold] = await Promise.all([
      tx.ledgerEntry.count({ where: { userId, investmentRef: { in: refs }, type: "INVESTMENT_PURCHASE", reversedAt: null } }),
      refs.length ? tx.investmentSale.count({ where: { userId, OR: refs.map((ref) => ({ reinvestments: { array_contains: [{ ref }] } })) } }) : 0,
      tx.investmentSale.count({ where: { userId, kind: "STOCK", holdingId: id, reversedAt: null } }),
    ]);
    if (paid + reinvested > 0) {
      throw new ValidationError(`Its currency can't change: a purchase was paid for in ${existing.currency}. Delete that purchase and add it again in ${currency}.`);
    }
    if (sold > 0) throw new ValidationError(`Its currency can't change: it has sales recorded in ${existing.currency}.`);
  }

  for (const edit of input.lots ?? []) {
    const lot = existing.lots.find((l) => l.id === edit.id);
    if (!lot) throw new ValidationError("That purchase isn't part of this stock.");
    const next = {
      quantity: edit.quantity ?? Number(lot.quantity),
      price: edit.price ?? Number(lot.price),
      purchaseDate: edit.purchaseDate ?? lot.purchaseDate,
    };
    const same = next.quantity === Number(lot.quantity) && next.price === Number(lot.price) && next.purchaseDate.getTime() === lot.purchaseDate.getTime();
    if (same) continue;
    await tx.stockPurchaseLot.update({ where: { id: lot.id }, data: next });
    // Whatever paid for it is re-booked at the corrected cost.
    await refundPurchase(tx, userId, `STOCK_LOT:${lot.id}`, { cost: next.quantity * next.price, currency, date: next.purchaseDate, label: `${next.quantity} ${ticker}` });
  }

  await tx.stockHolding.update({
    where: { id },
    data: {
      ticker,
      exchange,
      currency,
      // A different stock: the old one's price no longer applies.
      ...(tickerChanged ? { lastPrice: null, lastPriceAt: null, previousClose: null } : {}),
    },
  });
  await recomputeHoldingFromLots(id, tx);

  if (input.categories) {
    await applyHoldingCategories(tx, userId, { kind: "STOCK", holdingId: id, ...input.categories, mode: "replace" });
  }
  return { holding: await tx.stockHolding.findUnique({ where: { id }, include: { lots: { orderBy: { purchaseDate: "desc" } } } }), tickerChanged };
}
