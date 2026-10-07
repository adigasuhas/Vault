import YahooFinance from "yahoo-finance2";
import { db } from "@/lib/db";

/**
 * One-year price series for the holdings sparklines. Stocks come from Yahoo
 * Finance daily closes, mutual funds from mfapi.in (AMFI NAV history). Both
 * are cached in PriceHistoryCache for 12 hours — a sparkline doesn't need
 * intraday freshness, and the investments page shouldn't hit two external
 * APIs on every visit. Failures (unknown ticker, provider down) cache an empty
 * series for an hour so a bad symbol doesn't retry on every load.
 */

const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
const TTL_MS = 12 * 60 * 60 * 1000;
const FAIL_TTL_MS = 60 * 60 * 1000;
const MAX_POINTS = 120;

export interface PricePoint {
  d: string; // YYYY-MM-DD
  v: number;
}

function downsample(points: PricePoint[]): PricePoint[] {
  if (points.length <= MAX_POINTS) return points;
  const step = (points.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, i) => points[Math.round(i * step)]);
}

async function fetchStock(ticker: string): Promise<PricePoint[]> {
  const r = await yahoo.chart(ticker, { period1: new Date(Date.now() - 366 * 86_400_000), interval: "1d" });
  return r.quotes
    .filter((q) => typeof q.close === "number" && q.close > 0)
    .map((q) => ({ d: new Date(q.date).toISOString().slice(0, 10), v: q.close as number }));
}

async function fetchFund(schemeCode: string): Promise<PricePoint[]> {
  const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`mfapi ${res.status}`);
  const json = (await res.json()) as { data?: { date: string; nav: string }[] };
  const cutoff = Date.now() - 366 * 86_400_000;
  return (json.data ?? [])
    .map((r) => {
      const [dd, mm, yyyy] = r.date.split("-");
      return { d: `${yyyy}-${mm}-${dd}`, v: Number(r.nav) };
    })
    .filter((p) => Number.isFinite(p.v) && p.v > 0 && Date.parse(p.d) >= cutoff)
    .sort((a, b) => a.d.localeCompare(b.d));
}

export async function priceHistory(key: string): Promise<PricePoint[]> {
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");
  if (!id || (kind !== "stock" && kind !== "mf")) return [];

  const cached = await db.priceHistoryCache.findUnique({ where: { key } });
  if (cached) {
    const points = cached.points as unknown as PricePoint[];
    const age = Date.now() - cached.fetchedAt.getTime();
    if (age < (points.length ? TTL_MS : FAIL_TTL_MS)) return points;
  }
  let points: PricePoint[] = [];
  try {
    points = downsample(kind === "stock" ? await fetchStock(id) : await fetchFund(id));
  } catch {
    // Keep serving a stale series rather than nothing.
    if (cached && (cached.points as unknown as PricePoint[]).length) return cached.points as unknown as PricePoint[];
  }
  await db.priceHistoryCache.upsert({
    where: { key },
    update: { points: points as unknown as object, fetchedAt: new Date() },
    create: { key, points: points as unknown as object },
  });
  return points;
}
