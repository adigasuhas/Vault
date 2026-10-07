"use client";

import { formatMoney } from "@/lib/currencies";
import { useCurrency } from "@/context/CurrencyContext";
import { cn } from "@/lib/utils";

/**
 * A money amount in tabular figures, always in its native currency.
 *
 * `signed` prefixes + / − and colours by direction; `tone` forces a colour.
 * `equivalent` adds the converted value in the viewer's primary currency (or
 * secondary, when the amount is already in primary) — marked "≈" and muted so
 * it's never mistaken for the real amount held or owed.
 */
export function Money({
  value,
  currency,
  signed = false,
  tone,
  className,
  equivalent,
}: {
  value: number | string;
  currency: string;
  signed?: boolean;
  tone?: "positive" | "negative" | "muted" | "auto" | "plain";
  className?: string;
  equivalent?: "inline" | "below";
}) {
  const n = typeof value === "string" ? Number(value) : value;
  const t = tone === "plain" ? undefined : tone === "auto" || (signed && !tone) ? (n > 0 ? "positive" : n < 0 ? "negative" : "muted") : tone;
  const text = signed ? `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatMoney(Math.abs(n), currency)}` : formatMoney(n, currency);
  const main = (
    <span
      className={cn(
        "tabular-nums whitespace-nowrap",
        t === "positive" && "text-positive",
        t === "negative" && "text-negative",
        t === "muted" && "text-muted-foreground",
        !equivalent && className
      )}
    >
      {text}
    </span>
  );
  if (!equivalent) return main;
  return (
    <span className={cn(equivalent === "below" ? "inline-flex flex-col items-end" : "inline-flex items-baseline gap-1.5", className)}>
      {main}
      <Equivalent value={n} currency={currency} signed={signed} />
    </span>
  );
}

/** "≈ £4,300" in the other configured currency, or nothing. With `both`, the
 * amount in primary and in secondary, leaving out whichever is its own currency. */
export function Equivalent({ value, currency, signed, className, both, stack }: { value: number; currency: string; signed?: boolean; className?: string; both?: boolean; stack?: boolean }) {
  const fx = useCurrency();
  const parts: { amount: number; currency: string }[] = [];
  if (both) {
    if (fx.ready && currency !== fx.primary) {
      const p = fx.toPrimaryAmount(Math.abs(value), currency);
      if (p != null) parts.push({ amount: p, currency: fx.primary });
    }
    if (fx.ready && fx.secondary && currency !== fx.secondary) {
      const s = fx.toSecondaryAmount(Math.abs(value), currency);
      if (s != null) parts.push({ amount: s, currency: fx.secondary });
    }
  } else {
    const eq = fx.equivalent(Math.abs(value), currency);
    if (eq) parts.push(eq);
  }
  if (!parts.length) return null;
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : value < 0 ? "−" : "";
  const asOf = fx.asOf ? new Date(fx.asOf).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
  return (
    <span
      className={cn("text-[0.78em] font-normal whitespace-nowrap text-muted-foreground tabular-nums", className)}
      title={`Converted at today's rate${asOf ? ` (updated ${asOf})` : ""}. The real amount is in ${currency}.`}
    >
      {parts.map((p, i) => (
        <span key={p.currency} className={stack ? "block" : undefined}>
          {i > 0 && !stack && " · "}≈ {sign}
          {formatMoney(Math.round(p.amount), p.currency)}
        </span>
      ))}
    </span>
  );
}
