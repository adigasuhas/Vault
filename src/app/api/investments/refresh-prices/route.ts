import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fetchStockQuote, fetchMutualFundNav, type StockQuote } from "@/lib/market-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** User-triggered price refresh for the current user's stocks and mutual
 * funds only — lets a user get live prices on demand instead of waiting for
 * the scheduled `/api/cron/market-update` run (which only fires on Vercel). */
export async function POST() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let stocksUpdated = 0;
  let stocksFailed = 0;

  const stocks = await db.stockHolding.findMany({
    where: { userId: session.userId },
    select: { id: true, ticker: true },
  });
  const quoteCache = new Map<string, StockQuote | null>();
  for (const holding of stocks) {
    if (!quoteCache.has(holding.ticker)) {
      quoteCache.set(holding.ticker, await fetchStockQuote(holding.ticker));
    }
    const quote = quoteCache.get(holding.ticker);
    if (quote != null) {
      await db.stockHolding.update({
        where: { id: holding.id },
        data: { lastPrice: quote.price, lastPriceAt: new Date(), previousClose: quote.previousClose },
      });
      stocksUpdated++;
    } else {
      stocksFailed++;
    }
  }

  let fundsUpdated = 0;
  let fundsFailed = 0;

  const funds = await db.mutualFundHolding.findMany({
    where: { userId: session.userId, schemeCode: { not: null } },
    select: { id: true, schemeCode: true },
  });
  const navCache = new Map<string, number | null>();
  for (const fund of funds) {
    const code = fund.schemeCode as string;
    if (!navCache.has(code)) {
      navCache.set(code, await fetchMutualFundNav(code));
    }
    const nav = navCache.get(code);
    if (nav != null) {
      await db.mutualFundHolding.update({ where: { id: fund.id }, data: { lastNav: nav, lastNavAt: new Date() } });
      fundsUpdated++;
    } else {
      fundsFailed++;
    }
  }

  return NextResponse.json({ stocksUpdated, stocksFailed, fundsUpdated, fundsFailed });
}
