import { NextRequest, NextResponse } from "next/server";
import { unfundPurchase } from "@/lib/investment-funding";
import { editStock } from "@/lib/stock-edit";
import { fetchStockQuote } from "@/lib/market-data";
import { unlinkHolding } from "@/lib/investment-categories";
import type { Tx } from "@/lib/ledger";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { patchStockSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Edits a stock: ticker, exchange, currency, its purchases and its
 * categories, all through lib/stock-edit. */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { id } = await context.params;

  const existing = await db.stockHolding.findFirst({
    where: { id, userId: session.userId },
    include: { lots: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let input;
  try {
    input = await parseJson(req, patchStockSchema);
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }

  // Shorthand for a holding that is one purchase: its quantity and price.
  let lots = input.lots;
  if (input.quantity !== undefined || input.avgBuyPrice !== undefined) {
    if (existing.lots.length > 1) {
      return NextResponse.json(
        { error: "This holding is made of several purchases. Open its details and edit the purchase you want to fix." },
        { status: 409 }
      );
    }
    if (existing.lots.length === 1) lots = [{ id: existing.lots[0].id, quantity: input.quantity, price: input.avgBuyPrice }, ...(lots ?? [])];
  }
  const categories = input.categoryIds !== undefined || input.newNames !== undefined ? { categoryIds: input.categoryIds, newNames: input.newNames } : undefined;

  try {
    const { holding, tickerChanged } = await db.$transaction((tx: Tx) =>
      editStock(tx, session.userId, id, { ticker: input.ticker, exchange: input.exchange, currency: input.currency, lots, categories })
    );
    // Best-effort price for a corrected ticker; a slow feed never blocks the edit.
    if (tickerChanged && holding) {
      const quote = await fetchStockQuote(holding.ticker).catch(() => null);
      if (quote) {
        const priced = await db.stockHolding.update({
          where: { id },
          data: { lastPrice: quote.price, lastPriceAt: new Date(), previousClose: quote.previousClose ?? null },
          include: { lots: { orderBy: { purchaseDate: "desc" } } },
        });
        return NextResponse.json({ holding: priced });
      }
    }
    return NextResponse.json({ holding });
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { id } = await context.params;

  const existing = await db.stockHolding.findFirst({ where: { id, userId: session.userId }, include: { lots: true } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Removing a holding entered by mistake gives back whatever paid for it.
  try {
    await db.$transaction(async (tx: Tx) => {
      for (const lot of existing.lots) await unfundPurchase(tx, session.userId, `STOCK_LOT:${lot.id}`, `${existing.ticker} purchase`);
      await unlinkHolding(tx, session.userId, "STOCK", id);
      await tx.stockHolding.delete({ where: { id } });
    });
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
  return NextResponse.json({ success: true });
}
