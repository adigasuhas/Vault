import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fetchStockQuote } from "@/lib/market-data";
import { recomputeHoldingFromLots } from "@/lib/stocks";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { createStockSchema } from "@/lib/schemas";
import { fundPurchase } from "@/lib/investment-funding";
import type { Tx } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const holdings = await db.stockHolding.findMany({
    where: { userId: session.userId },
    include: { lots: { orderBy: { purchaseDate: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ holdings });
}

export async function POST(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let input;
  try {
    input = await parseJson(req, createStockSchema);
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
  const { quantity: quantityNum, price: priceNum, currency } = input;
  const tickerUpper = input.ticker.toUpperCase();
  const exchangeNormalized = input.exchange || null;
  const purchaseDateVal = input.purchaseDate;

  const existing = await db.stockHolding.findFirst({
    where: { userId: session.userId, ticker: tickerUpper, exchange: exchangeNormalized, currency },
  });
  // Best-effort — an unreachable price feed shouldn't block adding the holding.
  const quote = existing ? null : await fetchStockQuote(tickerUpper);
  const funding = { paidFromAccountId: input.paidFromAccountId, budgetCategoryId: input.budgetCategoryId, fromSaleId: input.fromSaleId, paidAmount: input.paidAmount };

  try {
    const result = await db.$transaction(async (tx: Tx) => {
      // Buying the same stock again (same ticker/exchange/currency) merges into
      // the existing position as a new lot instead of creating a duplicate row —
      // quantity sums and avgBuyPrice becomes the quantity-weighted average.
      const holdingId =
        existing?.id ??
        (
          await tx.stockHolding.create({
            data: {
              userId: session.userId,
              ticker: tickerUpper,
              exchange: exchangeNormalized,
              quantity: quantityNum,
              avgBuyPrice: priceNum,
              currency,
              purchaseDate: purchaseDateVal,
              lastPrice: quote?.price ?? null,
              lastPriceAt: quote ? new Date() : null,
              previousClose: quote?.previousClose ?? null,
            },
          })
        ).id;
      const lot = await tx.stockPurchaseLot.create({
        data: { stockHoldingId: holdingId, quantity: quantityNum, price: priceNum, purchaseDate: purchaseDateVal },
      });
      await fundPurchase(tx, session.userId, `STOCK_LOT:${lot.id}`, { cost: quantityNum * priceNum, currency, date: purchaseDateVal, label: `${quantityNum} ${tickerUpper}` }, funding);
      await recomputeHoldingFromLots(holdingId, tx);
      return tx.stockHolding.findUnique({ where: { id: holdingId }, include: { lots: true } });
    });
    return NextResponse.json({ holding: result, merged: !!existing }, { status: existing ? 200 : 201 });
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
