import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fetchStockQuote } from "@/lib/market-data";
import { recomputeHoldingFromLots } from "@/lib/stocks";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { createStockSchema } from "@/lib/schemas";
import { fundPurchase } from "@/lib/investment-funding";
import { applyHoldingCategories, applyLotCategories } from "@/lib/investment-categories";
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
  // How each purchase was paid, and whether a stock has sales: the edit form
  // shows the first and uses both to say what can safely change.
  const refs = holdings.flatMap((h) => h.lots.map((l) => `STOCK_LOT:${l.id}`));
  const [paid, reinvesting, sold] = await Promise.all([
    db.ledgerEntry.findMany({
      where: { userId: session.userId, investmentRef: { in: refs }, type: "INVESTMENT_PURCHASE", reversedAt: null },
      select: { investmentRef: true, amount: true, currency: true, account: { select: { name: true } } },
    }),
    db.investmentSale.findMany({ where: { userId: session.userId, NOT: { reinvestments: { equals: [] } } }, select: { name: true, reinvestments: true } }),
    db.investmentSale.groupBy({ by: ["holdingId"], where: { userId: session.userId, kind: "STOCK", reversedAt: null }, _count: true }),
  ]);
  const paidFrom = new Map<string, { kind: "ACCOUNT" | "SALE"; name: string; amount?: string; currency?: string }>();
  for (const e of paid) if (e.investmentRef) paidFrom.set(e.investmentRef, { kind: "ACCOUNT", name: e.account?.name ?? "an account", amount: e.amount.toString(), currency: e.currency });
  for (const sale of reinvesting) {
    for (const r of (sale.reinvestments as { ref?: string }[] | null) ?? []) if (r.ref) paidFrom.set(r.ref, { kind: "SALE", name: sale.name });
  }
  const sales = new Map(sold.map((g) => [g.holdingId, g._count]));
  return NextResponse.json({
    holdings: holdings.map((h) => ({
      ...h,
      saleCount: sales.get(h.id) ?? 0,
      lots: h.lots.map((l) => ({ ...l, paidFrom: paidFrom.get(`STOCK_LOT:${l.id}`) ?? null })),
    })),
  });
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
      const cats = { categoryIds: input.categoryIds, newNames: input.newNames, mode: "add" as const };
      if (input.categoryIds?.length || input.newNames?.length) {
        if (input.categoryScope === "STOCK") await applyHoldingCategories(tx, session.userId, { kind: "STOCK", holdingId, ...cats });
        else await applyLotCategories(tx, session.userId, lot.id, cats);
      }
      return { holding: await tx.stockHolding.findUnique({ where: { id: holdingId }, include: { lots: true } }), lotId: lot.id };
    });
    return NextResponse.json({ holding: result.holding, lotId: result.lotId, merged: !!existing }, { status: existing ? 200 : 201 });
  } catch (err) {
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
