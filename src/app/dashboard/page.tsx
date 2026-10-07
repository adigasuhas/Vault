"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/context/SessionContext";
import { api } from "@/lib/client";
import { formatCompactMoney, formatMoney } from "@/lib/currencies";
import { formatDate, ACCOUNT_TYPE_LABELS } from "@/lib/format";
import { monthLabel } from "@/lib/dates";
import { PageHeader, Panel, Section, Stat, EmptyState, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { Money } from "@/components/app/Money";
import { StatusBadge, occurrenceStatus } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, CalendarClock, Landmark, Plus } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from "recharts";
import type { Occurrence } from "@/lib/schedules";
import { Equivalent } from "@/components/app/Money";

interface Dash {
  currency: string;
  fxUnavailable: string[];
  netWorth: number;
  cash: number;
  owed: number;
  loans: number;
  investments: number;
  thisMonth: { month: string; income: number; expenses: number; regular: number; oneTime: number; net: number; savingsRate: number | null };
  trend: { month: string; income: number; expenses: number; net: number }[];
  accounts: { id: string; name: string; type: string; currency: string; balance: number; base: number; liability: boolean }[];
  budget: { month: string; currency: string; budgeted: number; spent: number; lines: { name: string; budgeted: number; spent: number }[] };
  actionable: (Occurrence & { baseAmount: number })[];
  upcoming: (Occurrence & { baseAmount: number })[];
  runway: { months: number | null; runsOutMonth: string | null; monthlyNet: number };
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { user } = useSession();
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<Dash>("/api/dashboard").then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) {
    return (
      <div className="space-y-6">
        <SkeletonBlock className="h-12 w-72" />
        <SkeletonBlock className="h-40" />
        <div className="grid gap-4 lg:grid-cols-3">
          <SkeletonBlock className="h-64 lg:col-span-2" />
          <SkeletonBlock className="h-64" />
        </div>
      </div>
    );
  }

  const c = data.currency;
  const m = data.thisMonth;
  const budgetPct = data.budget.budgeted > 0 ? Math.round((data.budget.spent / data.budget.budgeted) * 100) : null;
  const runwayText =
    data.runway.months == null ? (data.runway.monthlyNet >= 0 ? "Covered" : "–") : data.runway.months >= 18 ? "18+ months" : `${data.runway.months.toFixed(1)} months`;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        title={`${greeting()}${user?.name ? `, ${user.name.split(" ")[0]}` : ""}.`}
        actions={
          <>
            <Button variant="outline" asChild><Link href="/accounts?tab=transfers&new=1">Transfer</Link></Button>
            <Button asChild><Link href="/expenses?new=1"><Plus /> Log expense</Link></Button>
          </>
        }
      />

      {data.fxUnavailable.length > 0 && (
        <p className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-warning">
          No exchange rate yet for {data.fxUnavailable.join(", ")}, so those amounts are counted as is. <Link href="/settings" className="underline underline-offset-2">Set a rate</Link>.
        </p>
      )}

      {/* Position */}
      <Panel className="settle overflow-hidden p-0" >
        <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="col-span-2 bg-card p-6 md:col-span-1">
            <Stat large label="Net worth" value={<span className="inline-flex flex-wrap items-baseline gap-x-2">{formatMoney(Math.round(data.netWorth), c)}<Equivalent value={data.netWorth} currency={c} className="text-base" /></span>} hint={<>Cash {formatMoney(Math.round(data.cash), c)} · Investments {formatMoney(Math.round(data.investments), c)}{data.loans > 0 && <> · Loans −{formatMoney(Math.round(data.loans), c)}</>}</>} />
          </div>
          <div className="bg-card p-5 md:p-6">
            <Stat label={`In · ${monthLabel(m.month, "short")}`} value={<Money value={Math.round(m.income)} currency={c} />} hint="Income booked this month" />
          </div>
          <div className="bg-card p-5 md:p-6">
            <Stat label={`Out · ${monthLabel(m.month, "short")}`} value={<Money value={Math.round(m.expenses)} currency={c} />} hint={m.oneTime > 0 ? <>Monthly <Money value={Math.round(m.regular)} currency={c} /> · one-time <Money value={Math.round(m.oneTime)} currency={c} /></> : m.savingsRate == null ? "No income booked yet" : m.savingsRate >= 0 ? `You kept ${m.savingsRate}% of what came in` : "More went out than came in"} />
          </div>
          <Link href="/analytics#runway" className="group col-span-2 bg-card p-5 md:col-span-1 md:p-6 transition-colors hover:bg-muted/50">
            <Stat
              label={<span className="inline-flex items-center gap-1">Runway <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" /></span>}
              value={runwayText}
              hint={data.runway.runsOutMonth ? `Cash runs short ~${monthLabel(data.runway.runsOutMonth, "short")}` : data.runway.monthlyNet >= 0 ? "Scheduled income covers your spending" : "Based on schedules + recent spending"}
            />
          </Link>
        </div>
      </Panel>

      {/* Needs attention */}
      {data.actionable.length > 0 && (
        <Section title="Needs your attention" description="Due items waiting for you to confirm what actually happened.">
          <Panel padded={false} className="divide-y divide-border">
            {data.actionable.map((o) => {
              const st = occurrenceStatus(o.status, o.direction);
              return (
                <div key={`${o.scheduleId}-${o.occurrenceDate}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                    <p className="text-sm font-medium">{o.scheduleName}</p>
                    <p className="text-xs text-muted-foreground">Due {formatDate(o.date)}</p>
                  </div>
                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  <Money value={o.direction === "INCOME" ? o.amount : -o.amount} currency={o.currency} signed tone={o.direction === "INCOME" ? "positive" : "plain"} className="w-28 text-right text-sm font-medium" />
                  <Button size="sm" variant="outline" asChild>
                    <Link href={o.direction === "INCOME" ? "/receivables" : "/payments"}>Review</Link>
                  </Button>
                </div>
              );
            })}
          </Panel>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Section title="Six months of cash flow" actions={<Link href="/analytics" className="text-xs text-muted-foreground hover:text-foreground">Analytics →</Link>}>
          <Panel>
            {data.trend.every((t) => t.income === 0 && t.expenses === 0) ? (
              <EmptyState title="No income or spending booked yet">Log an expense or confirm a receivable and this fills in.</EmptyState>
            ) : (
              <>
                <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-[var(--series-1)]" /> In</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-[var(--series-2)]" /> Out</span>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.trend.map((t) => ({ ...t, label: monthLabel(t.month, "short").split(" ")[0] }))} barGap={3} barCategoryGap="28%">
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                    <Tooltip
                      cursor={{ fill: "var(--muted)" }}
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }}
                      formatter={(v) => formatMoney(Math.round(Number(v)), c)}
                    />
                    <Bar dataKey="income" name="In" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="expenses" name="Out" fill="var(--series-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </Panel>
        </Section>

        <Section title={`Budget · ${monthLabel(data.budget.month, "short")}`} actions={<Link href="/budget" className="text-xs text-muted-foreground hover:text-foreground">Budget →</Link>}>
          <Panel>
            {data.budget.budgeted === 0 && data.budget.lines.length === 0 ? (
              <EmptyState title="No budget this month" action={<Button size="sm" variant="outline" asChild><Link href="/budget">Plan the month</Link></Button>} />
            ) : (
              <div className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular-nums tracking-tight">{formatMoney(Math.round(data.budget.spent), data.budget.currency)}</span>
                  <span className="text-xs text-muted-foreground">of {formatMoney(Math.round(data.budget.budgeted), data.budget.currency)}{budgetPct != null ? ` · ${budgetPct}%` : ""}</span>
                </div>
                <ul className="space-y-3">
                  {data.budget.lines.map((l) => {
                    const pct = l.budgeted > 0 ? Math.min(100, (l.spent / l.budgeted) * 100) : 100;
                    const over = l.budgeted > 0 ? l.spent > l.budgeted : l.spent > 0;
                    return (
                      <li key={l.name}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="truncate">{l.name}{l.budgeted === 0 && <span className="text-muted-foreground"> · no budget</span>}</span>
                          <span className={over ? "text-negative tabular-nums" : "text-muted-foreground tabular-nums"}>{formatCompactMoney(l.spent, data.budget.currency)}{l.budgeted > 0 && ` / ${formatCompactMoney(l.budgeted, data.budget.currency)}`}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className={over ? "h-full bg-negative" : pct >= 90 && Math.round(l.spent) !== Math.round(l.budgeted) ? "h-full bg-warning" : "h-full bg-foreground/70"} style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Panel>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Coming up" description="Next scheduled income and payments." actions={<Link href="/receivables" className="text-xs text-muted-foreground hover:text-foreground">Schedules →</Link>}>
          <Panel padded={false}>
            {data.upcoming.length === 0 ? (
              <div className="p-5"><EmptyState icon={<CalendarClock className="h-5 w-5" />} title="Nothing scheduled in the next 60 days" action={<Button size="sm" variant="outline" asChild><Link href="/receivables?new=1">Schedule your stipend</Link></Button>} /></div>
            ) : (
              <ul className="divide-y divide-border">
                {data.upcoming.map((o) => (
                  <li key={`${o.scheduleId}-${o.occurrenceDate}`} className="flex items-center gap-4 px-5 py-3">
                    <div className="w-11 shrink-0 text-center">
                      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{formatDate(o.date, { month: "short" })}</p>
                      <p className="font-display text-xl leading-none">{formatDate(o.date, { day: "numeric" })}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{o.scheduleName}</p>
                      <p className="text-xs text-muted-foreground">{o.direction === "INCOME" ? "Income" : "Payment"}{o.overridden ? " · date adjusted" : ""}</p>
                    </div>
                    <Money value={o.direction === "INCOME" ? o.amount : -o.amount} currency={o.currency} signed tone={o.direction === "INCOME" ? "positive" : "plain"} className="text-sm font-medium" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Section>

        <Section title="Accounts" actions={<Link href="/accounts" className="text-xs text-muted-foreground hover:text-foreground">All accounts →</Link>}>
          <Panel padded={false}>
            {data.accounts.length === 0 ? (
              <div className="p-5"><EmptyState icon={<Landmark className="h-5 w-5" />} title="Add your first account" action={<Button size="sm" asChild><Link href="/accounts?new=1">Add account</Link></Button>}>Your bank account, a card, or the cash in your wallet.</EmptyState></div>
            ) : (
              <ul className="divide-y divide-border">
                {data.accounts.map((a) => (
                  <li key={a.id}>
                    <Link href={`/accounts/${a.id}`} className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{a.name}</p>
                        <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[a.type] ?? a.type}{a.currency !== c ? ` · ${a.currency}` : ""}</p>
                      </div>
                      <Money value={a.balance} currency={a.currency} tone={a.balance < 0 ? "negative" : undefined} equivalent="below" className="text-sm font-medium" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Section>
      </div>
    </div>
  );
}
