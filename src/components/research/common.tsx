"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { formatMoney } from "@/lib/currencies";
import { formatDateTime } from "@/lib/format";
import type { Quote, Stat } from "@/lib/research/types";
import { cn } from "@/lib/utils";

export interface Envelope<T> {
  data: T;
  fetchedAt: string;
  stale: boolean;
  source: string;
}

/** Loads one research section once, with loading / error / retry. */
export function useResearch<T>(url: string | null) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; env: (Envelope<T> & Record<string, unknown>) | null }>({ loading: !!url, error: null, env: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) setState({ loading: false, error: d.error || "Couldn't load this. Try again.", env: null });
        else setState({ loading: false, error: null, env: d });
      })
      .catch(() => alive && setState({ loading: false, error: "Couldn't reach VAULT. Check your connection.", env: null }));
    return () => {
      alive = false;
    };
  }, [url, attempt]);
  const retry = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    setAttempt((a) => a + 1);
  }, []);
  return { ...state, retry };
}

/** Lakh/crore for rupee amounts, thousand/million/billion otherwise. */
function compact(n: number, currency?: string | null) {
  if (currency === "INR") {
    const a = Math.abs(n), sign = n < 0 ? "−" : "";
    const f = (x: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(x);
    if (a >= 1e7) return `${sign}${f(a / 1e7)} Cr`;
    if (a >= 1e5) return `${sign}${f(a / 1e5)} L`;
    return `${sign}${f(a)}`;
  }
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}
/** Large amounts in a currency, compactly: "₹4,40,677 Cr", "$109.42B". */
export function money(n: number | null | undefined, currency: string | null | undefined, opts: { compact?: boolean } = {}) {
  if (n == null) return "–";
  if (!currency) return compact(n);
  if (opts.compact && Math.abs(n) >= 1e5) {
    const sym = formatMoney(0, currency).replace(/[\d.,\s]/g, "");
    return `${n < 0 ? "−" : ""}${sym}${compact(Math.abs(n), currency)}`;
  }
  return formatMoney(n, currency);
}
export const pctText = (n: number | null | undefined, digits = 1) => (n == null ? "–" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}%`);
/** A count (volume, shares): Indian grouping for rupee stocks, else K/M/B. */
export const numText = (n: number | null | undefined, currency?: string | null) => (n == null ? "–" : compact(n, currency));

/** A stat value, formatted by kind; unavailable shows as a dash, never zero. */
export function statText(s: Stat, tradingCurrency?: string) {
  if (s.value == null || s.value === "") return "–";
  if (typeof s.value === "string") return s.kind === "date" ? new Date(`${s.value}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : s.value;
  if (s.kind === "money") return money(s.value, s.currency, { compact: true });
  if (s.kind === "pct") return `${(s.value * 100).toFixed(1)}%`;
  if (s.kind === "ratio") return s.value.toFixed(2);
  return numText(s.value, tradingCurrency);
}

const STATE: Record<string, string> = { REGULAR: "Market open", PRE: "Pre-market", PREPRE: "Market closed", POST: "After hours", POSTPOST: "Market closed", CLOSED: "Market closed" };

/** Says exactly how current the price is: real-time vs delayed, the market's
 * state, when it was quoted, and when VAULT last fetched it. */
export function Freshness({ quote, fetchedAt, stale, source, className }: { quote: Quote; fetchedAt: string; stale: boolean; source: string; className?: string }) {
  const delayed = (quote.delayMinutes ?? 0) > 0;
  const open = quote.marketState === "REGULAR";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", className)}>
      {stale ? (
        <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="h-3.5 w-3.5" />Couldn&apos;t refresh: showing data from {formatDateTime(fetchedAt)}</span>
      ) : (
        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{delayed ? `Delayed about ${quote.delayMinutes} min` : open ? "Real-time" : "Latest available"}</span>
      )}
      <span>· {quote.marketState ? STATE[quote.marketState] ?? quote.marketState : "Market state unknown"}{!open && quote.quoteTime ? `, last price ${formatDateTime(quote.quoteTime)}` : ""}</span>
      {!stale && <span>· Fetched {formatDateTime(fetchedAt)}</span>}
      <span>· {source}</span>
    </div>
  );
}

export function Unavailable({ children }: { children?: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{children ?? "Not available from the data provider for this company."}</p>;
}

export function StaleNote({ env }: { env: { stale: boolean; fetchedAt: string } | null }) {
  if (!env?.stale) return null;
  return <p className="inline-flex items-center gap-1 text-xs text-warning"><AlertTriangle className="h-3.5 w-3.5" />Couldn&apos;t refresh: showing data from {formatDateTime(env.fetchedAt)}.</p>;
}
