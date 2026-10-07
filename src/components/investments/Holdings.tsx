"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { Sparkline, type SparkPoint } from "@/components/app/Sparkline";
import { Equivalent } from "@/components/app/Money";
import { EmptyState, Panel, SkeletonBlock } from "@/components/app/PageHeader";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSort, SortTh } from "@/components/investments/table-kit";
import { Eye, LineChart, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Lot { id: string; quantity: string; price: string; purchaseDate: string }
export interface StockRow {
  id: string;
  ticker: string;
  exchange: string | null;
  quantity: string;
  avgBuyPrice: string;
  currency: string;
  purchaseDate: string;
  lastPrice: string | null;
  lastPriceAt: string | null;
  previousClose: string | null;
  lots: Lot[];
}
interface FundLot { id: string; units: string; nav: string; purchaseDate: string }
export interface FundRow {
  lots?: FundLot[];
  id: string;
  fundName: string;
  schemeCode: string | null;
  units: string;
  avgNav: string;
  currency: string;
  purchaseDate: string;
  lastNav: string | null;
}

const pct = (n: number | null) => (n == null || !Number.isFinite(n) ? "–" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`);
const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-muted-foreground");
const signed = (n: number, c: string) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatMoney(Math.abs(n), c)}`;

type Filter = "all" | "gainers" | "losers";

function Toolbar({ q, setQ, filter, setFilter, count, noun }: { q: string; setQ: (v: string) => void; filter: Filter; setFilter: (f: Filter) => void; count: number; noun: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${noun}`} aria-label={`Search ${noun}`} className="h-8 w-48 pl-8" />
      </div>
      <div role="radiogroup" aria-label="Show" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
        {(["all", "gainers", "losers"] as const).map((f) => (
          <button key={f} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={cn("h-7 cursor-pointer rounded-md px-2.5 transition-colors", filter === f ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>
            {f === "all" ? "All" : f === "gainers" ? "In profit" : "In loss"}
          </button>
        ))}
      </div>
      <span className="ml-auto text-xs text-muted-foreground">{count} {count === 1 ? noun.replace(/s$/, "") : noun}</span>
    </div>
  );
}

function stockMetrics(s: StockRow) {
  const qty = Number(s.quantity);
  const last = Number(s.lastPrice ?? s.avgBuyPrice);
  const invested = qty * Number(s.avgBuyPrice);
  const current = qty * last;
  const pl = current - invested;
  const prev = s.previousClose != null ? Number(s.previousClose) : null;
  const dayPct = prev && s.lastPrice != null ? ((Number(s.lastPrice) - prev) / prev) * 100 : null;
  return { qty, last, invested, current, pl, plPct: invested > 0 ? (pl / invested) * 100 : 0, dayPct };
}

export function StockTable({
  stocks,
  loading,
  series,
  onView,
  onEdit,
  onDelete,
}: {
  stocks: StockRow[];
  loading: boolean;
  series: Record<string, SparkPoint[]> | null;
  onView: (id: string) => void;
  onEdit: (s: StockRow) => void;
  onDelete: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo(
    () =>
      stocks
        .map((s) => ({ s, m: stockMetrics(s) }))
        .filter(({ s, m }) => (!q || `${s.ticker} ${s.exchange ?? ""}`.toLowerCase().includes(q.toLowerCase())) && (filter === "all" || (filter === "gainers" ? m.pl > 0 : m.pl < 0))),
    [stocks, q, filter]
  );
  const sort = useSort(
    rows,
    {
      name: (r) => r.s.ticker,
      price: (r) => r.m.last,
      day: (r) => r.m.dayPct ?? -Infinity,
      invested: (r) => r.m.invested,
      current: (r) => r.m.current,
      pl: (r) => r.m.pl,
      plpct: (r) => r.m.plPct,
    },
    "current"
  );
  const [deleting, setDeleting] = useState<StockRow | null>(null);

  if (loading) return <SkeletonBlock className="h-48" />;
  if (!stocks.length) return <EmptyState icon={<LineChart className="h-5 w-5" />} title="No stocks yet">Add a holding and its price, value and one-year line show up here.</EmptyState>;

  return (
    <Panel padded={false} className="overflow-hidden">
      <Toolbar q={q} setQ={setQ} filter={filter} setFilter={setFilter} count={rows.length} noun="stocks" />
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground">
            <SortTh k="name" label="Holding" sort={sort} className="pl-4" />
            <th className="hidden px-3 py-2.5 font-medium uppercase lg:table-cell">1 year</th>
            <SortTh k="price" label="Price" sort={sort} align="right" className="hidden sm:table-cell" />
            <SortTh k="invested" label="Invested" sort={sort} align="right" className="hidden md:table-cell" />
            <SortTh k="current" label="Value" sort={sort} align="right" />
            <SortTh k="pl" label="Profit / loss" sort={sort} align="right" />
            <th />
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map(({ s, m }) => (
            <tr key={s.id} className="border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40">
              <td className="max-w-[200px] truncate py-2.5 pr-3 pl-4">
                <button onClick={() => onView(s.id)} className="cursor-pointer text-left font-medium hover:underline">{s.ticker}</button>
                <p className="truncate text-xs text-muted-foreground">
                  {Number(m.qty.toFixed(4))} × {formatMoney(Number(s.avgBuyPrice), s.currency)}
                  {s.lots.length > 1 && ` · ${s.lots.length} buys`}
                </p>
              </td>
              <td className="hidden px-3 py-1.5 lg:table-cell">
                <Sparkline points={series ? series[s.id] ?? [] : undefined} currency={s.currency} width={84} height={26} />
              </td>
              <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">
                {s.lastPrice ? formatMoney(Number(s.lastPrice), s.currency) : <span className="text-muted-foreground">–</span>}
                <p className={cn("text-xs", m.dayPct == null ? "text-muted-foreground" : tone(m.dayPct))}>{m.dayPct == null ? "no quote" : `${pct(m.dayPct)} today`}</p>
              </td>
              <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{formatMoney(m.invested, s.currency)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {formatMoney(m.current, s.currency)}
                <p><Equivalent value={m.current} currency={s.currency} /></p>
              </td>
              <td className={cn("px-3 py-2.5 text-right tabular-nums", tone(m.pl))}>
                {signed(m.pl, s.currency)}
                <p className="text-xs">{pct(m.plPct)}</p>
              </td>
              <td className="pr-3 text-right">
                <div className="flex justify-end gap-0.5">
                  <Button variant="ghost" size="icon-sm" title="Purchases and returns" aria-label={`Details for ${s.ticker}`} onClick={() => onView(s.id)}><Eye className="h-4 w-4" /></Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${s.ticker}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(s)}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleting(s)}><Trash2 className="h-4 w-4" /> Delete holding…</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing matches. Try another search or filter.</p>}
      <ConfirmAction
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.ticker}?`}
        description={<p>The holding and every purchase recorded for it are removed. Holdings aren&apos;t part of your account ledger, so no balance changes.</p>}
        confirmLabel="Delete holding"
        onConfirm={() => onDelete(deleting!.id)}
      />
    </Panel>
  );
}

export function StockBreakdown({ h, onEditLot, onDeleteLot }: { h: StockRow; onEditLot: (lot: Lot) => void; onDeleteLot: (lotId: string) => void }) {
  const last = Number(h.lastPrice ?? h.avgBuyPrice);
  const lots = [...h.lots]
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))
    .map((l) => {
      const qty = Number(l.quantity);
      const price = Number(l.price);
      const invested = qty * price;
      const current = qty * last;
      return { lot: l, id: l.id, purchaseDate: l.purchaseDate, qty, price, invested, current, pl: current - invested, plPct: invested > 0 ? ((current - invested) / invested) * 100 : 0 };
    });
  const invested = lots.reduce((s, l) => s + l.invested, 0);
  const current = lots.reduce((s, l) => s + l.current, 0);
  const pl = current - invested;
  const qty = lots.reduce((s, l) => s + l.qty, 0);
  const c = h.currency;
  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle className="text-lg">{h.ticker}</DialogTitle>
        <DialogDescription>
          {[h.exchange, c, `${Number(qty.toFixed(4))} shares`, h.lastPrice ? `last price ${formatMoney(last, c)}${h.lastPriceAt ? ` (${formatDate(h.lastPriceAt, { day: "numeric", month: "short" })})` : ""}` : "no live price yet, valued at cost"].filter(Boolean).join(" · ")}
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {[
          ["Invested", formatMoney(invested, c), <Equivalent key="e" value={invested} currency={c} />],
          ["Current value", formatMoney(current, c), <Equivalent key="e" value={current} currency={c} />],
          ["Profit / loss", <span key="v" className={tone(pl)}>{signed(pl, c)}</span>, <Equivalent key="e" value={pl} currency={c} signed />],
          ["Return", <span key="v" className={tone(pl)}>{pct(invested > 0 ? (pl / invested) * 100 : null)}</span>, <span key="e" className="text-xs text-muted-foreground">avg cost {formatMoney(invested / (qty || 1), c)}</span>],
        ].map(([label, value, sub]) => (
          <div key={label as string} className="bg-card p-4">
            <p className="eyebrow">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
            <p className="mt-0.5">{sub}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
              <th className="px-4 py-2.5 text-left font-medium">Bought</th>
              <th className="px-3 py-2.5 text-right font-medium">Qty</th>
              <th className="px-3 py-2.5 text-right font-medium">Price</th>
              <th className="px-3 py-2.5 text-right font-medium">Invested</th>
              <th className="px-3 py-2.5 text-right font-medium">Value now</th>
              <th className="px-3 py-2.5 text-right font-medium">Profit / loss</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs">{formatDate(l.purchaseDate)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{Number(l.qty.toFixed(4))}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(l.price, c)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(l.invested, c)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(l.current, c)}</td>
                <td className={cn("px-3 py-2.5 text-right tabular-nums", tone(l.pl))}>{signed(l.pl, c)} <span className="text-xs">({pct(l.plPct)})</span></td>
                <td className="pr-3 text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon-sm" aria-label="Edit purchase" onClick={() => onEditLot(l.lot)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <ConfirmAction
                      title="Delete this purchase?"
                      description={<p>The holding&apos;s quantity and average price are recalculated from the other purchases. If it&apos;s the only one, the holding goes too.</p>}
                      confirmLabel="Delete purchase"
                      onConfirm={() => onDeleteLot(l.id)}
                      trigger={<Button variant="ghost" size="icon-sm" className="text-negative hover:text-negative" aria-label="Delete purchase"><Trash2 className="h-3.5 w-3.5" /></Button>}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-foreground/20 font-medium">
              <td className="px-4 py-2.5">Total</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{Number(qty.toFixed(4))}</td>
              <td className="px-3 py-2.5 text-right text-xs text-muted-foreground tabular-nums">avg {formatMoney(invested / (qty || 1), c)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(invested, c)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(current, c)}</td>
              <td className={cn("px-3 py-2.5 text-right tabular-nums", tone(pl))}>{signed(pl, c)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Every purchase is valued at the latest price. Adding the same stock again records a new purchase here.</p>
    </div>
  );
}

function fundMetrics(f: FundRow) {
  const units = Number(f.units);
  const nav = Number(f.lastNav ?? f.avgNav);
  const invested = units * Number(f.avgNav);
  const current = units * nav;
  const pl = current - invested;
  return { units, nav, invested, current, pl, plPct: invested > 0 ? (pl / invested) * 100 : 0 };
}

export function FundTable({ funds, loading, series, onDelete, onChanged }: { funds: FundRow[]; loading: boolean; series: Record<string, SparkPoint[]> | null; onDelete: (id: string) => void; onChanged?: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FundRow | null>(null);
  const rows = useMemo(
    () =>
      funds
        .map((f) => ({ f, m: fundMetrics(f) }))
        .filter(({ f, m }) => (!q || f.fundName.toLowerCase().includes(q.toLowerCase())) && (filter === "all" || (filter === "gainers" ? m.pl > 0 : m.pl < 0))),
    [funds, q, filter]
  );
  const sort = useSort(rows, { name: (r) => r.f.fundName, nav: (r) => r.m.nav, invested: (r) => r.m.invested, current: (r) => r.m.current, pl: (r) => r.m.pl }, "current");

  if (loading) return <SkeletonBlock className="h-48" />;
  if (!funds.length) return <EmptyState icon={<LineChart className="h-5 w-5" />} title="No funds yet">Add a fund with its scheme code to track its NAV automatically.</EmptyState>;

  return (
    <Panel padded={false} className="overflow-hidden">
      <Toolbar q={q} setQ={setQ} filter={filter} setFilter={setFilter} count={rows.length} noun="funds" />
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground">
            <SortTh k="name" label="Fund" sort={sort} className="pl-4" />
            <th className="hidden px-3 py-2.5 font-medium uppercase lg:table-cell">1 year</th>
            <SortTh k="invested" label="Invested" sort={sort} align="right" className="hidden md:table-cell" />
            <SortTh k="current" label="Value" sort={sort} align="right" />
            <SortTh k="pl" label="Profit / loss" sort={sort} align="right" />
            <th />
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map(({ f, m }) => (
            <tr key={f.id} className="border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40">
              <td className="max-w-[280px] py-2.5 pr-3 pl-4">
                <button onClick={() => setOpen(f.id)} className="block w-full cursor-pointer truncate text-left font-medium hover:underline" title={f.fundName}>{f.fundName}</button>
                <p className="truncate text-xs text-muted-foreground">{Number(m.units.toFixed(3))} units · NAV {formatMoney(m.nav, f.currency)}{(f.lots?.length ?? 0) > 1 && ` · ${f.lots!.length} buys`}</p>
              </td>
              <td className="hidden px-3 py-1.5 lg:table-cell">
                {f.schemeCode ? <Sparkline points={series ? series[f.id] ?? [] : undefined} currency={f.currency} width={84} height={26} /> : <span className="text-xs text-muted-foreground" title="Add the AMFI scheme code to see NAV history">No scheme code</span>}
              </td>
              <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{formatMoney(m.invested, f.currency)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {formatMoney(m.current, f.currency)}
                <p><Equivalent value={m.current} currency={f.currency} /></p>
              </td>
              <td className={cn("px-3 py-2.5 text-right tabular-nums", tone(m.pl))}>
                {signed(m.pl, f.currency)}
                <p className="text-xs">{pct(m.plPct)}</p>
              </td>
              <td className="pr-3 text-right">
                <div className="flex justify-end gap-0.5">
                  <Button variant="ghost" size="icon-sm" aria-label={`Details for ${f.fundName}`} onClick={() => setOpen(f.id)}><Eye className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.fundName}`} onClick={() => setDeleting(f)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing matches. Try another search or filter.</p>}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          {open && funds.find((x) => x.id === open) && <FundBreakdown f={funds.find((x) => x.id === open)!} onChanged={() => onChanged?.()} />}
        </DialogContent>
      </Dialog>
      <ConfirmAction
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.fundName}?`}
        description={<p>This fund holding is removed. Holdings aren&apos;t part of your account ledger, so no balance changes.</p>}
        confirmLabel="Delete holding"
        onConfirm={() => onDelete(deleting!.id)}
      />
    </Panel>
  );
}

function FundBreakdown({ f, onChanged }: { f: FundRow; onChanged: () => void }) {
  const [editing, setEditing] = useState<FundLot | null>(null);
  const [draft, setDraft] = useState({ units: "", nav: "", date: "" });
  const [busy, setBusy] = useState(false);
  const c = f.currency;
  const navNow = Number(f.lastNav ?? f.avgNav);
  const lots = (f.lots?.length ? f.lots : [{ id: "_agg", units: f.units, nav: f.avgNav, purchaseDate: f.purchaseDate }])
    .slice()
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))
    .map((l) => {
      const units = Number(l.units);
      const invested = units * Number(l.nav);
      const current = units * navNow;
      return { lot: l, units, nav: Number(l.nav), invested, current, pl: current - invested, plPct: invested > 0 ? ((current - invested) / invested) * 100 : 0 };
    });
  const invested = lots.reduce((s, l) => s + l.invested, 0);
  const current = lots.reduce((s, l) => s + l.current, 0);
  const units = lots.reduce((s, l) => s + l.units, 0);
  const pl = current - invested;

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/investments/mutual-funds/${f.id}/lots/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: Number(draft.units), nav: Number(draft.nav), purchaseDate: draft.date }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't save that purchase.");
      toast.success("Purchase updated.");
      setEditing(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(lotId: string) {
    const res = await fetch(`/api/investments/mutual-funds/${f.id}/lots/${lotId}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(d.error || "Couldn't remove that purchase.");
    toast.success(d.holdingDeleted ? "Purchase removed. It was the only one, so the fund went too." : "Purchase removed.");
    onChanged();
  }

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle className="text-lg">{f.fundName}</DialogTitle>
        <DialogDescription>
          {[f.schemeCode ? `Scheme ${f.schemeCode}` : null, c, `${Number(units.toFixed(3))} units`, f.lastNav ? `NAV ${formatMoney(navNow, c)}` : "no live NAV yet, valued at cost"].filter(Boolean).join(" · ")}
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {[
          ["Invested", formatMoney(invested, c), <Equivalent key="e" value={invested} currency={c} />],
          ["Current value", formatMoney(current, c), <Equivalent key="e" value={current} currency={c} />],
          ["Profit / loss", <span key="v" className={tone(pl)}>{signed(pl, c)}</span>, <Equivalent key="e" value={pl} currency={c} signed />],
          ["Return", <span key="v" className={tone(pl)}>{pct(invested > 0 ? (pl / invested) * 100 : null)}</span>, <span key="e" className="text-xs text-muted-foreground">avg NAV {formatMoney(invested / (units || 1), c)}</span>],
        ].map(([label, value, sub]) => (
          <div key={label as string} className="bg-card p-4">
            <p className="eyebrow">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
            <p className="mt-0.5">{sub}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
              <th className="px-4 py-2.5 text-left font-medium">Bought</th>
              <th className="px-3 py-2.5 text-right font-medium">Units</th>
              <th className="px-3 py-2.5 text-right font-medium">NAV paid</th>
              <th className="px-3 py-2.5 text-right font-medium">Invested</th>
              <th className="px-3 py-2.5 text-right font-medium">Value now</th>
              <th className="px-3 py-2.5 text-right font-medium">Profit / loss</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.lot.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs">{formatDate(l.lot.purchaseDate)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{Number(l.units.toFixed(3))}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(l.nav, c)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(l.invested, c)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(l.current, c)}</td>
                <td className={cn("px-3 py-2.5 text-right tabular-nums", tone(l.pl))}>{signed(l.pl, c)} <span className="text-xs">({pct(l.plPct)})</span></td>
                <td className="pr-3 text-right">
                  {l.lot.id !== "_agg" && (
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon-sm" aria-label="Edit purchase" onClick={() => { setEditing(l.lot); setDraft({ units: String(Number(l.lot.units)), nav: String(Number(l.lot.nav)), date: l.lot.purchaseDate.slice(0, 10) }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <ConfirmAction
                        title="Delete this purchase?"
                        description={<p>The fund&apos;s units and average NAV are recalculated from the other purchases. If it&apos;s the only one, the fund goes too.</p>}
                        confirmLabel="Delete purchase"
                        onConfirm={() => remove(l.lot.id)}
                        trigger={<Button variant="ghost" size="icon-sm" className="text-negative hover:text-negative" aria-label="Delete purchase"><Trash2 className="h-3.5 w-3.5" /></Button>}
                      />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-foreground/20 font-medium">
              <td className="px-4 py-2.5">Total</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{Number(units.toFixed(3))}</td>
              <td className="px-3 py-2.5 text-right text-xs text-muted-foreground tabular-nums">avg {formatMoney(invested / (units || 1), c)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(invested, c)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(current, c)}</td>
              <td className={cn("px-3 py-2.5 text-right tabular-nums", tone(pl))}>{signed(pl, c)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {editing && (
        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <p className="mb-3 text-sm font-medium">Edit purchase</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <label className="space-y-1.5 text-xs"><span className="text-muted-foreground">Units</span><Input type="number" min="0" step="0.001" value={draft.units} onChange={(e) => setDraft({ ...draft, units: e.target.value })} /></label>
            <label className="space-y-1.5 text-xs"><span className="text-muted-foreground">NAV paid</span><Input type="number" min="0" step="0.0001" value={draft.nav} onChange={(e) => setDraft({ ...draft, nav: e.target.value })} /></label>
            <label className="space-y-1.5 text-xs"><span className="text-muted-foreground">Bought on</span><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button onClick={save} disabled={busy || !(Number(draft.units) > 0) || !(Number(draft.nav) >= 0) || !draft.date}>Save</Button>
            </div>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Every purchase is valued at the latest NAV. Adding the same fund again records a new purchase here.</p>
    </div>
  );
}

// ---------------------------------------------------------------- deposits

export interface DepositRow {
  id: string;
  bank: string;
  principal: string;
  interestRate: string;
  startDate: string;
  maturityDate: string;
  currency: string;
}

function depositMetrics(d: DepositRow, now = Date.now()) {
  const principal = Number(d.principal);
  const rate = Number(d.interestRate);
  const start = new Date(d.startDate).getTime();
  const end = new Date(d.maturityDate).getTime();
  const years = (t: number) => Math.max(0, t) / (365.25 * 86_400_000);
  const elapsed = Math.min(Math.max(now - start, 0), end - start);
  const value = principal * (1 + (rate / 100) * years(elapsed));
  const atMaturity = principal * (1 + (rate / 100) * years(end - start));
  const daysLeft = Math.ceil((end - now) / 86_400_000);
  return { principal, rate, value, atMaturity, earned: value - principal, daysLeft, matured: daysLeft <= 0, progress: end > start ? (elapsed / (end - start)) * 100 : 100 };
}

export function DepositTable({ deposits, loading, onDelete }: { deposits: DepositRow[]; loading: boolean; onDelete: (id: string) => void }) {
  const [show, setShow] = useState<"all" | "active" | "matured">("all");
  const [now] = useState(() => Date.now());
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DepositRow | null>(null);
  const rows = useMemo(
    () => deposits.map((d) => ({ d, m: depositMetrics(d, now) })).filter(({ m }) => show === "all" || (show === "matured" ? m.matured : !m.matured)),
    [deposits, show, now]
  );
  const sort = useSort(rows, { bank: (r) => r.d.bank, rate: (r) => r.m.rate, principal: (r) => r.m.principal, value: (r) => r.m.value, maturity: (r) => r.d.maturityDate }, "maturity", "asc");

  if (loading) return <SkeletonBlock className="h-40" />;
  if (!deposits.length) return <EmptyState icon={<LineChart className="h-5 w-5" />} title="No fixed deposits yet">Add one to watch the interest build up until it matures.</EmptyState>;
  const detail = open ? deposits.find((x) => x.id === open) : null;
  const dm = detail ? depositMetrics(detail, now) : null;

  return (
    <Panel padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
          {(["all", "active", "matured"] as const).map((f) => (
            <button key={f} role="radio" aria-checked={show === f} onClick={() => setShow(f)} className={cn("h-7 cursor-pointer rounded-md px-2.5 transition-colors", show === f ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>
              {f === "all" ? "All" : f === "active" ? "Running" : "Matured"}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "deposit" : "deposits"}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground">
              <SortTh k="bank" label="Deposit" sort={sort} className="pl-4" />
              <SortTh k="rate" label="Rate" sort={sort} align="right" className="hidden sm:table-cell" />
              <SortTh k="principal" label="Invested" sort={sort} align="right" className="hidden md:table-cell" />
              <SortTh k="value" label="Value now" sort={sort} align="right" />
              <SortTh k="maturity" label="Matures" sort={sort} align="right" />
              <th />
            </tr>
          </thead>
          <tbody>
            {sort.sorted.map(({ d, m }) => (
              <tr key={d.id} className="border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40">
                <td className="py-2.5 pr-3 pl-4">
                  <button onClick={() => setOpen(d.id)} className="cursor-pointer text-left font-medium hover:underline">{d.bank}</button>
                  <div className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-muted"><div className="h-full bg-positive" style={{ width: `${m.progress}%` }} /></div>
                </td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">{m.rate}%</td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{formatMoney(m.principal, d.currency)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatMoney(Math.round(m.value * 100) / 100, d.currency)}
                  <p className="text-xs text-positive">+{formatMoney(Math.round(m.earned), d.currency)}</p>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="font-mono text-xs">{formatDate(d.maturityDate)}</span>
                  <p className="text-xs text-muted-foreground">{m.matured ? "matured" : `${m.daysLeft} days left`}</p>
                </td>
                <td className="pr-3 text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon-sm" aria-label={`Details for ${d.bank}`} onClick={() => setOpen(d.id)}><Eye className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${d.bank} deposit`} onClick={() => setDeleting(d)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing in this view.</p>}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-lg">
          {detail && dm && (
            <div className="space-y-5">
              <DialogHeader>
                <DialogTitle className="text-lg">{detail.bank} fixed deposit</DialogTitle>
                <DialogDescription>{dm.rate}% a year · {formatDate(detail.startDate)} to {formatDate(detail.maturityDate)} · {detail.currency}</DialogDescription>
              </DialogHeader>
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-muted-foreground"><span>{Math.round(dm.progress)}% of the term done</span><span>{dm.matured ? "Matured" : `${dm.daysLeft} days to go`}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-positive transition-[width] duration-700" style={{ width: `${dm.progress}%` }} /></div>
              </div>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {[
                  ["Invested", formatMoney(dm.principal, detail.currency)],
                  ["Value now", formatMoney(Math.round(dm.value * 100) / 100, detail.currency)],
                  ["Interest so far", `+${formatMoney(Math.round(dm.earned * 100) / 100, detail.currency)}`],
                  ["Value at maturity", formatMoney(Math.round(dm.atMaturity * 100) / 100, detail.currency)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-border p-3"><dt className="eyebrow">{k}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{v}</dd></div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">Estimated with simple interest. Your bank may compound, so the final figure can be a little higher. <Equivalent value={dm.value} currency={detail.currency} /></p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmAction open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete this ${deleting?.bank} deposit?`} description={<p>It&apos;s removed from your portfolio. No account balance changes.</p>} confirmLabel="Delete deposit" onConfirm={() => onDelete(deleting!.id)} />
    </Panel>
  );
}

// ---------------------------------------------------------------- other assets

export interface AssetRow {
  id: string;
  assetType: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  purchasePrice: string;
  currentValue: string;
  currency: string;
  purchaseDate: string;
  notes?: string | null;
}

export function AssetTable({ assets, loading, typeLabel, onDelete, onChanged }: { assets: AssetRow[]; loading: boolean; typeLabel: (t: string) => string; onDelete: (id: string) => void; onChanged: () => void }) {
  const [type, setType] = useState("ALL");
  const [now] = useState(() => Date.now());
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AssetRow | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const types = [...new Set(assets.map((a) => a.assetType))];
  const rows = useMemo(
    () =>
      assets
        .filter((a) => type === "ALL" || a.assetType === type)
        .map((a) => {
          const cost = Number(a.purchasePrice);
          const cur = Number(a.currentValue);
          return { a, cost, cur, pl: cur - cost, plPct: cost > 0 ? ((cur - cost) / cost) * 100 : 0 };
        }),
    [assets, type]
  );
  const sort = useSort(rows, { name: (r) => r.a.name, cost: (r) => r.cost, cur: (r) => r.cur, pl: (r) => r.pl }, "cur");

  if (loading) return <SkeletonBlock className="h-40" />;
  if (!assets.length) return <EmptyState icon={<LineChart className="h-5 w-5" />} title="Nothing here yet">Gold, property, crypto, collectibles: anything with a value you want counted.</EmptyState>;
  const detail = open ? assets.find((x) => x.id === open) : null;

  async function saveValue() {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/investments/other/${detail.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentValue: Number(value) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't update the value.");
      toast.success("Value updated.");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div role="radiogroup" aria-label="Type" className="inline-flex flex-wrap rounded-lg bg-muted p-0.5 text-xs">
          {["ALL", ...types].map((t) => (
            <button key={t} role="radio" aria-checked={type === t} onClick={() => setType(t)} className={cn("h-7 cursor-pointer rounded-md px-2.5 transition-colors", type === t ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>
              {t === "ALL" ? "All" : typeLabel(t)}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "asset" : "assets"}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground">
              <SortTh k="name" label="Asset" sort={sort} className="pl-4" />
              <SortTh k="cost" label="Paid" sort={sort} align="right" className="hidden md:table-cell" />
              <SortTh k="cur" label="Value now" sort={sort} align="right" />
              <SortTh k="pl" label="Profit / loss" sort={sort} align="right" />
              <th />
            </tr>
          </thead>
          <tbody>
            {sort.sorted.map(({ a, cost, cur, pl, plPct }) => (
              <tr key={a.id} className="border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40">
                <td className="max-w-[240px] py-2.5 pr-3 pl-4">
                  <button onClick={() => { setOpen(a.id); setValue(String(Number(a.currentValue))); }} className="block cursor-pointer truncate text-left font-medium hover:underline">{a.name}</button>
                  <p className="truncate text-xs text-muted-foreground">{typeLabel(a.assetType)}{a.quantity ? ` · ${Number(a.quantity)} ${a.unit ?? ""}` : ""}</p>
                </td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{formatMoney(cost, a.currency)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatMoney(cur, a.currency)}
                  <p><Equivalent value={cur} currency={a.currency} /></p>
                </td>
                <td className={cn("px-3 py-2.5 text-right tabular-nums", tone(pl))}>
                  {signed(pl, a.currency)}
                  <p className="text-xs">{pct(plPct)}</p>
                </td>
                <td className="pr-3 text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon-sm" aria-label={`Details for ${a.name}`} onClick={() => { setOpen(a.id); setValue(String(Number(a.currentValue))); }}><Eye className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${a.name}`} onClick={() => setDeleting(a)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!detail} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-lg">
          {detail && (() => {
            const cost = Number(detail.purchasePrice);
            const cur = Number(detail.currentValue);
            const yrs = (now - new Date(detail.purchaseDate).getTime()) / (365.25 * 86_400_000);
            const cagr = yrs >= 1 && cost > 0 && cur > 0 ? (Math.pow(cur / cost, 1 / yrs) - 1) * 100 : null;
            return (
              <div className="space-y-5">
                <DialogHeader>
                  <DialogTitle className="text-lg">{detail.name}</DialogTitle>
                  <DialogDescription>{typeLabel(detail.assetType)} · bought {formatDate(detail.purchaseDate)}{detail.quantity ? ` · ${Number(detail.quantity)} ${detail.unit ?? ""}` : ""} · {detail.currency}</DialogDescription>
                </DialogHeader>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    ["Paid", formatMoney(cost, detail.currency)],
                    ["Value now", formatMoney(cur, detail.currency)],
                    ["Profit / loss", `${signed(cur - cost, detail.currency)} (${pct(cost > 0 ? ((cur - cost) / cost) * 100 : null)})`],
                    ["Per year", cagr == null ? "After a year" : pct(cagr)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-border p-3"><dt className="eyebrow">{k}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{v}</dd></div>
                  ))}
                </dl>
                {detail.notes && <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{detail.notes}</p>}
                <div className="flex items-end gap-2">
                  <label className="flex-1 space-y-1.5 text-xs"><span className="text-muted-foreground">Update today&apos;s value ({detail.currency})</span><Input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></label>
                  <Button onClick={saveValue} disabled={busy || !(Number(value) >= 0) || Number(value) === cur}>{busy ? "Saving…" : "Save value"}</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
      <ConfirmAction open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete ${deleting?.name}?`} description={<p>It&apos;s removed from your portfolio. No account balance changes.</p>} confirmLabel="Delete asset" onConfirm={() => onDelete(deleting!.id)} />
    </Panel>
  );
}
