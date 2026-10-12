"use client";

import { useEffect, useState } from "react";
import { Plus, Target, TriangleAlert, X } from "lucide-react";
import { formatMoney } from "@/lib/currencies";
import { formatDate, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCategories } from "@/components/investments/Categories";
import { cn } from "@/lib/utils";

/**
 * Price targets and stop-losses for a stock (see lib/price-alerts): for the
 * whole stock, one category's shares (a client), or one purchase. Shared by
 * the Edit stock form and the stock's details.
 */

export interface SavedAlert {
  id: string;
  categoryId: string | null;
  lotId: string | null;
  targetPrice: string | null;
  stopLossPrice: string | null;
  targetArmed: boolean;
  stopArmed: boolean;
}
interface LotLite { id: string; quantity: string; purchaseDate: string }
interface StockLite { id: string; ticker: string; currency: string; lastPrice: string | null; lastPriceAt: string | null; lots: LotLite[]; priceAlerts?: SavedAlert[] }

export interface AlertRow { key: string; scope: string; target: string; stop: string }

const scopeOf = (a: { categoryId: string | null; lotId: string | null }) => (a.lotId ? `LOT:${a.lotId}` : a.categoryId ? `CAT:${a.categoryId}` : "STOCK");
const num = (v: string | null) => (v == null ? "" : String(Number(v)));

export function alertRowsFrom(h: StockLite): AlertRow[] {
  return (h.priceAlerts ?? []).map((a) => ({ key: a.id, scope: scopeOf(a), target: num(a.targetPrice), stop: num(a.stopLossPrice) }));
}

/** The request body for a set of rows, or an error to show. */
export function alertsBody(rows: AlertRow[]): { alerts: { scope: "STOCK" | "CATEGORY" | "LOT"; categoryId?: string; lotId?: string; targetPrice: number | null; stopLossPrice: number | null }[] } | { error: string } {
  const seen = new Set<string>();
  const alerts = [];
  for (const r of rows) {
    const t = r.target.trim() ? Number(r.target) : null;
    const s = r.stop.trim() ? Number(r.stop) : null;
    if (t == null && s == null) continue;
    if ((t != null && !(t > 0)) || (s != null && !(s > 0))) return { error: "Target and stop-loss prices must be above zero." };
    if (t != null && s != null && s >= t) return { error: "A stop-loss has to be below its target." };
    if (seen.has(r.scope)) return { error: "Two alerts are for the same shares. Keep one." };
    seen.add(r.scope);
    const [kind, id] = r.scope.split(":");
    alerts.push({ scope: (kind === "LOT" ? "LOT" : kind === "CAT" ? "CATEGORY" : "STOCK") as "STOCK" | "CATEGORY" | "LOT", ...(kind === "LOT" ? { lotId: id } : kind === "CAT" ? { categoryId: id } : {}), targetPrice: t, stopLossPrice: s });
  }
  return { alerts };
}

export const alertsChanged = (h: StockLite, rows: AlertRow[]) => {
  const norm = (rs: AlertRow[]) => JSON.stringify(rs.filter((r) => r.target.trim() || r.stop.trim()).map((r) => [r.scope, r.target.trim() ? Number(r.target) : null, r.stop.trim() ? Number(r.stop) : null]).sort());
  return norm(rows) !== norm(alertRowsFrom(h));
};

/** The scopes an alert can be for: the whole stock, each category its shares
 * are in, each purchase. */
function useScopes(h: StockLite) {
  const ctx = useCategories();
  const cats = new Map<string, string>();
  for (const c of ctx?.of("STOCK", h.id) ?? []) cats.set(c.id, c.name);
  for (const l of h.lots) for (const c of ctx?.ofLot(l.id) ?? []) cats.set(c.id, c.name);
  const lots = [...h.lots]
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))
    .map((l) => {
      const own = (ctx?.ofLot(l.id) ?? []).map((c) => c.name);
      return { value: `LOT:${l.id}`, label: `Purchase · ${Number(l.quantity)} on ${formatDate(l.purchaseDate)}${own.length ? ` (${own.join(", ")})` : ""}` };
    });
  return { cats: [...cats.entries()].map(([id, name]) => ({ value: `CAT:${id}`, label: `${name}'s shares` })), lots };
}

export function scopeLabel(h: StockLite, scope: string, catName: (id: string) => string | undefined) {
  if (scope === "STOCK") return "Whole stock";
  const [kind, id] = scope.split(":");
  if (kind === "CAT") return `${catName(id) ?? "Category"}'s shares`;
  const l = h.lots.find((x) => x.id === id);
  return l ? `Purchase of ${Number(l.quantity)} on ${formatDate(l.purchaseDate)}` : "A purchase since sold";
}

export function PriceAlertsEditor({ holding, rows, onChange, currency }: { holding: StockLite; rows: AlertRow[]; onChange: (r: AlertRow[]) => void; currency: string }) {
  const { cats, lots } = useScopes(holding);
  const used = new Set(rows.map((r) => r.scope));
  const options = [{ value: "STOCK", label: "Whole stock" }, ...cats, ...lots];
  const free = options.find((o) => !used.has(o.value));
  const set = (key: string, patch: Partial<AlertRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const last = holding.lastPrice != null ? Number(holding.lastPrice) : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Price alerts <span className="font-normal text-muted-foreground">(optional)</span></Label>
        {last != null && <span className="text-xs text-muted-foreground tabular-nums">Now {formatMoney(last, currency)}{holding.lastPriceAt ? ` · ${formatDateTime(holding.lastPriceAt)}` : ""}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Per share, in {currency}. You&apos;re notified when the price reaches a target or falls to a stop-loss, checked each time prices update. Nothing is ever bought or sold for you.
      </p>
      {rows.map((r) => {
        const t = Number(r.target), s = Number(r.stop);
        const bad = r.target.trim() && r.stop.trim() && s >= t;
        return (
          <div key={r.key} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Select value={r.scope} onValueChange={(v) => set(r.key, { scope: v })}>
                <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label="Alert is for"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.map((o, i) => (
                    <div key={o.value}>
                      {i === 1 && <SelectSeparator />}
                      <SelectItem value={o.value} disabled={o.value !== r.scope && used.has(o.value)}>{o.label}</SelectItem>
                    </div>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove this alert" onClick={() => onChange(rows.filter((x) => x.key !== r.key))}><X className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-xs text-muted-foreground"><Target className="h-3 w-3 text-positive" />Target price</Label>
                <Input type="number" inputMode="decimal" step="any" min="0" value={r.target} onChange={(e) => set(r.key, { target: e.target.value })} placeholder={last != null ? `e.g. ${Math.round(last * 1.15)}` : "Optional"} aria-label="Target price per share" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-xs text-muted-foreground"><TriangleAlert className="h-3 w-3 text-negative" />Stop-loss price</Label>
                <Input type="number" inputMode="decimal" step="any" min="0" value={r.stop} onChange={(e) => set(r.key, { stop: e.target.value })} placeholder={last != null ? `e.g. ${Math.round(last * 0.9)}` : "Optional"} aria-label="Stop-loss price per share" aria-invalid={!!bad} className="h-9" />
              </div>
            </div>
            {bad ? (
              <p className="text-xs text-negative">The stop-loss has to be below the target.</p>
            ) : last != null && ((r.target.trim() && t <= last) || (r.stop.trim() && s >= last)) ? (
              <p className="text-xs text-muted-foreground">The price is already past this, so you&apos;ll be notified on the next check.</p>
            ) : null}
          </div>
        );
      })}
      {free && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { key: `new-${Date.now()}`, scope: free.value, target: "", stop: "" }])}>
          <Plus className="h-3.5 w-3.5" />
          {rows.length ? "Alert for a client or purchase" : "Add a target or stop-loss"}
        </Button>
      )}
    </div>
  );
}

interface EventRow { id: string; kind: "TARGET" | "STOP_LOSS"; scopeLabel: string | null; threshold: string; observedPrice: string; currency: string; priceAt: string; createdAt: string }

/** A stock's thresholds and what they've triggered, for its details view. */
export function StockAlertsSummary({ holding, onEdit }: { holding: StockLite; onEdit?: () => void }) {
  const ctx = useCategories();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/alerts?history=1&stock=${holding.id}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => alive && setEvents(d.events ?? []))
      .catch(() => alive && setEvents([]));
    return () => {
      alive = false;
    };
  }, [holding.id]);
  const alerts = holding.priceAlerts ?? [];
  const cat = (id: string) => ctx?.categories.find((c) => c.id === id)?.name;
  if (!alerts.length && !events?.length) {
    return onEdit ? (
      <p className="text-xs text-muted-foreground">
        No price alerts. <button type="button" onClick={onEdit} className="cursor-pointer underline underline-offset-2 hover:text-foreground">Set a target or stop-loss</button>
      </p>
    ) : null;
  }
  return (
    <div className="space-y-2">
      <p className="eyebrow">Price alerts</p>
      {alerts.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-xl border border-border text-sm">
          {alerts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
              <span className="min-w-0 flex-1 truncate font-medium">{scopeLabel(holding, scopeOf(a), cat)}</span>
              {a.targetPrice != null && (
                <span className="inline-flex items-center gap-1 tabular-nums"><Target className="h-3.5 w-3.5 text-positive" />{formatMoney(Number(a.targetPrice), holding.currency)}{!a.targetArmed && <span className="text-xs text-muted-foreground">reached</span>}</span>
              )}
              {a.stopLossPrice != null && (
                <span className="inline-flex items-center gap-1 tabular-nums"><TriangleAlert className="h-3.5 w-3.5 text-negative" />{formatMoney(Number(a.stopLossPrice), holding.currency)}{!a.stopArmed && <span className="text-xs text-muted-foreground">reached</span>}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {events && events.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {events.slice(0, 8).map((e) => (
            <li key={e.id} className={cn("flex flex-wrap gap-x-2", e.kind === "STOP_LOSS" && "text-negative")}>
              <span className="tabular-nums">{formatDateTime(e.createdAt)}</span>
              <span>
                {e.kind === "TARGET" ? "Target reached" : "Stop-loss reached"}
                {e.scopeLabel ? ` (${e.scopeLabel})` : ""}: {formatMoney(Number(e.observedPrice), e.currency)} vs {formatMoney(Number(e.threshold), e.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {onEdit && <button type="button" onClick={onEdit} className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Change alerts</button>}
    </div>
  );
}
