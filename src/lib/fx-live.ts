import { db } from "@/lib/db";
import { fetchStockQuote } from "@/lib/market-data";

/**
 * Live primary ↔ secondary exchange rate. The daily rates (ECB, via
 * Frankfurter) change once a working day; this reads the market rate from
 * Yahoo Finance (`GBPINR=X`), cached for five minutes per pair, so the UI can
 * show what a currency is worth right now.
 */

export const LIVE_TTL_MS = 5 * 60 * 1000;

interface LiveRate {
  /** 1 `from` = `rate` `to`. */
  from: string;
  to: string;
  rate: number;
  asOf: Date;
  source: "Yahoo Finance";
}

const cache = new Map<string, { value: LiveRate | null; at: number }>();

export async function liveRate(from: string, to: string, now = Date.now()): Promise<LiveRate | null> {
  if (from === to) return { from, to, rate: 1, asOf: new Date(now), source: "Yahoo Finance" };
  const key = `${from}${to}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < LIVE_TTL_MS) return hit.value;
  const quote = await fetchStockQuote(`${key}=X`);
  const value = quote && quote.price > 0 ? { from, to, rate: quote.price, asOf: new Date(now), source: "Yahoo Finance" as const } : null;
  // Keep serving the last good rate if the provider hiccups.
  cache.set(key, { value: value ?? hit?.value ?? null, at: now });
  return value ?? hit?.value ?? null;
}

/** The user's live secondary → primary rate (e.g. 1 GBP = 112.40 INR). With
 * automatic rates on, it's also saved as the primary → secondary rate, so the
 * "≈" conversions shown across the app use the same figure. */
export async function userLiveRate(userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { baseCurrency: true, secondaryCurrency: true, exchangeRateMode: true },
  });
  if (!user.secondaryCurrency || user.secondaryCurrency === user.baseCurrency) return null;
  const live = await liveRate(user.secondaryCurrency, user.baseCurrency);
  if (!live) return null;
  if (user.exchangeRateMode === "AUTOMATIC") {
    const key = { userId, baseCurrency: user.baseCurrency, targetCurrency: user.secondaryCurrency, mode: "AUTOMATIC" as const };
    const rate = 1 / live.rate;
    const saved = await db.exchangeRate.findUnique({ where: { userId_baseCurrency_targetCurrency_mode: key } });
    if (!saved || Math.abs(Number(saved.rate) - rate) / rate > 1e-6) {
      await db.exchangeRate.upsert({
        where: { userId_baseCurrency_targetCurrency_mode: key },
        update: { rate, fetchedAt: live.asOf },
        create: { ...key, rate, fetchedAt: live.asOf },
      });
    }
  }
  return { ...live, primary: user.baseCurrency, secondary: user.secondaryCurrency, savedForConversions: user.exchangeRateMode === "AUTOMATIC" };
}
