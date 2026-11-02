"use client";

import { useState } from "react";
import { ArrowRightLeft, RotateCcw } from "lucide-react";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { useCurrency } from "@/context/CurrencyContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Reporting an amount in one currency for an account kept in another: the
 * currency switch beside the amount, and the panel where the user confirms
 * (or overrides) the rate and sees exactly what leaves the account.
 *
 * Rates are stored as account-currency units per 1 unit of the reported
 * currency, but shown the readable way round (1 GBP = 110.25 INR, never
 * 1 INR = 0.0091 GBP).
 */

const symbol = (code: string) => SUPPORTED_CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Six significant figures, no trailing zeros: 110.254, 1.17234, 0.0118. */
export const fmtRate = (n: number) => String(Number(n.toPrecision(6)));

type Fx = ReturnType<typeof useCurrency>;

/** Today's rate from `from` to `to` (units of `to` per 1 `from`): the live
 * market rate for the primary/secondary pair, otherwise the stored daily
 * rates (or the user's own, when they set rates themselves). */
export function marketRate(fx: Fx, from: string, to: string): { rate: number; source: string; asOf: string | null } | null {
  if (from === to) return { rate: 1, source: "Same currency", asOf: null };
  if (fx.mode === "AUTOMATIC" && fx.live) {
    const { primary, secondary, rate, asOf } = fx.live;
    if (from === secondary && to === primary) return { rate, source: "Live market rate", asOf };
    if (from === primary && to === secondary) return { rate: 1 / rate, source: "Live market rate", asOf };
  }
  const a = fx.toPrimaryAmount(1, from);
  const b = fx.toPrimaryAmount(1, to);
  if (a == null || b == null || !(a > 0) || !(b > 0)) return null;
  return { rate: a / b, source: fx.mode === "MANUAL" ? "Your saved rate" : "Daily reference rate", asOf: fx.asOf };
}

function ago(iso: string | null) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 36) return `${h} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

interface Override {
  pair: string;
  /** Account units per 1 reported unit; null while the typed text isn't a rate. */
  rate: number | null;
  text: string;
}

export interface Conversion {
  needed: boolean;
  from: string;
  to: string;
  market: ReturnType<typeof marketRate>;
  /** Account units per 1 reported unit, or null when there's none yet. */
  rate: number | null;
  /** What leaves the account, in its currency. */
  debit: number | null;
  /** Shown as 1 `to` = x `from` (true) or 1 `from` = x `to`. */
  flipped: boolean;
  rateText: string;
  debitText: string;
  setRateText: (t: string) => void;
  setDebitText: (t: string) => void;
  reset: () => void;
  /** How far the confirmed rate is from today's (0.021 = 2.1%), or null. */
  deviation: number | null;
  overridden: boolean;
}

/** Conversion state for an expense of `amount` `from` paid from an account in
 * `to`. An override belongs to its currency pair, so switching currency or
 * account falls back to today's rate; a typed debit belongs to its amount. */
export function useConversion(
  amount: number,
  from: string,
  to: string,
  initial?: { from: string; to: string; rate: number | null; debit: number | null; amount: number }
): Conversion {
  const fx = useCurrency();
  const pair = `${from}>${to}`;
  const needed = !!to && from !== to;
  const market = needed ? marketRate(fx, from, to) : null;
  const initialPair = initial ? `${initial.from}>${initial.to}` : null;
  const [rateOverride, setRateOverride] = useState<Override | null>(() =>
    initial?.rate && initial.from !== initial.to ? { pair: initialPair!, rate: initial.rate, text: "" } : null
  );
  const [debitOverride, setDebitOverride] = useState<{ pair: string; amount: number; text: string } | null>(() =>
    initial?.debit != null && initial.rate ? { pair: initialPair!, amount: initial.amount, text: String(initial.debit) } : null
  );

  const own = rateOverride?.pair === pair ? rateOverride : null;
  const rate = own ? own.rate : (market?.rate ?? null);
  const flipped = (market?.rate ?? rate ?? 1) < 1;
  const shown = (r: number) => fmtRate(flipped ? 1 / r : r);
  const rateText = own ? (own.text || (own.rate ? shown(own.rate) : "")) : rate ? shown(rate) : "";

  const typedDebit = debitOverride && debitOverride.pair === pair && debitOverride.amount === amount ? debitOverride : null;
  const debit = typedDebit ? (Number(typedDebit.text) > 0 ? round2(Number(typedDebit.text)) : null) : rate && amount > 0 ? round2(amount * rate) : null;
  const debitText = typedDebit ? typedDebit.text : debit != null ? debit.toFixed(2) : "";

  const deviation = market && rate ? rate / market.rate - 1 : null;
  return {
    needed,
    from,
    to,
    market,
    rate,
    debit,
    flipped,
    rateText,
    debitText,
    setRateText: (t) => {
      const v = Number(t);
      const r = t.trim() !== "" && Number.isFinite(v) && v > 0 ? (flipped ? 1 / v : v) : null;
      setRateOverride({ pair, rate: r, text: t });
      setDebitOverride(null);
    },
    setDebitText: (t) => {
      setDebitOverride({ pair, amount, text: t });
      const v = Number(t);
      // The rate follows the exact figure from the statement.
      if (amount > 0 && Number.isFinite(v) && v > 0) setRateOverride({ pair, rate: v / amount, text: "" });
    },
    reset: () => {
      setRateOverride(null);
      setDebitOverride(null);
    },
    deviation,
    overridden: !!own && (deviation == null || Math.abs(deviation) > 1e-6),
  };
}

/** Segmented switch between the currencies an expense can be reported in. */
export function CurrencySwitch({ options, value, onChange }: { options: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Currency of the amount" className="inline-flex h-10 shrink-0 rounded-lg bg-muted p-0.5 text-xs">
      {options.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={cn(
            "min-w-11 cursor-pointer rounded-md px-2 font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === c ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

/** The confirmation panel, shown while the amount's currency isn't the account's. */
export function ExchangeRateConfirm({ conv, amount, accountName }: { conv: Conversion; amount: number; accountName: string }) {
  if (!conv.needed) return null;
  const [one, other] = conv.flipped ? [conv.to, conv.from] : [conv.from, conv.to];
  const dev = conv.deviation;
  const far = dev != null && Math.abs(dev) >= 0.03;
  const when = ago(conv.market?.asOf ?? null);
  return (
    <section aria-labelledby="fx-title" className="settle relative overflow-hidden rounded-lg border border-brass/35 bg-brass-soft/35 p-4 pl-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brass" />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="fx-title" className="flex items-center gap-1.5 text-sm font-medium">
          <ArrowRightLeft className="h-3.5 w-3.5 text-brass" strokeWidth={2} />
          Confirm the exchange rate
        </h3>
        <p className="text-[11.5px] text-muted-foreground">
          {conv.market ? <>{conv.market.source}{when ? ` · ${when}` : ""}</> : "No rate on file: enter today's"}
        </p>
      </div>
      <p className="mt-1 max-w-prose text-xs text-pretty text-muted-foreground">
        {accountName} is kept in {conv.to}. The expense is recorded in {conv.from}
        {amount > 0 ? <> as <span className="text-foreground tabular-nums">{formatMoney(amount, conv.from)}</span></> : null}; this is what leaves the account.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fx-rate">Rate</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm whitespace-nowrap text-muted-foreground">1 {one} =</span>
            <Input
              id="fx-rate"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={conv.rateText}
              onChange={(e) => conv.setRateText(e.target.value)}
              aria-describedby="fx-note"
              aria-invalid={conv.rate == null}
              className="h-10 bg-card pr-14 pl-[4.6rem] font-medium tabular-nums"
              placeholder="0"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">{other}</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fx-debit">Taken from {accountName}</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{symbol(conv.to)}</span>
            <Input
              id="fx-debit"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={conv.debitText}
              onChange={(e) => conv.setDebitText(e.target.value)}
              aria-invalid={conv.debit == null && amount > 0}
              className="h-10 bg-card pl-8 font-medium tabular-nums"
              placeholder="0.00"
            />
          </div>
        </div>
      </div>

      <div id="fx-note" aria-live="polite" className="mt-2.5 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {conv.rate == null ? (
          <span className="text-negative">Enter the rate to log this expense.</span>
        ) : conv.overridden ? (
          <>
            <span className={cn(far ? "text-warning" : "text-muted-foreground")}>
              Your rate{dev != null && conv.market ? <>, {Math.abs(dev * 100).toFixed(1)}% {dev * (conv.flipped ? -1 : 1) > 0 ? "above" : "below"} today&apos;s {fmtRate(conv.flipped ? 1 / conv.market.rate : conv.market.rate)}</> : null}
              {far ? ". Check it before logging." : "."}
            </span>
            {conv.market && (
              <button type="button" onClick={conv.reset} className="inline-flex cursor-pointer items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline">
                <RotateCcw className="h-3 w-3" /> Use today&apos;s rate
              </button>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">Using today&apos;s rate. Change it, or type the exact amount from your statement.</span>
        )}
      </div>
    </section>
  );
}
