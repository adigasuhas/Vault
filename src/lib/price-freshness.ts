/**
 * When a market price can be trusted. Shared by the alert checks (server)
 * and the Investments page (client), so "stale" means the same everywhere.
 */

/** Quotes older than this are shown as stale and never trigger alerts.
 * Long enough to cover a weekend plus a market holiday. */
export const STALE_AFTER_MS = 4 * 24 * 60 * 60 * 1000;

export type PriceStatus = "live" | "stale" | "none";

export function priceStatus(price: number | string | null | undefined, at: Date | string | null | undefined, now = Date.now()): PriceStatus {
  const p = price == null ? NaN : Number(price);
  if (!Number.isFinite(p) || p <= 0 || !at) return "none";
  return now - new Date(at).getTime() <= STALE_AFTER_MS ? "live" : "stale";
}

/** Below this return (in %, either way) a holding counts as break-even. */
export const BREAK_EVEN_PCT = 0.5;

export type Performance = "gain" | "loss" | "flat";
export function performance(returnPct: number | null | undefined): Performance {
  if (returnPct == null || !Number.isFinite(returnPct) || Math.abs(returnPct) < BREAK_EVEN_PCT) return "flat";
  return returnPct > 0 ? "gain" : "loss";
}
