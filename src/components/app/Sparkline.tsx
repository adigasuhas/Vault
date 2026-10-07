"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface SparkPoint {
  d: string;
  v: number;
}

/**
 * A 1-year price line sized for a table cell (Kite-style): no axes, a faint
 * baseline at the first price, coloured by the period's direction. Hover
 * shows the date and price under the cursor and the 1-year change.
 */
export function Sparkline({
  points,
  width = 104,
  height = 30,
  currency,
  className,
  showChange = true,
}: {
  showChange?: boolean;
  points: SparkPoint[] | undefined;
  width?: number;
  height?: number;
  currency?: string;
  className?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const geo = useMemo(() => {
    if (!points || points.length < 2) return null;
    const vs = points.map((p) => p.v);
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const span = max - min || 1;
    const pad = 2;
    const x = (i: number) => (i / (points.length - 1)) * (width - pad * 2) + pad;
    const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const change = (vs[vs.length - 1] - vs[0]) / vs[0];
    return { d, x, y, change, base: y(vs[0]) };
  }, [points, width, height]);

  if (points === undefined) return <div className={cn("shimmer rounded", className)} style={{ width, height }} />;
  if (!geo) return <span className={cn("text-xs text-muted-foreground", className)} style={{ width }}>No data</span>;

  const up = geo.change >= 0;
  const color = up ? "var(--positive)" : "var(--negative)";
  const h = hover != null ? points![hover] : null;
  const fmt = (v: number) =>
    currency ? new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: v < 100 ? 2 : 0 }).format(v) : v.toFixed(2);

  return (
    <div className={cn("group/spark relative inline-flex items-center gap-2", className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
        role="img"
        aria-label={`1-year change ${(geo.change * 100).toFixed(1)}%`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (points!.length - 1));
          setHover(Math.max(0, Math.min(points!.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.18" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={width} y1={geo.base} y2={geo.base} stroke="var(--muted-foreground)" strokeOpacity="0.35" strokeDasharray="1.5 2.5" strokeWidth="0.8" />
        <path d={`${geo.d}L${width - 2},${height}L2,${height}Z`} fill={`url(#g${id})`} />
        <path d={geo.d} fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <circle cx={geo.x(hover)} cy={geo.y(points![hover].v)} r="2.2" fill={color} />}
      </svg>
      {showChange && <span className={cn("w-12 text-right text-[11px] font-medium tabular-nums", up ? "text-positive" : "text-negative")}>
        {up ? "+" : "−"}
        {Math.abs(geo.change * 100).toFixed(1)}%
      </span>}
      {h && (
        <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 rounded-md border border-border bg-popover px-2 py-1 text-[11px] whitespace-nowrap text-popover-foreground shadow-pop">
          {new Date(h.d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" })} · <span className="tabular-nums">{fmt(h.v)}</span>
        </span>
      )}
    </div>
  );
}
