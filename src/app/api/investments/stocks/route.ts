import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fetchStockQuote } from "@/lib/market-data";
import { recomputeHoldingFromLots } from "@/lib/stocks";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { createStockSchema } from "@/lib/schemas";

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

  // Buying the same stock again (same ticker/exchange/currency) merges into
  // the existing position as a new lot instead of creating a duplicate row —
  // quantity sums and avgBuyPrice becomes the quantity-weighted average.
  const existing = await db.stockHolding.findFirst({
    where: { userId: session.userId, ticker: tickerUpper, exchange: exchangeNormalized, currency },
  });

  if (existing) {
    await db.stockPurchaseLot.create({
      data: { stockHoldingId: existing.id, quantity: quantityNum, price: priceNum, purchaseDate: purchaseDateVal },
    });
    const holding = await recomputeHoldingFromLots(existing.id);
    return NextResponse.json({ holding, merged: true });
  }

  // Best-effort — an unreachable price feed shouldn't block adding the holding.
  const quote = await fetchStockQuote(tickerUpper);

  const holding = await db.stockHolding.create({
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
  });
  await db.stockPurchaseLot.create({
    data: { stockHoldingId: holding.id, quantity: quantityNum, price: priceNum, purchaseDate: purchaseDateVal },
  });

  const withLots = await db.stockHolding.findUnique({ where: { id: holding.id }, include: { lots: true } });
  return NextResponse.json({ holding: withLots }, { status: 201 });
}
