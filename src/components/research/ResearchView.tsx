"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend as RLegend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, ExternalLink, Plus, Target } from "lucide-react";
import { formatMoney } from "@/lib/currencies";
import { formatDate, formatDateTime } from "@/lib/format";
import { tooltipStyle } from "@/lib/chart-colors";
import type { Analysts, Chart, ChartRange, Earnings, Financials, NewsItem, Ownership, Period, Summary } from "@/lib/research/types";
import { CHART_RANGES } from "@/lib/research/types";
import { growth } from "@/lib/research/metrics";
import { ErrorState, Panel, SkeletonBlock } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Freshness, StaleNote, Unavailable, money, numText, pctText, statText, useResearch } from "@/components/research/common";
import { cn } from "@/lib/utils";

const tone = (n: number | null | undefined) => (n == null || Math.abs(n) < 1e-9 ? "text-muted-foreground" : n > 0 ? "text-positive" : "text-negative");
const AXIS = { tickLine: false, axisLine: false, fontSize: 11, stroke: "var(--muted-foreground)" } as const;

function Loading({ h = "h-64" }: { h?: string }) {
  return <SkeletonBlock className={h} />;
}

// ------------------------------------------------------------------ header

export interface ResearchActions {
  /** Back to the search (the drawer's start). */
  onBack?: () => void;
  /** Open the add-purchase form with this stock filled in. Never buys anything by itself. */
  onAdd?: (q: { symbol: string; exchange: string | null; currency: string }) => void;
  /** Show the user's holding of this stock. */
  onOpenHolding?: (id: string) => void;
}

/** One company's research: identity and price up top, then sections loaded
 * when first opened. Read-only: nothing here changes the portfolio. */
export function ResearchView({ symbol, onBack, onAdd, onOpenHolding }: { symbol: string } & ResearchActions) {
  const s = useResearch<Summary>(`/api/research/${encodeURIComponent(symbol)}?section=summary`);
  const [tab, setTab] = useState("overview");
  const [seen, setSeen] = useState<Set<string>>(new Set(["overview"]));
  const holding = s.env?.holding as { id: string; quantity: number; avgBuyPrice: number; currency: string } | null | undefined;
  const q = s.env?.data.quote;

  return (
    <div className="space-y-6">
      {onBack ? (
        <button type="button" onClick={onBack} className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Search</button>
      ) : (
        <Link href="/investments?research=" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Search</Link>
      )}
      {s.loading ? (
        <SkeletonBlock className="h-28" />
      ) : s.error ? (
        <ErrorState message={s.error} onRetry={s.retry} />
      ) : q ? (
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="eyebrow">{q.symbol} · {q.exchange}</p>
            <h1 className="font-display text-2xl tracking-tight text-balance sm:text-3xl">{q.name}</h1>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-3xl font-semibold tabular-nums">{q.price != null ? formatMoney(q.price, q.currency) : "No price"}</span>
              {q.change != null && q.changePct != null && (
                <span className={cn("text-base font-medium tabular-nums", tone(q.change))}>
                  {q.change > 0 ? "▲ +" : q.change < 0 ? "▼ −" : ""}{formatMoney(Math.abs(q.change), q.currency)} ({pctText(q.changePct, 2)})
                </span>
              )}
            </div>
            <Freshness quote={q} fetchedAt={s.env!.fetchedAt} stale={s.env!.stale} source={s.env!.source} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {holding ? (
              onOpenHolding ? (
                <button type="button" onClick={() => onOpenHolding(holding.id)} className="cursor-pointer rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:border-foreground/30">
                  You hold <span className="font-medium tabular-nums">{Number(holding.quantity.toFixed(4))} shares</span> · View
                </button>
              ) : (
                <Link href={`/investments?stock=${holding.id}`} className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-foreground/30">
                  You hold <span className="font-medium tabular-nums">{Number(holding.quantity.toFixed(4))} shares</span> · View
                </Link>
              )
            ) : null}
            {onAdd ? (
              <Button onClick={() => onAdd({ symbol: q.symbol, exchange: q.exchange ?? null, currency: q.currency })}><Plus className="h-4 w-4" />{holding ? "Buy more" : "Add to investments"}</Button>
            ) : (
              <Button asChild>
                <Link href={`/investments?add=${encodeURIComponent(q.symbol)}`}><Plus className="h-4 w-4" />{holding ? "Buy more" : "Add to investments"}</Link>
              </Button>
            )}
          </div>
        </header>
      ) : null}

      {q && (
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setSeen((x) => new Set(x).add(v)); }}>
          <TabsList className="max-w-full justify-start overflow-x-auto">
            {[["overview", "Overview"], ["chart", "Chart"], ["financials", "Financials"], ["earnings", "Quarterly"], ["ownership", "Shareholding"], ["valuation", "Valuation"], ["news", "News"]].map(([v, l]) => (
              <TabsTrigger key={v} value={v} className="cursor-pointer">{l}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview" className="space-y-6"><Overview summary={s.env!.data} /></TabsContent>
          <TabsContent value="chart">{seen.has("chart") && <PriceChart symbol={symbol} />}</TabsContent>
          <TabsContent value="financials">{seen.has("financials") && <FinancialsTab symbol={symbol} tradingCurrency={q.currency} />}</TabsContent>
          <TabsContent value="earnings">{seen.has("earnings") && <EarningsTab symbol={symbol} />}</TabsContent>
          <TabsContent value="ownership">{seen.has("ownership") && <OwnershipTab symbol={symbol} currency={q.currency} />}</TabsContent>
          <TabsContent value="valuation" className="space-y-6">
            {seen.has("valuation") && (
              <>
                <StatGroups summary={s.env!.data} only="Valuation" />
                <AnalystsTab symbol={symbol} price={q.price} />
              </>
            )}
          </TabsContent>
          <TabsContent value="news">{seen.has("news") && <NewsTab symbol={symbol} />}</TabsContent>
        </Tabs>
      )}
      <p className="text-xs text-muted-foreground">
        Market data from Yahoo Finance via an unofficial interface, for personal research only. It can be delayed, incomplete or occasionally wrong; anything the provider doesn&apos;t give is shown as a dash or &quot;not available&quot;, never estimated. Research never changes your portfolio.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- overview

function PriceChart({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<ChartRange>("1Y");
  const c = useResearch<Chart>(`/api/research/${encodeURIComponent(symbol)}?section=chart&range=${range}`);
  const pts = c.env?.data.points ?? [];
  const intraday = c.env?.data.interval === "5m" || c.env?.data.interval === "15m";
  const tz = c.env?.data.timezone ?? undefined;
  const label = (t: string) => new Date(t).toLocaleString("en-IN", intraday ? { hour: "numeric", minute: "2-digit", ...(range === "1W" ? { weekday: "short" } : {}), timeZone: tz } : range === "5Y" ? { month: "short", year: "2-digit", timeZone: tz } : { day: "numeric", month: "short", timeZone: tz });
  const first = pts[0]?.close, last = pts.at(-1)?.close;
  const change = first && last ? ((last - first) / first) * 100 : null;
  const cur = c.env?.data.currency ?? "";
  const up = (change ?? 0) >= 0;
  const color = up ? "var(--positive)" : "var(--negative)";
  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="eyebrow">Price</p>
          {change != null && <p className={cn("text-sm font-medium tabular-nums", tone(change))}>{pctText(change, 2)} over {range === "1D" ? "the day" : range}</p>}
        </div>
        <div role="radiogroup" aria-label="Range" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-0.5 text-xs">
          {CHART_RANGES.map((r) => (
            <button key={r} role="radio" aria-checked={range === r} onClick={() => setRange(r)} className={cn("h-7 shrink-0 cursor-pointer rounded-md px-2.5 transition-colors", range === r ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>{r}</button>
          ))}
        </div>
      </div>
      {c.loading ? <Loading /> : c.error ? <ErrorState message={c.error} onRetry={c.retry} /> : pts.length < 2 ? <Unavailable>No price history for this range.</Unavailable> : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={pts} margin={{ left: 4, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="px" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="t" tickFormatter={label} {...AXIS} minTickGap={48} />
              <YAxis {...AXIS} width={70} domain={["auto", "auto"]} tickFormatter={(v) => money(Number(v), cur, { compact: true })} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => new Date(String(t)).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", ...(intraday ? { hour: "numeric", minute: "2-digit" } : {}), timeZone: tz })} formatter={(v) => [formatMoney(Number(v), cur), "Close"]} />
              <Area type="linear" dataKey="close" stroke={color} strokeWidth={2} fill="url(#px)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
          {pts.some((p) => p.volume) && (
            <ResponsiveContainer width="100%" height={70}>
              <BarChart data={pts} margin={{ left: 4, right: 8 }}>
                <XAxis dataKey="t" hide />
                <YAxis {...AXIS} width={70} tickFormatter={(v) => numText(Number(v), cur)} tickCount={2} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} labelFormatter={(t) => new Date(String(t)).toLocaleString("en-IN", { day: "numeric", month: "short", ...(intraday ? { hour: "numeric", minute: "2-digit" } : { year: "numeric" }), timeZone: tz })} formatter={(v) => [numText(Number(v), cur), "Volume"]} />
                <Bar dataKey="volume" fill="var(--muted-foreground)" fillOpacity={0.35} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <span>Volume below. {intraday ? "Intraday prices in the exchange's time zone." : "Daily closes."}</span>
            <StaleNote env={c.env} />
          </div>
        </>
      )}
    </Panel>
  );
}

/** Key-figure panels from the summary: just one group, or all but one. */
function StatGroups({ summary, only, except }: { summary: Summary; only?: string; except?: string }) {
  const groups = summary.groups.filter((g) => (only ? g.title === only : g.title !== except));
  if (!groups.length) return <Unavailable />;
  return (
    <div className={cn("grid gap-4", groups.length > 1 && "md:grid-cols-2 xl:grid-cols-3")}>
      {groups.map((g) => (
        <Panel key={g.title} className="space-y-2">
          <p className="eyebrow">{g.title}</p>
          <dl className="divide-y divide-border/60">
            {g.items.map((i) => (
              <div key={i.label} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                <dt className="text-muted-foreground">{i.label}</dt>
                <dd className={cn("text-right font-medium tabular-nums", i.value == null && "font-normal text-muted-foreground")} title={i.value == null ? "Not available from the data provider" : undefined}>{statText(i, summary.quote.currency)}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      ))}
    </div>
  );
}

function Overview({ summary }: { summary: Summary }) {
  const q = summary.quote;
  const [more, setMore] = useState(false);
  const day: [string, string][] = [
    ["Open", q.open != null ? formatMoney(q.open, q.currency) : "–"],
    ["Day range", q.dayLow != null && q.dayHigh != null ? `${formatMoney(q.dayLow, q.currency)} – ${formatMoney(q.dayHigh, q.currency)}` : "–"],
    ["Previous close", q.previousClose != null ? formatMoney(q.previousClose, q.currency) : "–"],
    ["Volume", numText(q.volume, q.currency)],
    ["52-week range", q.yearLow != null && q.yearHigh != null ? `${formatMoney(q.yearLow, q.currency)} – ${formatMoney(q.yearHigh, q.currency)}` : "–"],
    ["Market cap", money(q.marketCap, q.currency, { compact: true })],
  ];
  return (
    <>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {day.map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3">
            <dt className="eyebrow">{k}</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {summary.notes.map((n) => <p key={n} className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-sm">{n}</p>)}
      <StatGroups summary={summary} except="Valuation" />
      {summary.profile && (
        <Panel className="space-y-3">
          <p className="eyebrow">About</p>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {[["Sector", summary.profile.sector], ["Industry", summary.profile.industry], ["Country", summary.profile.country], ["Employees", summary.profile.employees != null ? summary.profile.employees.toLocaleString("en-IN") : null]].map(([k, v]) => (
              <div key={k as string}><dt className="text-xs text-muted-foreground">{k}</dt><dd>{v ?? "–"}</dd></div>
            ))}
            {summary.profile.website && <div><dt className="text-xs text-muted-foreground">Website</dt><dd><a href={summary.profile.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">{summary.profile.website.replace(/^https?:\/\//, "")}<ExternalLink className="h-3 w-3" /></a></dd></div>}
          </dl>
          {summary.profile.summary && (
            <p className={cn("max-w-[75ch] text-sm leading-relaxed text-muted-foreground", !more && "line-clamp-3")}>{summary.profile.summary}</p>
          )}
          {summary.profile.summary && summary.profile.summary.length > 300 && <button onClick={() => setMore(!more)} className="cursor-pointer text-xs underline underline-offset-2">{more ? "Show less" : "Read more"}</button>}
        </Panel>
      )}
    </>
  );
}

// -------------------------------------------------------------- financials

const ROWS: [keyof Period, string, "money" | "eps"][] = [
  ["revenue", "Revenue", "money"],
  ["operatingIncome", "Operating income", "money"],
  ["netIncome", "Net income", "money"],
  ["eps", "EPS (diluted)", "eps"],
  ["totalAssets", "Total assets", "money"],
  ["totalLiabilities", "Total liabilities", "money"],
  ["equity", "Shareholders' equity", "money"],
  ["totalDebt", "Total debt", "money"],
  ["cash", "Cash", "money"],
  ["operatingCashFlow", "Operating cash flow", "money"],
  ["capex", "Capital expenditure", "money"],
  ["freeCashFlow", "Free cash flow", "money"],
];


function FinancialsTab({ symbol, tradingCurrency }: { symbol: string; tradingCurrency: string }) {
  const f = useResearch<Financials>(`/api/research/${encodeURIComponent(symbol)}?section=financials`);
  const [freq, setFreq] = useState<"annual" | "quarterly">("annual");
  if (f.loading) return <Loading />;
  if (f.error) return <ErrorState message={f.error} onRetry={f.retry} />;
  const d = f.env!.data;
  const periods = d[freq];
  const cur = d.currency;
  const step = freq === "quarterly" ? 4 : 1; // year on year: same quarter a year back
  const label = (p: Period) => (freq === "annual" ? `FY ${p.date.slice(0, 4)}` : new Date(`${p.date}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }));
  const chart = periods.map((p) => ({ name: label(p), Revenue: p.revenue, "Net income": p.netIncome }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {cur ? <>In {cur}, as reported{cur !== tradingCurrency ? <> (the shares trade in {tradingCurrency})</> : null}.</> : "Currency not given by the provider."} Growth figures are worked out by VAULT from these numbers.
        </p>
        <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
          {(["annual", "quarterly"] as const).map((v) => (
            <button key={v} role="radio" aria-checked={freq === v} onClick={() => setFreq(v)} className={cn("h-7 cursor-pointer rounded-md px-3 transition-colors", freq === v ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>{v === "annual" ? "Annual" : "Quarterly"}</button>
          ))}
        </div>
      </div>
      <StaleNote env={f.env} />
      {periods.length === 0 ? <Unavailable>No {freq} statements from the data provider for this company.</Unavailable> : (
        <>
          <Panel>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chart} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" {...AXIS} />
                <YAxis {...AXIS} width={70} tickFormatter={(v) => money(Number(v), cur, { compact: true })} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v, n) => [money(Number(v), cur, { compact: true }), String(n)]} />
                <RLegend wrapperStyle={{ fontSize: 12 }} iconType="square" iconSize={8} />
                <Bar dataKey="Revenue" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="Net income" fill="var(--series-3)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel padded={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                    <th className="sticky left-0 bg-card py-2.5 pr-3 pl-4 text-left font-medium">{cur ?? ""}</th>
                    {periods.map((p) => <th key={p.date} className="px-3 py-2.5 text-right font-medium whitespace-nowrap">{label(p)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.filter(([k]) => periods.some((p) => p[k] != null)).map(([k, l, kind]) => (
                    <tr key={k} className="border-b border-border/60 last:border-0">
                      <td className="sticky left-0 bg-card py-2 pr-3 pl-4 text-muted-foreground whitespace-nowrap">{l}</td>
                      {periods.map((p) => <td key={p.date} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{p[k] == null ? "–" : kind === "eps" ? money(p[k] as number, cur) : money(p[k] as number, cur, { compact: true })}</td>)}
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-muted/30">
                    <td className="sticky left-0 bg-muted/30 py-2 pr-3 pl-4 text-muted-foreground whitespace-nowrap">Net margin</td>
                    {periods.map((p) => <td key={p.date} className="px-3 py-2 text-right tabular-nums">{p.netIncome != null && p.revenue ? `${((p.netIncome / p.revenue) * 100).toFixed(1)}%` : "–"}</td>)}
                  </tr>
                  {(["revenue", "netIncome"] as const).map((k) => (
                    <tr key={`g-${k}`} className="bg-muted/30">
                      <td className="sticky left-0 bg-muted/30 py-2 pr-3 pl-4 text-muted-foreground whitespace-nowrap">{k === "revenue" ? "Revenue" : "Net income"} growth, year on year</td>
                      {periods.map((p, i) => {
                        const g = i >= step ? growth(p[k], periods[i - step][k]) : null;
                        return <td key={p.date} className={cn("px-3 py-2 text-right tabular-nums", tone(g))}>{pctText(g)}</td>;
                      })}
                    </tr>
                  ))}
                  {freq === "quarterly" && (
                    <tr className="bg-muted/30">
                      <td className="sticky left-0 bg-muted/30 py-2 pr-3 pl-4 text-muted-foreground whitespace-nowrap">Revenue growth, quarter on quarter</td>
                      {periods.map((p, i) => {
                        const g = i >= 1 ? growth(p.revenue, periods[i - 1].revenue) : null;
                        return <td key={p.date} className={cn("px-3 py-2 text-right tabular-nums", tone(g))}>{pctText(g)}</td>;
                      })}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
          <p className="text-xs text-muted-foreground">A dash means the provider didn&apos;t report that figure for the period. Year-on-year growth needs the same period a year earlier in this table.</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- earnings

function EarningsTab({ symbol }: { symbol: string }) {
  const e = useResearch<Earnings>(`/api/research/${encodeURIComponent(symbol)}?section=earnings`);
  if (e.loading) return <Loading />;
  if (e.error) return <ErrorState message={e.error} onRetry={e.retry} />;
  const d = e.env!.data;
  return (
    <div className="space-y-4">
      <StaleNote env={e.env} />
      {d.next?.date ? (
        <Panel className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div><p className="eyebrow">Next earnings</p><p className="mt-1 text-lg font-semibold">{formatDateTime(d.next.date, { day: "numeric", month: "short", year: "numeric" })}</p><p className="text-xs text-muted-foreground">{d.next.isEstimate ? "Estimated date" : "Confirmed date"}</p></div>
          <div><p className="eyebrow">EPS estimate</p><p className="mt-1 text-lg font-semibold tabular-nums">{money(d.next.epsAvg, d.next.currency)}</p>{d.next.epsLow != null && d.next.epsHigh != null && <p className="text-xs text-muted-foreground tabular-nums">range {money(d.next.epsLow, d.next.currency)} – {money(d.next.epsHigh, d.next.currency)}</p>}</div>
          <div><p className="eyebrow">Revenue estimate</p><p className="mt-1 text-lg font-semibold tabular-nums">{money(d.next.revenueAvg, d.next.currency, { compact: true })}</p></div>
        </Panel>
      ) : <Unavailable>No upcoming earnings date from the data provider.</Unavailable>}
      <Panel padded={false} className="overflow-hidden">
        <p className="eyebrow px-4 pt-4">Recent quarters: earnings per share</p>
        {d.history.length === 0 ? <div className="p-4"><Unavailable /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-[11px] tracking-[0.06em] text-muted-foreground uppercase"><th className="py-2.5 pr-3 pl-4 text-left font-medium">Quarter ended</th><th className="px-3 text-right font-medium">Actual</th><th className="px-3 text-right font-medium">Estimate</th><th className="pr-4 pl-3 text-right font-medium">Surprise</th></tr></thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.quarter} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 pl-4">{formatDate(h.quarter, { month: "short", year: "numeric" })}</td>
                    <td className="px-3 text-right tabular-nums">{money(h.epsActual, h.currency)}</td>
                    <td className="px-3 text-right tabular-nums text-muted-foreground">{money(h.epsEstimate, h.currency)}</td>
                    <td className={cn("pr-4 pl-3 text-right tabular-nums", tone(h.surprisePct))}>{pctText(h.surprisePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {d.estimates.length > 0 && (
        <Panel padded={false} className="overflow-hidden">
          <p className="eyebrow px-4 pt-4">Analyst estimates</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="border-b border-border text-[11px] tracking-[0.06em] text-muted-foreground uppercase"><th className="py-2.5 pr-3 pl-4 text-left font-medium">Period</th><th className="px-3 text-right font-medium">EPS</th><th className="px-3 text-right font-medium">Revenue</th><th className="px-3 text-right font-medium">EPS growth</th><th className="pr-4 pl-3 text-right font-medium">Analysts</th></tr></thead>
              <tbody>
                {d.estimates.map((t) => (
                  <tr key={t.period} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 pl-4">{t.period}{t.endDate && <span className="block text-xs text-muted-foreground">to {formatDate(t.endDate, { month: "short", year: "numeric" })}</span>}</td>
                    <td className="px-3 text-right tabular-nums">{money(t.epsAvg, t.currency)}</td>
                    <td className="px-3 text-right tabular-nums">{money(t.revenueAvg, t.currency, { compact: true })}</td>
                    <td className={cn("px-3 text-right tabular-nums", tone(t.growth))}>{pctText(t.growth)}</td>
                    <td className="pr-4 pl-3 text-right tabular-nums text-muted-foreground">{t.analysts ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// --------------------------------------------------------------- ownership

function HoldersTable({ title, rows, currency }: { title: string; rows: Ownership["institutions"]; currency: string }) {
  return (
    <Panel padded={false} className="overflow-hidden">
      <p className="eyebrow px-4 pt-4">{title}</p>
      {rows.length === 0 ? <div className="p-4"><Unavailable>Not reported by the data provider for this company (common outside the US).</Unavailable></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-[11px] tracking-[0.06em] text-muted-foreground uppercase"><th className="py-2.5 pr-3 pl-4 text-left font-medium">Holder</th><th className="px-3 text-right font-medium">Of shares</th><th className="px-3 text-right font-medium">Shares</th><th className="pr-4 pl-3 text-right font-medium">Reported</th></tr></thead>
            <tbody>{rows.map((h) => <tr key={h.name} className="border-b border-border/60 last:border-0"><td className="py-2 pr-3 pl-4">{h.name}</td><td className="px-3 text-right tabular-nums">{h.pctHeld != null ? `${h.pctHeld.toFixed(2)}%` : "–"}</td><td className="px-3 text-right tabular-nums">{numText(h.shares, currency)}</td><td className="pr-4 pl-3 text-right text-muted-foreground">{h.reportDate ? formatDate(h.reportDate) : "–"}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function OwnershipTab({ symbol, currency }: { symbol: string; currency: string }) {
  const o = useResearch<Ownership>(`/api/research/${encodeURIComponent(symbol)}?section=ownership`);
  if (o.loading) return <Loading />;
  if (o.error) return <ErrorState message={o.error} onRetry={o.retry} />;
  const d = o.env!.data;
  const stats: [string, string][] = [["Held by insiders", d.insidersPct != null ? `${d.insidersPct.toFixed(1)}%` : "–"], ["Held by institutions", d.institutionsPct != null ? `${d.institutionsPct.toFixed(1)}%` : "–"], ["Institutions, of free float", d.institutionsFloatPct != null ? `${d.institutionsFloatPct.toFixed(1)}%` : "–"], ["Number of institutions", d.institutionsCount != null ? d.institutionsCount.toLocaleString("en-IN") : "–"]];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Who owns the company, from public filings. This isn&apos;t about your own VAULT holdings.</p>
      <StaleNote env={o.env} />
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
        {stats.map(([k, v]) => <div key={k} className="bg-card px-4 py-3"><dt className="eyebrow">{k}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{v}</dd></div>)}
      </dl>
      <div className="grid gap-4 xl:grid-cols-2">
        <HoldersTable title="Top institutions" rows={d.institutions} currency={currency} />
        <HoldersTable title="Top funds" rows={d.funds} currency={currency} />
      </div>
      <Panel padded={false} className="overflow-hidden">
        <p className="eyebrow px-4 pt-4">Insider transactions</p>
        {d.insiderTrades.length === 0 ? <div className="p-4"><Unavailable /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-border text-[11px] tracking-[0.06em] text-muted-foreground uppercase"><th className="py-2.5 pr-3 pl-4 text-left font-medium">Date</th><th className="px-3 text-left font-medium">Insider</th><th className="px-3 text-left font-medium">Transaction</th><th className="pr-4 pl-3 text-right font-medium">Shares</th></tr></thead>
              <tbody>{d.insiderTrades.map((t, i) => <tr key={i} className="border-b border-border/60 last:border-0"><td className="py-2 pr-3 pl-4 whitespace-nowrap text-muted-foreground">{t.date ? formatDate(t.date) : "–"}</td><td className="px-3">{t.name}{t.relation && <span className="block text-xs text-muted-foreground">{t.relation}</span>}</td><td className="px-3 text-muted-foreground">{t.text ?? "–"}</td><td className="pr-4 pl-3 text-right tabular-nums">{numText(t.shares, currency)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="px-4 pb-3 text-xs text-muted-foreground">Values aren&apos;t shown: for companies listed in two countries the filings can be in a different currency from the share price.</p>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- analysts

const REC: [keyof NonNullable<Analysts["recommendation"]>, string, string][] = [
  ["strongBuy", "Strong buy", "bg-positive"],
  ["buy", "Buy", "bg-positive/60"],
  ["hold", "Hold", "bg-muted-foreground/40"],
  ["sell", "Sell", "bg-negative/60"],
  ["strongSell", "Strong sell", "bg-negative"],
];

function AnalystsTab({ symbol, price }: { symbol: string; price: number | null }) {
  const a = useResearch<Analysts>(`/api/research/${encodeURIComponent(symbol)}?section=analysts`);
  const total = useMemo(() => (a.env ? REC.reduce((t, [k]) => t + Number(a.env!.data.recommendation?.[k] ?? 0), 0) : 0), [a.env]);
  if (a.loading) return <Loading />;
  if (a.error) return <ErrorState message={a.error} onRetry={a.retry} />;
  const d = a.env!.data;
  const t = d.targets;
  const pos = (v: number) => (t && t.high != null && t.low != null && t.high > t.low ? Math.min(100, Math.max(0, ((v - t.low) / (t.high - t.low)) * 100)) : 50);
  return (
    <div className="space-y-4">
      <StaleNote env={a.env} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="space-y-3">
          <p className="eyebrow">Recommendations{d.recommendation ? ` · ${total} analysts, ${d.recommendation.period.toLowerCase()}` : ""}</p>
          {!d.recommendation || total === 0 ? <Unavailable /> : (
            <>
              {d.consensus && <p className="text-lg font-semibold capitalize">{d.consensus.replace(/_/g, " ")}</p>}
              <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={REC.map(([k, l]) => `${l} ${d.recommendation![k]}`).join(", ")}>
                {REC.map(([k, , c]) => (Number(d.recommendation![k]) ? <div key={k} className={cn("h-full border-r-2 border-card last:border-0", c)} style={{ width: `${(Number(d.recommendation![k]) / total) * 100}%` }} /> : null))}
              </div>
              <ul className="grid grid-cols-5 gap-1 text-center text-xs">
                {REC.map(([k, l, c]) => <li key={k}><span className={cn("mx-auto mb-1 block h-2 w-2 rounded-full", c)} /><span className="block font-medium tabular-nums">{d.recommendation![k]}</span><span className="text-muted-foreground">{l}</span></li>)}
              </ul>
            </>
          )}
        </Panel>
        <Panel className="space-y-3">
          <p className="eyebrow">Price targets (12 months){t?.analysts ? ` · ${t.analysts} analysts` : ""}</p>
          {!t || t.mean == null ? <Unavailable /> : (
            <>
              <p className="flex items-baseline gap-2"><Target className="h-4 w-4 self-center text-muted-foreground" /><span className="text-lg font-semibold tabular-nums">{formatMoney(t.mean, t.currency)}</span><span className="text-sm text-muted-foreground">average{price != null && t.mean ? `, ${pctText(((t.mean - price) / price) * 100)} from today` : ""}</span></p>
              {t.low != null && t.high != null && (
                <div className="space-y-1.5 pt-2">
                  <div className="relative h-2 rounded-full bg-muted">
                    <span className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded bg-foreground" style={{ left: `${pos(t.mean)}%` }} title={`Average ${formatMoney(t.mean, t.currency)}`} />
                    {price != null && <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-brass" style={{ left: `${pos(price)}%` }} title={`Today ${formatMoney(price, t.currency)}`} />}
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground tabular-nums"><span>Low {formatMoney(t.low, t.currency)}</span><span>High {formatMoney(t.high, t.currency)}</span></div>
                  <p className="text-xs text-muted-foreground"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-brass align-middle" />Today&apos;s price · <span className="mx-1 inline-block h-3 w-0.5 bg-foreground align-middle" />Average target</p>
                </div>
              )}
            </>
          )}
        </Panel>
      </div>
      <Panel padded={false} className="overflow-hidden">
        <p className="eyebrow px-4 pt-4">Recent rating changes</p>
        {d.changes.length === 0 ? <div className="p-4"><Unavailable /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="border-b border-border text-[11px] tracking-[0.06em] text-muted-foreground uppercase"><th className="py-2.5 pr-3 pl-4 text-left font-medium">Date</th><th className="px-3 text-left font-medium">Firm</th><th className="pr-4 pl-3 text-left font-medium">Rating</th></tr></thead>
              <tbody>{d.changes.map((c, i) => <tr key={i} className="border-b border-border/60 last:border-0"><td className="py-2 pr-3 pl-4 whitespace-nowrap text-muted-foreground">{c.date ? formatDate(c.date) : "–"}</td><td className="px-3">{c.firm}</td><td className="pr-4 pl-3">{c.from && c.from !== c.to ? <span className="text-muted-foreground">{c.from} → </span> : null}{c.to ?? "–"}{c.action && <span className="ml-1 text-xs text-muted-foreground">({c.action})</span>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-xs text-muted-foreground">Analyst opinions as collected by the data provider. They aren&apos;t advice, and VAULT doesn&apos;t act on them.</p>
    </div>
  );
}

// -------------------------------------------------------------------- news

function NewsTab({ symbol }: { symbol: string }) {
  const n = useResearch<NewsItem[]>(`/api/research/${encodeURIComponent(symbol)}?section=news`);
  if (n.loading) return <Loading h="h-40" />;
  if (n.error) return <ErrorState message={n.error} onRetry={n.retry} />;
  const items = n.env!.data;
  return (
    <div className="space-y-3">
      <StaleNote env={n.env} />
      {items.length === 0 ? <Unavailable>No recent news from the data provider for this company.</Unavailable> : (
        <Panel padded={false}>
          <ul className="divide-y divide-border/70">
            {items.map((i) => (
              <li key={i.link}>
                <a href={i.link} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium group-hover:underline">{i.title}</span>
                    <span className="block text-xs text-muted-foreground">{[i.publisher, i.time ? formatDateTime(i.time) : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
