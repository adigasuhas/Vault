import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { priceHistory } from "@/lib/price-history";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** 1-year series for every stock and mutual fund the user holds, keyed by
 * holding id: { series: { [holdingId]: [{d, v}] } }. */
export const GET = authed(async (_req, { userId }) => {
  const [stocks, funds] = await Promise.all([
    db.stockHolding.findMany({ where: { userId }, select: { id: true, ticker: true } }),
    db.mutualFundHolding.findMany({ where: { userId }, select: { id: true, schemeCode: true } }),
  ]);
  const jobs: [string, string][] = [
    ...stocks.map((s) => [s.id, `stock:${s.ticker.trim().toUpperCase()}`] as [string, string]),
    ...funds.filter((f) => f.schemeCode).map((f) => [f.id, `mf:${f.schemeCode!.trim()}`] as [string, string]),
  ];
  const unique = [...new Set(jobs.map(([, k]) => k))];
  const results = new Map<string, Awaited<ReturnType<typeof priceHistory>>>();
  // Small concurrency so a large portfolio doesn't fan out 50 requests at once.
  for (let i = 0; i < unique.length; i += 6) {
    const batch = unique.slice(i, i + 6);
    const got = await Promise.all(batch.map((k) => priceHistory(k)));
    batch.forEach((k, j) => results.set(k, got[j]));
  }
  return { series: Object.fromEntries(jobs.map(([id, k]) => [id, results.get(k) ?? []])) };
});
