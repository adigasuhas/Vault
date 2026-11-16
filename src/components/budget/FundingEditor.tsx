"use client";

import { useMemo } from "react";
import { Landmark, Plus, Wallet, X } from "lucide-react";
import { formatMoney } from "@/lib/currencies";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sourceKey, STATE_LABEL, type FundingOption, type LineFunding, type Source, type SourceRef } from "@/components/budget/types";

/**
 * Where a budget line's money comes from: one row per source (a receivable
 * or an account balance) with how much of the line it pays for. A plan, not
 * a payment: saving this moves no money.
 */

export interface FundingRow {
  key: string;
  ref: SourceRef;
  amount: string;
}

interface Choice {
  key: string;
  ref: SourceRef;
  kind: "RECEIVABLE" | "ACCOUNT";
  label: string;
  detail: string;
  /** Most this line could take from it. */
  available: number;
}

/** Every source a line can draw on: the month's own sources first, then
 * income and balances not yet in the month. */
export function useChoices(sources: Source[], options: FundingOption[], current: LineFunding[]): Choice[] {
  return useMemo(() => {
    const out: Choice[] = [];
    const seen = new Set<string>();
    for (const s of sources) {
      const key = sourceKey(s);
      const opt = options.find((o) => o.key === key);
      const mine = current.filter((f) => f.sourceId === s.id).reduce((t, f) => t + f.amount, 0);
      const ceiling = opt ? opt.room : s.amount;
      out.push({
        key,
        ref: { sourceId: s.id },
        kind: s.kind,
        label: s.label,
        detail: s.kind === "RECEIVABLE" && s.state ? STATE_LABEL[s.state].label : "Balance set aside",
        available: Math.max(0, Math.max(s.unallocated, ceiling - s.allocated) + mine),
      });
      seen.add(key);
    }
    for (const o of options) {
      if (seen.has(o.key) || o.room <= 0) continue;
      out.push({ key: o.key, ref: o.ref, kind: o.kind, label: o.label, detail: o.detail, available: o.room });
    }
    return out;
  }, [sources, options, current]);
}

export function FundingEditor({
  currency,
  target,
  rows,
  onChange,
  choices,
}: {
  currency: string;
  /** What the line needs funded. */
  target: number;
  rows: FundingRow[];
  onChange: (rows: FundingRow[]) => void;
  choices: Choice[];
}) {
  const total = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  const gap = Math.round((target - total) * 100) / 100;
  const used = new Set(rows.map((r) => r.key));
  const update = (i: number, patch: Partial<FundingRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const free = choices.filter((c) => !used.has(c.key));

  function add() {
    const c = free[0];
    if (!c) return;
    const amount = Math.max(0, Math.min(c.available, gap > 0 ? gap : 0));
    onChange([...rows, { key: c.key, ref: c.ref, amount: amount ? String(Math.round(amount * 100) / 100) : "" }]);
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
          Optional. Say which receivable or account balance pays for this, so you can see what every bit of income is doing.
        </p>
      )}
      {rows.map((r, i) => {
        const c = choices.find((x) => x.key === r.key);
        const others = total - (Number(r.amount) || 0);
        const fill = c ? Math.max(0, Math.min(c.available, target - others)) : 0;
        const tooMuch = c && (Number(r.amount) || 0) > c.available + 0.005;
        return (
          <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-start gap-2">
            <div className="min-w-0">
              <Select
                value={r.key}
                onValueChange={(k) => {
                  const next = choices.find((x) => x.key === k);
                  if (next) update(i, { key: next.key, ref: next.ref });
                }}
              >
                <SelectTrigger className="w-full" aria-label="Source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["RECEIVABLE", "ACCOUNT"] as const).map((kind) => {
                    const list = choices.filter((x) => x.kind === kind && (x.key === r.key || !used.has(x.key)));
                    if (!list.length) return null;
                    return (
                      <SelectGroup key={kind}>
                        <SelectLabel>{kind === "RECEIVABLE" ? "Income (receivables)" : "Money already in accounts"}</SelectLabel>
                        {list.map((x) => (
                          <SelectItem key={x.key} value={x.key}>
                            <span className="flex items-center gap-2">
                              {kind === "RECEIVABLE" ? <Wallet className="h-3.5 w-3.5 text-muted-foreground" /> : <Landmark className="h-3.5 w-3.5 text-muted-foreground" />}
                              {x.label}
                              <span className="text-muted-foreground">· {formatMoney(Math.floor(x.available * 100) / 100, currency)} free</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
              {c && <p className="mt-1 truncate px-1 text-[11px] text-muted-foreground">{c.detail}</p>}
            </div>
            <div>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                aria-label={`Amount from ${c?.label ?? "source"}`}
                aria-invalid={!!tooMuch}
                value={r.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
                className="text-right tabular-nums"
                placeholder="0"
              />
              {fill > 0 && Math.abs(fill - (Number(r.amount) || 0)) > 0.005 && (
                <button type="button" onClick={() => update(i, { amount: String(Math.round(fill * 100) / 100) })} className="mt-1 w-full cursor-pointer px-1 text-right text-[11px] text-brass hover:underline">
                  Use {formatMoney(Math.round(fill * 100) / 100, currency)}
                </button>
              )}
            </div>
            <Button type="button" variant="ghost" size="icon-sm" className="mt-1" aria-label={`Remove ${c?.label ?? "source"}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" disabled={!free.length} onClick={add}>
          <Plus className="h-3.5 w-3.5" /> {rows.length ? "Add another source" : "Fund from a source"}
        </Button>
        {rows.length > 0 && (
          <p aria-live="polite" className={cn("text-xs tabular-nums", gap < -0.005 ? "text-negative" : gap > 0.005 ? "text-warning" : "text-positive")}>
            {gap < -0.005
              ? `${formatMoney(-gap, currency)} more than the line`
              : gap > 0.005
                ? `${formatMoney(total, currency)} funded · ${formatMoney(gap, currency)} not yet`
                : `Fully funded: ${formatMoney(total, currency)}`}
          </p>
        )}
      </div>
      {!choices.length && <p className="text-xs text-muted-foreground">No receivables this month or last, and no account balances to draw on.</p>}
    </div>
  );
}
