"use client";

import { useEffect, useState } from "react";
import { useCurrency } from "@/context/CurrencyContext";
import { formatMoney } from "@/lib/currencies";
import { cn } from "@/lib/utils";

function ago(iso: string, now: number) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "just now" : m === 1 ? "1 min ago" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** "1 GBP = ₹112.40 · live, 2 min ago" for the user's secondary currency in
 * their primary. Refreshes every five minutes (CurrencyContext); renders
 * nothing without a secondary currency. */
export function FxTicker({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { live } = useCurrency();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (!live) return null;
  const inverse = 1 / live.rate;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums", className)}
      title={`1 ${live.primary} = ${inverse.toPrecision(4)} ${live.secondary} · market rate from ${live.source}, updated ${new Date(live.asOf).toLocaleTimeString()}`}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive/60 motion-reduce:hidden" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
      </span>
      <span>
        1 {live.secondary} = <span className="font-medium text-foreground">{formatMoney(live.rate, live.primary)}</span>
        {!compact && <span> · live, {ago(live.asOf, now)}</span>}
      </span>
    </span>
  );
}
