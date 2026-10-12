"use client";

import { performance } from "@/lib/price-freshness";
import { cn } from "@/lib/utils";

/** Profit/loss shown with a sign, an arrow and a soft tint: green for a gain,
 * red for a loss, neutral within ±0.5% (see lib/price-freshness). Colour is
 * never the only signal. */
export function PlCell({ pct: p, arrow, children, className }: { pct: number | null; arrow?: boolean; children: React.ReactNode; className?: string }) {
  const perf = performance(p);
  return (
    <div className={cn("inline-block min-w-full rounded-md px-1.5 py-1 text-right tabular-nums", perf === "gain" ? "bg-positive/10 text-positive" : perf === "loss" ? "bg-negative/10 text-negative" : "bg-muted/60 text-muted-foreground", className)}>
      {arrow && <span aria-hidden className="mr-0.5 text-[10px]">{perf === "gain" ? "▲" : perf === "loss" ? "▼" : "■"}</span>}
      {children}
    </div>
  );
}
