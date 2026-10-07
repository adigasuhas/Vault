import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchStockQuote, fetchMutualFundNav, type StockQuote } from "@/lib/market-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Runs up to 4x/day: refreshes StockHolding.lastPrice and MutualFundHolding.lastNav
 * across every user. Failures (holidays, delistings, provider outages) are logged
 * per-item rather than aborting the whole run — stale prices are left untouched. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let stocksUpdated = 0;
  let stocksFailed = 0;

  const tickers = await db.stockHolding.findMany({ select: { id: true, ticker: true } });
  const quoteCache = new Map<string, StockQuote | null>();
  for (const holding of tickers) {
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

  const funds = await db.mutualFundHolding.findMany({ where: { schemeCode: { not: null } }, select: { id: true, schemeCode: true } });
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

  const itemsUpdated = stocksUpdated + fundsUpdated;
  const itemsFailed = stocksFailed + fundsFailed;
  const status = itemsFailed === 0 ? "SUCCESS" : itemsUpdated === 0 ? "FAILED" : "PARTIAL";

  await db.priceUpdateLog.create({
    data: {
      source: "yahoo-finance2+amfi-nav",
      itemsUpdated,
      itemsFailed,
      status,
      message: `Stocks: ${stocksUpdated}/${tickers.length} updated. Funds: ${fundsUpdated}/${funds.length} updated.`,
    },
  });

  return NextResponse.json({ stocksUpdated, stocksFailed, fundsUpdated, fundsFailed, status });
}
