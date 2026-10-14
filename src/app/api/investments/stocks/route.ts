import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fetchStockQuote } from "@/lib/market-data";
import { recomputeHoldingFromLots } from "@/lib/stocks";
import { parseJson, toErrorResponse } from "@/lib/validate";
import { createStockSchema } from "@/lib/schemas";
import { fundPurchase, fundingFrom, priceWithCharges } from "@/lib/investment-funding";
import { claimRequest, lostRace, requestSeen, settleRequest } from "@/lib/request-keys";
import { roundMoney } from "@/lib/validate";
import { applyHoldingCategories, applyLotCategories } from "@/lib/investment-categories";
import { checkPriceAlerts, setStockAlerts } from "@/lib/price-alerts";
import type { Tx } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const holdings = await db.stockHolding.findMany({
    where: { userId: session.userId },
    include: {
      lots: { orderBy: { purchaseDate: "desc" } },
      priceAlerts: { select: { id: true, categoryId: true, lotId: true, targetPrice: true, stopLossPrice: true, targetArmed: true, stopArmed: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  // How each purchase was paid, and whether a stock has sales: the edit form
  // shows the first and uses both to say what can safely change.
  const refs = holdings.flatMap((h) => h.lots.map((l) => `STOCK_LOT:${l.id}`));
  const [paid, fromCash, sold] = await Promise.all([
    db.ledgerEntry.findMany({
      where: { userId: session.userId, investmentRef: { in: refs }, type: "INVESTMENT_PURCHASE", reversedAt: null },
      select: { investmentRef: true, amount: true, currency: true, account: { select: { name: true } } },
    }),
    db.investmentCashEntry.findMany({
      where: { userId: session.userId, investmentRef: { in: refs }, type: "PURCHASE", reversedAt: null },
      select: { investmentRef: true, amount: true, currency: true },
    }),
    db.investmentSale.groupBy({ by: ["holdingId"], where: { userId: session.userId, kind: "STOCK", reversedAt: null }, _count: true }),
  ]);
  // Each funded purchase: the account part, the investment cash part, or both.
  type PaidFrom = { kind: "ACCOUNT" | "CASH" | "MIXED"; name: string; amount?: string; currency?: string; cash?: string };
  const paidFrom = new Map<string, PaidFrom>();
  for (const e of paid) if (e.investmentRef) paidFrom.set(e.investmentRef, { kind: "ACCOUNT", name: e.account?.name ?? "an account", amount: e.amount.toString(), currency: e.currency });
  for (const c of fromCash) {
    if (!c.investmentRef) continue;
    const prev = paidFrom.get(c.investmentRef);
    paidFrom.set(c.investmentRef, prev ? { ...prev, kind: "MIXED", cash: c.amount.toString() } : { kind: "CASH", name: "Investment cash", cash: c.amount.toString(), currency: c.currency });
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
  const replay = await requestSeen(session.userId, input.idempotencyKey);
  if (replay) return NextResponse.json({ duplicate: true, lotId: replay.resultId }, { status: 200 });
  const { quantity: quantityNum, currency } = input;
  // Charges become part of each share's cost, so profit and averages include them.
  const priceNum = priceWithCharges(quantityNum, input.price, input.charges);
  const total = roundMoney(quantityNum * input.price + (input.charges ?? 0));
  const tickerUpper = input.ticker.toUpperCase();
  const exchangeNormalized = input.exchange || null;
  const purchaseDateVal = input.purchaseDate;

  const existing = await db.stockHolding.findFirst({
    where: { userId: session.userId, ticker: tickerUpper, exchange: exchangeNormalized, currency },
  });
  // Best-effort — an unreachable price feed shouldn't block adding the holding.
  const quote = existing ? null : await fetchStockQuote(tickerUpper);
  const funding = fundingFrom(input);

  try {
    const result = await db.$transaction(async (tx: Tx) => {
      await claimRequest(tx, session.userId, input.idempotencyKey, "STOCK_PURCHASE");
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
      await fundPurchase(tx, session.userId, `STOCK_LOT:${lot.id}`, { cost: total, currency, date: purchaseDateVal, label: `${quantityNum} ${tickerUpper}` }, funding);
      await settleRequest(tx, session.userId, input.idempotencyKey, lot.id);
      await recomputeHoldingFromLots(holdingId, tx);
      const cats = { categoryIds: input.categoryIds, newNames: input.newNames, mode: "add" as const };
      if (input.categoryIds?.length || input.newNames?.length) {
        if (input.categoryScope === "STOCK") await applyHoldingCategories(tx, session.userId, { kind: "STOCK", holdingId, ...cats });
        else await applyLotCategories(tx, session.userId, lot.id, cats);
      }
      if (input.targetPrice != null || input.stopLossPrice != null) {
        // For one client's purchase, the thresholds are that purchase's; otherwise the stock's.
        const forPurchase = input.categoryScope === "PURCHASE" && !!(input.categoryIds?.length || input.newNames?.length);
        const current = await tx.stockPriceAlert.findMany({ where: { stockHoldingId: holdingId, userId: session.userId } });
        const keep = current
          .filter((a) => (forPurchase ? true : a.categoryId || a.lotId))
          .map((a) => ({ scope: (a.lotId ? "LOT" : a.categoryId ? "CATEGORY" : "STOCK") as "LOT" | "CATEGORY" | "STOCK", categoryId: a.categoryId, lotId: a.lotId, targetPrice: a.targetPrice != null ? Number(a.targetPrice) : null, stopLossPrice: a.stopLossPrice != null ? Number(a.stopLossPrice) : null }));
        await setStockAlerts(tx, session.userId, holdingId, [
          ...keep,
          { scope: forPurchase ? "LOT" : "STOCK", lotId: forPurchase ? lot.id : null, targetPrice: input.targetPrice ?? null, stopLossPrice: input.stopLossPrice ?? null },
        ]);
      }
      return { holding: await tx.stockHolding.findUnique({ where: { id: holdingId }, include: { lots: true } }), lotId: lot.id };
    });
    if (input.targetPrice != null || input.stopLossPrice != null) await checkPriceAlerts({ stockHoldingIds: [result.holding!.id] }).catch(() => {});
    return NextResponse.json({ holding: result.holding, lotId: result.lotId, merged: !!existing }, { status: existing ? 200 : 201 });
  } catch (err) {
    const won = await lostRace(err, session.userId, input.idempotencyKey);
    if (won) return NextResponse.json({ duplicate: true, lotId: won.resultId }, { status: 200 });
    const { body: errBody, status } = toErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
