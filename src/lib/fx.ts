import { db } from "@/lib/db";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

const CURRENCY_CODES = SUPPORTED_CURRENCIES.map((c) => c.code);

/** Refreshes AUTOMATIC exchange rates for every currency pair a user might need,
 * against every distinct base currency in use, via Frankfurter (free, no API key). */
export async function refreshAutomaticExchangeRates(onlyUserId?: string) {
  const users = await db.user.findMany({
    where: { exchangeRateMode: "AUTOMATIC", ...(onlyUserId ? { id: onlyUserId } : {}) },
    select: { id: true, baseCurrency: true },
  });

  const baseCurrencies = Array.from(new Set(users.map((u) => u.baseCurrency)));
  let updated = 0;
  let failed = 0;

  for (const base of baseCurrencies) {
    try {
      const symbols = CURRENCY_CODES.filter((c) => c !== base).join(",");
      const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${symbols}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Frankfurter returned ${res.status}`);
      const data: { rates: Record<string, number> } = await res.json();

      const usersForBase = users.filter((u) => u.baseCurrency === base);
      for (const user of usersForBase) {
        for (const [target, rate] of Object.entries(data.rates)) {
          await db.exchangeRate.upsert({
            where: {
              userId_baseCurrency_targetCurrency_mode: {
                userId: user.id,
                baseCurrency: base,
                targetCurrency: target,
                mode: "AUTOMATIC",
              },
            },
            update: { rate, fetchedAt: new Date() },
            create: { userId: user.id, baseCurrency: base, targetCurrency: target, rate, mode: "AUTOMATIC" },
          });
          updated++;
        }
      }
    } catch {
      failed++;
    }
  }

  return { baseCurrenciesRefreshed: baseCurrencies.length - failed, ratesUpdated: updated, failed };
}

// ---------------------------------------------------------------------------
// Request-scoped converter
// ---------------------------------------------------------------------------

/** Automatic rates older than this are refreshed (best effort) before use. */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
/** Don't hammer the provider if a refresh just failed. */
const RETRY_AFTER_MS = 15 * 60 * 1000;
const lastAttempt = new Map<string, number>();

/** Refreshes a user's automatic rates when they're missing or older than 12h.
 * Never throws: on failure the converter falls back to the last stored rates
 * (and reports how old they are). */
export async function ensureFreshRates(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { exchangeRateMode: true, baseCurrency: true } });
  if (!user || user.exchangeRateMode !== "AUTOMATIC") return;
  // The oldest rate decides: the live primary/secondary rate (fx-live.ts) is
  // re-saved every few minutes and mustn't make the rest look fresh.
  const oldest = await db.exchangeRate.findFirst({
    where: { userId, mode: "AUTOMATIC", baseCurrency: user.baseCurrency },
    orderBy: { fetchedAt: "asc" },
    select: { fetchedAt: true },
  });
  if (oldest && Date.now() - oldest.fetchedAt.getTime() < STALE_AFTER_MS) return;
  const last = lastAttempt.get(userId) ?? 0;
  if (Date.now() - last < RETRY_AFTER_MS) return;
  lastAttempt.set(userId, Date.now());
  try {
    await refreshAutomaticExchangeRates(userId);
  } catch (e) {
    console.error("FX refresh failed:", e);
  }
}

export interface FxConverter {
  /** `amount` in `from` → the user's base (primary) currency. */
  convert: (amount: number, from: string) => number;
  /** `amount` in `from` → `to`, or null when no rate path exists. */
  convertTo: (amount: number, from: string, to: string) => number | null;
  /** Units of `to` per 1 `from`, or null. */
  rate: (from: string, to: string) => number | null;
  /** Currencies that had to fall back to a 1:1 rate in `convert`. */
  readonly missing: string[];
  readonly baseCurrency: string;
  /** When the oldest rate this converter relies on was fetched. */
  readonly asOf: Date | null;
}

/**
 * Loads the user's rate table once and returns a synchronous converter.
 * Rates resolve directly, by inverse, or across the base currency (e.g.
 * USD → INR via GBP when only GBP-based rates are stored).
 *
 * `convert` (used for totals) still falls back to 1:1 when no rate exists but
 * records the currency in `missing` so the UI can warn; `convertTo` (used for
 * "≈" equivalents) returns null instead of inventing a number. Historical
 * entries are never re-valued — conversions are display-only.
 */
export async function createFxConverter(
  userId: string,
  baseCurrency: string,
  opts: { refresh?: boolean; client?: Pick<typeof db, "user" | "exchangeRate"> } = {}
): Promise<FxConverter> {
  // Never refresh (a network call) from inside a DB transaction.
  if (opts.refresh !== false) await ensureFreshRates(userId);
  const client = opts.client ?? db;
  const [user, rows] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { exchangeRateMode: true } }),
    client.exchangeRate.findMany({ where: { userId }, orderBy: { fetchedAt: "desc" } }),
  ]);
  const preferredMode = user?.exchangeRateMode ?? "AUTOMATIC";

  const byPreferred = new Map<string, { r: number; at: Date }>();
  const byAny = new Map<string, { r: number; at: Date }>();
  for (const row of rows) {
    const key = `${row.baseCurrency}>${row.targetCurrency}`;
    const v = { r: Number(row.rate), at: row.fetchedAt };
    if (!byAny.has(key)) byAny.set(key, v);
    if (row.mode === preferredMode && !byPreferred.has(key)) byPreferred.set(key, v);
  }
  const used: Date[] = [];

  function direct(from: string, to: string): number | null {
    const k = `${from}>${to}`;
    const hit = byPreferred.get(k) ?? byAny.get(k);
    if (hit) {
      used.push(hit.at);
      return hit.r;
    }
    const inv = byPreferred.get(`${to}>${from}`) ?? byAny.get(`${to}>${from}`);
    if (inv && inv.r) {
      used.push(inv.at);
      return 1 / inv.r;
    }
    return null;
  }

  function rate(from: string, to: string): number | null {
    if (from === to) return 1;
    const d = direct(from, to);
    if (d != null) return d;
    // Cross through the base currency, then through any shared pivot.
    const pivots = [baseCurrency, ...SUPPORTED_CURRENCIES.map((c) => c.code)];
    for (const p of pivots) {
      if (p === from || p === to) continue;
      const a = direct(from, p);
      const b = a != null ? direct(p, to) : null;
      if (a != null && b != null) return a * b;
    }
    return null;
  }

  const missing = new Set<string>();
  return {
    baseCurrency,
    get missing() {
      return [...missing];
    },
    get asOf() {
      return used.length ? new Date(Math.min(...used.map((d) => d.getTime()))) : null;
    },
    rate,
    convertTo(amount, from, to) {
      if (!Number.isFinite(amount)) return 0;
      const r = rate(from, to);
      return r == null ? null : amount * r;
    },
    convert(amount: number, from: string): number {
      if (!Number.isFinite(amount)) return 0;
      if (from === baseCurrency) return amount;
      const r = rate(from, baseCurrency);
      if (r == null) {
        missing.add(from);
        return amount;
      }
      return amount * r;
    },
  };
}
