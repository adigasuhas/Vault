"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReportsPanel } from "@/components/analytics/ReportsPanel";
import { Button } from "@/components/ui/button";
import { FileJson } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/client";
import { formatCompactMoney, formatMoney } from "@/lib/currencies";
import { formatDate, ACCOUNT_TYPE_LABELS } from "@/lib/format";
import { monthLabel } from "@/lib/dates";
import { tooltipStyle } from "@/lib/chart-colors";
import { PageHeader, Panel, Section, Stat, EmptyState, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { StatusBadge, occurrenceStatus } from "@/components/app/StatusBadge";
import { Money } from "@/components/app/Money";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  Line,
  LineChart,
  ReferenceLine,
  Cell,
} from "recharts";
import type { Occurrence } from "@/lib/schedules";

interface Flow { month: string; income: number; expenses: number; regular: number; oneTime: number; net: number; savingsRate: number | null }
interface Data {
  baseCurrency: string;
  fxUnavailable: string[];
  months: string[];
  summary: { netWorth: number; cash: number; owed: number; loans: number; investments: number; totalIncome: number; totalExpenses: number; totalRegular: number; totalOneTime: number; saved: number; savingsRate: number | null; avgIncome: number; avgExpenses: number };
  flows: Flow[];
  categories: { id: string; name: string; total: number; byMonth: number[] }[];
  oneTimeGroups: { id: string; name: string; total: number; count: number }[];
  incomeSources: { name: string; value: number }[];
  adherence: { month: string; hasPlan: boolean; budgeted: number; spentInBudget: number; overCount: number; lines: { name: string; budgeted: number; spent: number }[] }[];
  accounts: { id: string; name: string; type: string; status: string; currency: string; balance: number; base: number; liability: boolean }[];
  assetAllocation: { name: string; value: number }[];
  upcoming: { actionable: Occurrence[]; scheduled: Occurrence[] };
  runway: {
    currentCash: number;
    monthlyIncome: number;
    monthlyCommitted: number;
    monthlyDiscretionary: number;
    monthlyNet: number;
    runwayMonths: number | null;
    runsOutMonth: string | null;
    basis: "recent-average" | "budget" | "this-month" | "none";
    projection: { month: string; cash: number; stress: number; income: number; outflow: number }[];
  };
  netWorthHistory: { month: string; netWorth: number; estimated: boolean }[];
}

const SECTIONS = [
  ["runway", "Runway"],
  ["income", "Income"],
  ["expenses", "Expenses"],
  ["savings", "Savings"],
  ["budget", "Budget"],
  ["balances", "Balances"],
  ["commitments", "Commitments"],
  ["trends", "Trends"],
] as const;

const short = (m: string) => monthLabel(m, "short").split(" ")[0];

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} /> {label}
        </span>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const search = useSearchParams();
  const router = useRouter();
  const tab = search.get("tab") === "reports" ? "reports" : "overview";
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (tab !== "overview") return;
    setError(null);
    setData(null);
    api<Data>(`/api/analytics?months=${months}`).then(setData).catch((e) => setError(e.message));
  }, [months, tab]);
  useEffect(load, [load]);

  const c = data?.baseCurrency ?? "INR";
  const money = (v: number) => formatMoney(Math.round(v), c);
  const axisMoney = (v: number) => formatCompactMoney(Number(v), c);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Analytics"
        description="Where your money comes from, where it goes and how long it lasts."
        actions={
          tab === "reports" ? (
            <Button variant="outline" asChild><a href="/api/account/export"><FileJson /> Everything (JSON)</a></Button>
          ) : (
          <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs shadow-card">
            {[3, 6, 12].map((n) => (
              <button key={n} role="radio" aria-checked={months === n} onClick={() => setMonths(n)} className={cn("h-8 cursor-pointer rounded-md px-3 transition-colors", months === n ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {n} months
              </button>
            ))}
          </div>
          )
        }
      />

      <div className="settle -mt-2 flex gap-1 border-b border-border" role="tablist">
        {(["overview", "reports"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => router.replace(t === "overview" ? "/analytics" : "/analytics?tab=reports", { scroll: false })}
            className={cn("relative -mb-px h-10 cursor-pointer px-3 text-sm transition-colors", tab === t ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {t === "overview" ? "Overview" : "Reports & exports"}
            {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brass" />}
          </button>
        ))}
      </div>

      {tab === "reports" ? <ReportsPanel /> : <>

      <nav aria-label="Analytics sections" className="sticky top-14 z-20 -mx-4 overflow-x-auto border-y border-border bg-background/90 px-4 backdrop-blur-md md:top-14 md:-mx-8 md:px-8">
        <ul className="flex gap-5 text-[13px] whitespace-nowrap">
          {SECTIONS.map(([id, label]) => (
            <li key={id}><a href={`#${id}`} className="block py-2.5 text-muted-foreground transition-colors hover:text-foreground">{label}</a></li>
          ))}
        </ul>
      </nav>

      {error && <ErrorState message={error} onRetry={load} />}
      {!data && !error && (
        <div className="space-y-6"><SkeletonBlock className="h-36" /><SkeletonBlock className="h-72" /><SkeletonBlock className="h-72" /></div>
      )}

      {data && (
        <>
          {data.fxUnavailable.length > 0 && (
            <p className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-warning">No exchange rate for {data.fxUnavailable.join(", ")}; converted 1:1.</p>
          )}

          {/* Overview */}
          <Panel className="settle overflow-hidden p-0">
            <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-card p-5"><Stat label="Net worth" value={money(data.summary.netWorth)} hint={`Cash ${money(data.summary.cash)} · invested ${money(data.summary.investments)}${data.summary.loans > 0 ? ` · loans −${money(data.summary.loans)}` : ""}`} /></div>
              <div className="bg-card p-5"><Stat label={`Income · ${months} mo`} value={money(data.summary.totalIncome)} hint={`~${money(data.summary.avgIncome)} a month`} /></div>
              <div className="bg-card p-5"><Stat label={`Spending · ${months} mo`} value={money(data.summary.totalExpenses)} hint={`~${money(data.summary.avgExpenses)} a month`} /></div>
              <div className="bg-card p-5"><Stat label="Kept" value={<span className={data.summary.saved < 0 ? "text-negative" : ""}>{money(data.summary.saved)}</span>} hint={data.summary.savingsRate != null ? `${data.summary.savingsRate}% of income` : "No income in period"} /></div>
            </div>
          </Panel>

          {/* Runway */}
          <Section id="runway" title="Cash runway" description="Your cash projected forward from scheduled income and payments plus recent day-to-day spending.">
            <Panel>
              <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
                <div className="space-y-5">
                  <div>
                    <p className="eyebrow">Runway</p>
                    <p className="mt-1.5 font-display text-[2.4rem] leading-none">
                      {data.runway.runwayMonths == null ? (data.runway.monthlyNet >= 0 ? "Covered" : "–") : data.runway.runwayMonths >= 18 ? "18+" : data.runway.runwayMonths.toFixed(1)}
                      {data.runway.runwayMonths != null && <span className="ml-2 text-lg text-muted-foreground">months</span>}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {data.runway.runsOutMonth
                        ? `Cash runs short around ${monthLabel(data.runway.runsOutMonth)}.`
                        : data.runway.monthlyNet >= 0
                          ? "Scheduled income covers your typical month."
                          : "Doesn't run out within 18 months."}
                    </p>
                  </div>
                  <dl className="space-y-2 border-t border-border pt-4 text-sm">
                    {[
                      ["Cash today", data.runway.currentCash],
                      ["Scheduled income / mo", data.runway.monthlyIncome],
                      ["Scheduled payments / mo", -data.runway.monthlyCommitted],
                      ["Other spending / mo", -data.runway.monthlyDiscretionary],
                    ].map(([l, v]) => (
                      <div key={l as string} className="flex justify-between gap-3"><dt className="text-muted-foreground">{l}</dt><dd className="tabular-nums">{money(v as number)}</dd></div>
                    ))}
                    <div className="flex justify-between gap-3 border-t border-border pt-2 font-medium"><dt>Net per month</dt><dd><Money value={Math.round(data.runway.monthlyNet)} currency={c} signed /></dd></div>
                  </dl>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {data.runway.basis === "recent-average" ? "Other spending is your average over the last three full months, not counting scheduled payments." : data.runway.basis === "budget" ? "No spending history yet, so other spending uses this month's budget." : data.runway.basis === "this-month" ? "No full month of spending yet, so other spending is this month's spending so far at its current pace." : "No spending history or budget yet, so other spending is assumed zero."}{" "}
                    Pending items count in the first month.
                  </p>
                </div>
                <div>
                  <Legend items={[["Projected cash", "var(--series-1)"], ["If income comes in 25% short", "var(--muted-foreground)"]]} />
                  <ResponsiveContainer width="100%" height={280} className="mt-3">
                    <AreaChart data={data.runway.projection.map((p) => ({ ...p, label: monthLabel(p.month, "short") }))} margin={{ left: 4, right: 8, top: 8 }}>
                      <defs>
                        <linearGradient id="rw" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0" stopColor="var(--series-1)" stopOpacity={0.22} />
                          <stop offset="1" stopColor="var(--series-1)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" interval="preserveStartEnd" minTickGap={24} />
                      <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" width={64} tickFormatter={axisMoney} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [money(Number(v)), n === "cash" ? "Projected cash" : "Income 25% short"]} />
                      <ReferenceLine y={0} stroke="var(--negative)" strokeDasharray="3 3" />
                      <Area type="linear" dataKey="cash" stroke="var(--series-1)" strokeWidth={2} fill="url(#rw)" isAnimationActive={false} />
                      <Line type="linear" dataKey="stress" stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Panel>
          </Section>

          {/* Income */}
          <Section id="income" title="Income" description="Money that actually arrived. Scheduled income counts once you confirm it.">
            <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <Panel>
                <Legend items={[["Income", "var(--series-1)"], ["Spending", "var(--series-2)"]]} />
                <ResponsiveContainer width="100%" height={240} className="mt-3">
                  <BarChart data={data.flows.map((f) => ({ ...f, label: short(f.month) }))} barGap={2} barCategoryGap="26%">
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" width={60} tickFormatter={axisMoney} />
                    <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} />
                    <Bar dataKey="income" name="Income" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="expenses" name="Spending" fill="var(--series-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
              <Panel>
                <p className="text-sm font-medium">By source</p>
                {data.incomeSources.length === 0 ? (
                  <p className="mt-6 text-sm text-muted-foreground">No income booked in this period.</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {data.incomeSources.slice(0, 7).map((s) => (
                      <li key={s.name}>
                        <div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate">{s.name}</span><span className="tabular-nums">{money(s.value)}</span></div>
                        <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${(s.value / data.incomeSources[0].value) * 100}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </Section>

          {/* Expenses */}
          <Section id="expenses" title="Expenses" description={`Monthly spending includes scheduled payments and EMIs. One-time purchases are counted separately. Removed and reversed entries are excluded.`}>
            {(() => {
              const cur = data.flows[data.flows.length - 1];
              const cells: [string, number, number][] = [
                ["Monthly", cur?.regular ?? 0, data.summary.totalRegular],
                ["One-time", cur?.oneTime ?? 0, data.summary.totalOneTime],
                ["Total", cur?.expenses ?? 0, data.summary.totalExpenses],
              ];
              return (
                <div className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border">
                  {cells.map(([label, now, period], i) => (
                    <div key={label} className="bg-card px-4 py-3.5">
                      <p className="text-xs text-muted-foreground">{label} · this month</p>
                      <p className={`mt-1 text-lg tabular-nums ${i === 2 ? "font-semibold" : "font-medium"}`}>{money(now)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{money(period)} over {months} mo</p>
                    </div>
                  ))}
                </div>
              );
            })()}
            <Panel>
              <p className="mb-3 text-sm font-medium">Monthly spending by category</p>
              {data.categories.length === 0 ? (
                <EmptyState title="No spending in this period" />
              ) : (
                <ul className="space-y-2.5">
                  {data.categories.slice(0, 12).map((cat) => {
                    const share = data.summary.totalRegular > 0 ? (cat.total / data.summary.totalRegular) * 100 : 0;
                    return (
                      <li key={cat.id} className="grid grid-cols-[minmax(110px,180px)_1fr_auto] items-center gap-3 text-sm">
                        <span className="truncate">{cat.name}</span>
                        <div className="h-2.5 rounded-[3px] bg-muted"><div className="h-full rounded-[3px] bg-[var(--series-2)]" style={{ width: `${(cat.total / data.categories[0].total) * 100}%` }} /></div>
                        <span className="w-36 text-right tabular-nums">{money(cat.total)} <span className="text-xs text-muted-foreground">{share.toFixed(0)}%</span></span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
            {data.oneTimeGroups.length > 0 && (
              <Panel className="mt-4">
                <p className="mb-3 text-sm font-medium">One-time purchases</p>
                <ul className="divide-y divide-border text-sm">
                  {data.oneTimeGroups.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="truncate">{g.id === "_none" ? <span className="text-muted-foreground">{g.name}</span> : g.name}</span>
                      <span className="tabular-nums">{money(g.total)} <span className="text-xs text-muted-foreground">· {g.count} {g.count === 1 ? "purchase" : "purchases"}</span></span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </Section>

          {/* Savings */}
          <Section id="savings" title="Savings" description="Income minus spending each month. The current month is still in progress.">
            <Panel>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.flows.map((f) => ({ ...f, label: short(f.month) }))} barCategoryGap="30%">
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" width={60} tickFormatter={axisMoney} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={tooltipStyle} formatter={(v) => [money(Number(v)), "Kept"]} />
                  <Bar dataKey="net" radius={[4, 4, 4, 4]} isAnimationActive={false}>
                    {data.flows.map((f) => <Cell key={f.month} fill={f.net >= 0 ? "var(--positive)" : "var(--negative)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs sm:grid-cols-6" style={{ gridTemplateColumns: `repeat(${data.flows.length}, minmax(0, 1fr))` }}>
                {data.flows.map((f) => (
                  <div key={f.month} className="text-center">
                    <p className="text-muted-foreground">{short(f.month)}</p>
                    <p className={cn("tabular-nums", f.savingsRate != null && f.savingsRate < 0 && "text-negative")}>{f.savingsRate == null ? "–" : `${f.savingsRate}%`}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </Section>

          {/* Budget adherence */}
          <Section id="budget" title="Budget adherence" description="Spending in budgeted categories against what was planned, month by month.">
            <Panel padded={false} className="divide-y divide-border">
              {data.adherence.map((m) => {
                const pct = m.budgeted > 0 ? (m.spentInBudget / m.budgeted) * 100 : 0;
                return (
                  <div key={m.month} className="grid items-center gap-3 px-5 py-3 text-sm sm:grid-cols-[110px_1fr_220px]">
                    <span className="font-medium">{monthLabel(m.month, "short")}</span>
                    {m.hasPlan && m.budgeted > 0 ? (
                      <div className="relative h-2.5 rounded-[3px] bg-muted">
                        <div className={cn("h-full rounded-[3px]", pct > 100 ? "bg-negative" : pct > 90 ? "bg-warning" : "bg-foreground/60")} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{m.hasPlan ? "Plan has no amounts" : "No budget set"}</span>
                    )}
                    <span className="text-right text-xs text-muted-foreground tabular-nums">
                      {m.hasPlan && m.budgeted > 0 && <>{money(m.spentInBudget)} / {money(m.budgeted)} · {pct.toFixed(0)}%{m.overCount > 0 && <span className="text-negative"> · {m.overCount} over</span>}</>}
                    </span>
                  </div>
                );
              })}
            </Panel>
          </Section>

          {/* Balances */}
          <Section id="balances" title="Account balances & net worth" description="Today's balances in your base currency, and net worth at each month-end.">
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel padded={false}>
                <ul className="divide-y divide-border">
                  {data.accounts.map((a) => (
                    <li key={a.id}>
                      <Link href={`/accounts/${a.id}`} className="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-muted/50">
                        <span className="min-w-0 flex-1 truncate">{a.name} <span className="text-xs text-muted-foreground">· {ACCOUNT_TYPE_LABELS[a.type] ?? a.type}{a.status === "ARCHIVED" ? " · archived" : ""}</span></span>
                        <Money value={a.balance} currency={a.currency} tone={a.balance < 0 ? "negative" : undefined} equivalent="below" />
                      </Link>
                    </li>
                  ))}
                </ul>
                {data.assetAllocation.length > 0 && (
                  <div className="border-t border-border px-5 py-4">
                    <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-[3px]">
                      {data.assetAllocation.map((a, i) => (
                        <div key={a.name} title={`${a.name}: ${money(a.value)}`} style={{ flex: a.value, background: `var(--series-${i + 1})` }} />
                      ))}
                    </div>
                    <div className="mt-2.5"><Legend items={data.assetAllocation.map((a, i) => [`${a.name} ${money(a.value)}`, `var(--series-${i + 1})`])} /></div>
                  </div>
                )}
              </Panel>
              <Panel>
                <p className="text-sm font-medium">Net worth</p>
                <ResponsiveContainer width="100%" height={220} className="mt-3">
                  <LineChart data={data.netWorthHistory.map((p) => ({ ...p, label: short(p.month) }))}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" width={64} tickFormatter={axisMoney} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, item) => [money(Number(v)), (item?.payload as { estimated?: boolean })?.estimated ? "Net worth (reconstructed)" : "Net worth"]} />
                    <Line type="linear" dataKey="netWorth" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: "var(--card)" }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="mt-2 text-[11px] text-muted-foreground">Months without a daily snapshot are reconstructed from the ledger, with investments at cost.</p>
              </Panel>
            </div>
          </Section>

          {/* Commitments */}
          <Section id="commitments" title="Upcoming commitments" description="The next 60 days of scheduled income and payments, plus anything waiting for you.">
            <Panel padded={false}>
              {data.upcoming.actionable.length + data.upcoming.scheduled.length === 0 ? (
                <div className="p-5"><EmptyState title="Nothing scheduled in the next 60 days" action={<Link className="text-sm underline" href="/receivables?new=1">Schedule income</Link>} /></div>
              ) : (
                <ul className="divide-y divide-border">
                  {[...data.upcoming.actionable, ...data.upcoming.scheduled].map((o) => {
                    const st = occurrenceStatus(o.status, o.direction);
                    return (
                      <li key={`${o.scheduleId}-${o.occurrenceDate}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                        <span className="w-20 font-mono text-xs text-muted-foreground">{formatDate(o.date, { day: "2-digit", month: "short" })}</span>
                        <span className="min-w-0 flex-1 truncate">{o.scheduleName}</span>
                        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                        <Money value={o.direction === "INCOME" ? o.amount : -o.amount} currency={o.currency} signed tone={o.direction === "INCOME" ? "positive" : "plain"} className="w-28 text-right" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </Section>

          {/* Trends */}
          <Section id="trends" title="Spending trends" description="Your top categories month by month. Darker means more. The last column compares this month with your average.">
            <Panel padded={false} className="overflow-x-auto">
              {data.categories.length === 0 ? (
                <div className="p-5"><EmptyState title="Not enough spending yet" /></div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                      <th className="px-5 py-2.5 text-left font-medium">Category</th>
                      {data.months.map((m) => <th key={m} className="px-2 py-2.5 text-right font-medium">{short(m)}</th>)}
                      <th className="px-5 py-2.5 text-right font-medium">vs avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.categories.slice(0, 8).map((cat) => {
                      const max = Math.max(...cat.byMonth, 1);
                      const prior = cat.byMonth.slice(0, -1);
                      const avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;
                      const last = cat.byMonth[cat.byMonth.length - 1];
                      const delta = avg > 0 ? ((last - avg) / avg) * 100 : null;
                      return (
                        <tr key={cat.id} className="border-b border-border/60 last:border-0">
                          <td className="px-5 py-2.5">{cat.name}</td>
                          {cat.byMonth.map((v, i) => (
                            <td key={i} className="px-1 py-1.5 text-right">
                              <span
                                className="block rounded-[4px] px-1.5 py-1 text-xs tabular-nums"
                                style={{ background: v > 0 ? `color-mix(in oklab, var(--series-2) ${Math.round(8 + (v / max) * 42)}%, transparent)` : undefined }}
                                title={money(v)}
                              >
                                {v > 0 ? formatCompactMoney(v, c) : "·"}
                              </span>
                            </td>
                          ))}
                          <td className={cn("px-5 py-2.5 text-right text-xs tabular-nums", delta != null && delta > 15 ? "text-negative" : delta != null && delta < -15 ? "text-positive" : "text-muted-foreground")}>
                            {delta == null ? "–" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Panel>
          </Section>
        </>
      )}
      </>}
    </div>
  );
}
