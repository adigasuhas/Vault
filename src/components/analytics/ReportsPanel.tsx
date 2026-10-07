"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, localMonth } from "@/lib/client";
import { formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { shiftMonth } from "@/lib/dates";
import { Panel, EmptyState, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Report, ReportType } from "@/lib/reports";

const REPORTS: { type: ReportType; title: string; blurb: string; group: string; needsAccount?: boolean; optionalAccount?: boolean }[] = [
  { type: "summary", title: "Income & expense summary", blurb: "Month by month: in, out, net and savings rate.", group: "Overview" },
  { type: "cashflow", title: "Cash-flow history", blurb: "Opening and closing cash each month, with inflows and outflows.", group: "Overview" },
  { type: "savings", title: "Savings", blurb: "What you kept each month and the running total.", group: "Overview" },
  { type: "categories", title: "Monthly spending by category", blurb: "Totals, shares and monthly averages per category, one-offs left out.", group: "Spending" },
  { type: "one_time", title: "One-time purchases", blurb: "Every one-off purchase, by group, with what it cost.", group: "Spending" },
  { type: "budget", title: "Budget vs actual", blurb: "Every budget line against what was spent.", group: "Spending" },
  { type: "recurring", title: "Recurring income & payments", blurb: "Every scheduled payment and income, and what happened to each.", group: "Spending" },
  { type: "statement", title: "Account statement", blurb: "One account's entries with a running balance.", group: "Records", needsAccount: true },
  { type: "ledger", title: "Full ledger export", blurb: "Every entry, reversals included. For your records or a spreadsheet.", group: "Records", optionalAccount: true },
  { type: "activity", title: "Activity log", blurb: "Closures, reversals, removals, skips and edits.", group: "Records" },
];

function presets(today: string) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const fyStart = m >= 4 ? `${y}-04` : `${y - 1}-04`;
  return [
    { l: "This month", from: today, to: today },
    { l: "Last month", from: shiftMonth(today, -1), to: shiftMonth(today, -1) },
    { l: "Last 3 months", from: shiftMonth(today, -2), to: today },
    { l: "Last 12 months", from: shiftMonth(today, -11), to: today },
    { l: "This FY (Apr–Mar)", from: fyStart, to: today },
    { l: "Last FY", from: shiftMonth(fyStart, -12), to: shiftMonth(fyStart, -1) },
  ];
}

function cell(kind: string, v: string | number | null | undefined, currency: string) {
  if (v == null || v === "") return <span className="text-muted-foreground">–</span>;
  if (kind === "money" && typeof v === "number") return <span className={cn("tabular-nums", v < 0 && "text-negative")}>{formatMoney(Math.round(v * 100) / 100, currency)}</span>;
  if (kind === "pct" && typeof v === "number") return <span className="tabular-nums">{v.toFixed(1)}%</span>;
  if (kind === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return <span className="font-mono text-xs">{formatDate(v)}</span>;
  if (kind === "number") return <span className="tabular-nums">{v}</span>;
  return <>{v}</>;
}

export function ReportsPanel() {
  const search = useSearchParams();
  const today = localMonth();
  const [type, setType] = useState<ReportType>((search.get("type") as ReportType) || "summary");
  const [from, setFrom] = useState(shiftMonth(today, -5));
  const [to, setTo] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<{ id: string; name: string; status: string }[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const meta = REPORTS.find((r) => r.type === type)!;

  useEffect(() => {
    api<{ accounts: { id: string; name: string; status: string }[] }>("/api/accounts?includeClosed=1").then((d) => {
      setAccounts(d.accounts);
      setAccountId((a) => a || d.accounts.find((x) => x.status !== "CLOSED")?.id || "");
    });
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams({ from, to });
    if ((meta.needsAccount || meta.optionalAccount) && accountId && accountId !== "ALL") q.set("accountId", accountId);
    return q.toString();
  }, [from, to, accountId, meta]);

  const load = useCallback(async () => {
    if (meta.needsAccount && !accountId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api<{ report: Report }>(`/api/reports/${type}?${query}`);
      setReport(d.report);
    } catch (e) {
      setError((e as Error).message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [type, query, meta, accountId]);
  useEffect(() => {
    load();
  }, [load]);

  const groups = [...new Set(REPORTS.map((r) => r.group))];

  return (
    <div className="space-y-8">

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Reports" className="settle space-y-5">
          {groups.map((g) => (
            <div key={g}>
              <p className="eyebrow mb-2 px-2">{g}</p>
              <ul className="space-y-0.5">
                {REPORTS.filter((r) => r.group === g).map((r) => (
                  <li key={r.type}>
                    <button
                      onClick={() => setType(r.type)}
                      className={cn("w-full cursor-pointer rounded-lg px-3 py-2 text-left transition-colors", type === r.type ? "bg-card shadow-card ring-1 ring-border" : "hover:bg-muted")}
                    >
                      <span className={cn("block text-sm", type === r.type ? "font-medium" : "text-foreground/90")}>{r.title}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{r.blurb}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          <Panel className="settle space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {presets(today).map((p) => (
                <button
                  key={p.l}
                  onClick={() => { setFrom(p.from); setTo(p.to); }}
                  className={cn("h-8 cursor-pointer rounded-lg border px-3 text-xs transition-colors", from === p.from && to === p.to ? "border-foreground/40 bg-card font-medium shadow-card" : "border-border text-muted-foreground hover:text-foreground")}
                >
                  {p.l}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5"><Label htmlFor="r-from" className="text-xs">From</Label><Input id="r-from" type="month" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-40" /></div>
              <div className="space-y-1.5"><Label htmlFor="r-to" className="text-xs">To</Label><Input id="r-to" type="month" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-40" /></div>
              {(meta.needsAccount || meta.optionalAccount) && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Account</Label>
                  <Select value={accountId || "ALL"} onValueChange={setAccountId}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {meta.optionalAccount && <SelectItem value="ALL">All accounts</SelectItem>}
                      {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.status === "CLOSED" ? " (closed)" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="ml-auto flex gap-2">
                <Button variant="outline" asChild disabled={!report}><a href={`/api/reports/${type}?${query}&format=csv`}><Download /> CSV</a></Button>
                <Button asChild disabled={!report}><a href={`/api/reports/${type}?${query}&format=pdf`}><FileText /> PDF</a></Button>
              </div>
            </div>
          </Panel>

          {error && <ErrorState message={error} onRetry={load} />}
          {loading && !report && <SkeletonBlock className="h-80" />}
          {report && (
            <Panel padded={false} className={cn("settle overflow-hidden transition-opacity", loading && "opacity-60")}>
              <div className="border-b border-border px-6 py-5">
                <h2 className="font-display text-2xl leading-tight">{report.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{report.subtitle} · {report.currency}</p>
                {report.summary.length > 0 && (
                  <dl className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-4">
                    {report.summary.map((s) => (
                      <div key={s.label}>
                        <dt className="eyebrow">{s.label}</dt>
                        <dd className="mt-1 text-lg font-semibold">{cell(s.kind, s.value, report.currency)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              {report.rows.length === 0 ? (
                <div className="p-6"><EmptyState title="Nothing in this period">Try a wider range.</EmptyState></div>
              ) : (
                <div className="max-h-[560px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                        {report.columns.filter((c) => c.key !== "id").map((c) => (
                          <th key={c.key} className={cn("px-4 py-2.5 font-medium whitespace-nowrap", ["money", "pct", "number"].includes(c.kind) ? "text-right" : "text-left")}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.slice(0, 500).map((r, i) => (
                        <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                          {report.columns.filter((c) => c.key !== "id").map((c) => (
                            <td key={c.key} className={cn("px-4 py-2", ["money", "pct", "number"].includes(c.kind) ? "text-right" : "text-left", c.key === "description" || c.key === "summary" ? "max-w-[360px] truncate" : "whitespace-nowrap")}>
                              {cell(c.kind, r[c.key], report.currency)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {report.totals && (
                      <tfoot className="sticky bottom-0 bg-card">
                        <tr className="border-t-2 border-foreground/20 font-medium">
                          {report.columns.filter((c) => c.key !== "id").map((c) => (
                            <td key={c.key} className={cn("px-4 py-2.5", ["money", "pct", "number"].includes(c.kind) ? "text-right" : "text-left")}>
                              {report.totals![c.key] === "" ? null : cell(c.kind, report.totals![c.key], report.currency)}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                  {report.rows.length > 500 && <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Showing the first 500 of {report.rows.length} rows. The CSV and PDF include all of them.</p>}
                </div>
              )}
              {report.notes?.length ? <p className="border-t border-border px-6 py-3 text-xs text-muted-foreground">{report.notes.join(" ")}</p> : null}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
