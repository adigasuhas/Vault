"use client";

import { useState } from "react";
import { Check, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dot, UNCATEGORISED, useCategories } from "@/components/investments/Categories";
import { cn } from "@/lib/utils";

const REPORTS = [
  { id: "portfolio", label: "Current portfolio", hint: "What you hold now and what it's worth. Not tied to dates.", dated: false },
  { id: "trades", label: "Executed trades", hint: "Purchases and sales made in the period, with realised profit or loss.", dated: true },
  { id: "transactions", label: "Investment transactions", hint: "Trades plus account payments, proceeds, reinvestments and undone sales.", dated: true },
  { id: "categories", label: "Category-wise portfolio", hint: "Holdings grouped by category or client, with realised P/L for the period.", dated: true },
  { id: "performance", label: "Portfolio performance", hint: "Value at start and end, money added, gain and return for the period.", dated: true },
] as const;
type ReportId = (typeof REPORTS)[number]["id"];

const TYPES = [
  ["STOCK", "Stocks"],
  ["MUTUAL_FUND", "Mutual funds"],
  ["FIXED_DEPOSIT", "Deposits"],
  ["OTHER", "Other assets"],
] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);

const chip = (on: boolean) =>
  cn(
    "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
    on ? "border-foreground/40 bg-foreground/[0.06] font-medium text-foreground" : "border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground"
  );

/** Download investment reports as PDF or CSV (see /api/investments/reports). */
export function ExportDialog({ open, onOpenChange, defaultCategory }: { open: boolean; onOpenChange: (o: boolean) => void; defaultCategory?: string }) {
  const ctx = useCategories();
  // Fixed when the dialog mounts, so renders stay pure.
  const [now] = useState(() => Date.now());
  const today = iso(new Date(now));
  const [type, setType] = useState<ReportId>("portfolio");
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [kinds, setKinds] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>(defaultCategory ? [defaultCategory] : []);
  const [format, setFormat] = useState<"pdf" | "csv">("pdf");
  const [busy, setBusy] = useState(false);
  const [shownFor, setShownFor] = useState(open);
  if (open !== shownFor) {
    setShownFor(open);
    if (open && defaultCategory) setCats([defaultCategory]);
  }

  const report = REPORTS.find((r) => r.id === type)!;
  const dateError = report.dated ? (!from || !to ? "Choose a start and an end date." : from > to ? "The start date is after the end date." : from > today ? "The start date is in the future." : null) : null;
  const toggle = (list: string[], v: string, set: (x: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const presets: [string, string, string][] = [
    ["This year", `${today.slice(0, 4)}-01-01`, today],
    ["Last 12 months", iso(new Date(now - 365 * 86_400_000)), today],
    ["Last year", `${Number(today.slice(0, 4)) - 1}-01-01`, `${Number(today.slice(0, 4)) - 1}-12-31`],
    // Indian financial year, April to March.
    ["This FY", Number(today.slice(5, 7)) >= 4 ? `${today.slice(0, 4)}-04-01` : `${Number(today.slice(0, 4)) - 1}-04-01`, today],
  ];

  async function download() {
    if (dateError) return;
    setBusy(true);
    const q = new URLSearchParams({ type, format });
    if (report.dated) {
      q.set("from", from);
      q.set("to", to);
    }
    if (kinds.length) q.set("assetTypes", kinds.join(","));
    if (cats.length) q.set("categoryIds", cats.join(","));
    try {
      const res = await fetch(`/api/investments/reports?${q}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't build the report. Try again.");
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `vault-${type}.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(`Downloaded ${name}.`);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Export investments</DialogTitle>
          <DialogDescription>Download a report as a PDF to read or share, or a CSV for a spreadsheet.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Report</Label>
          <div role="radiogroup" aria-label="Report" className="grid gap-2 sm:grid-cols-2">
            {REPORTS.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={type === r.id}
                onClick={() => setType(r.id)}
                className={cn("cursor-pointer rounded-lg border p-3 text-left transition-colors", type === r.id ? "border-foreground/50 bg-muted/60" : "border-border hover:border-foreground/25")}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">{type === r.id && <Check className="h-3.5 w-3.5" />}{r.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{r.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Period</Label>
          {report.dated ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {presets.map(([l, f, t]) => (
                  <button key={l} type="button" onClick={() => { setFrom(f); setTo(t); }} className={chip(from === f && to === t)}>{l}</button>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <Input type="date" aria-label="From" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} aria-invalid={!!dateError} />
                <span className="text-muted-foreground" aria-hidden>→</span>
                <Input type="date" aria-label="To" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} aria-invalid={!!dateError} />
              </div>
              {dateError ? <p className="text-xs text-negative">{dateError}</p> : type === "performance" ? <p className="text-xs text-muted-foreground">Uses recorded closing prices (about a year of history). Anything without a price for a date is marked, never counted as zero.</p> : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">A snapshot of today, at the latest prices. Pick another report for a date range.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Asset types <span className="font-normal text-muted-foreground">(none chosen: all)</span></Label>
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={kinds.includes(k)} onClick={() => toggle(kinds, k, setKinds)} className={chip(kinds.includes(k))}>{l}</button>
            ))}
          </div>
        </div>

        {(ctx?.categories.length ?? 0) > 0 && (
          <div className="space-y-2">
            <Label>Categories and clients <span className="font-normal text-muted-foreground">(none chosen: all)</span></Label>
            <div className="flex flex-wrap gap-1.5">
              {ctx!.categories.map((c) => (
                <button key={c.id} type="button" aria-pressed={cats.includes(c.id)} onClick={() => toggle(cats, c.id, setCats)} className={chip(cats.includes(c.id))}>
                  <Dot color={c.color} />
                  {c.name}
                </button>
              ))}
              <button type="button" aria-pressed={cats.includes(UNCATEGORISED)} onClick={() => toggle(cats, UNCATEGORISED, setCats)} className={chip(cats.includes(UNCATEGORISED))}>Not in a category</button>
            </div>
            {cats.length > 1 && <p className="text-xs text-muted-foreground">A holding in more than one of these is counted once.</p>}
          </div>
        )}

        <div className="space-y-2">
          <Label>Format</Label>
          <div role="radiogroup" aria-label="Format" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
            {(["pdf", "csv"] as const).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={format === f} onClick={() => setFormat(f)} className={cn("h-8 cursor-pointer rounded-md px-4 transition-colors", format === f ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>
                {f === "pdf" ? "PDF" : "CSV (spreadsheet)"}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={download} disabled={busy || !!dateError}>
            <Download className="h-4 w-4" />
            {busy ? "Preparing…" : `Download ${format.toUpperCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
