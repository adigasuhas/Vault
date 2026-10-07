"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, History, Search, Undo2 } from "lucide-react";
import { formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { heldFor, type SoldLot } from "@/lib/fifo";
import { useCurrency } from "@/context/CurrencyContext";
import { Equivalent } from "@/components/app/Money";
import { EmptyState, Panel, SkeletonBlock, Stat } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SaleRow {
  id: string;
  kind: "STOCK" | "MUTUAL_FUND" | "FIXED_DEPOSIT" | "OTHER";
  name: string;
  detail: string | null;
  currency: string;
  quantity: string | null;
  price: string | null;
  grossProceeds: string;
  charges: string;
  netProceeds: string;
  costBasis: string;
  realizedPnl: string;
  firstBoughtOn: string;
  soldOn: string;
  closedPosition: boolean;
  creditedAmount: string;
  lots: SoldLot[];
  snapshot: Record<string, unknown>;
  note: string | null;
  reversedAt: string | null;
  account: { id: string; name: string; currency: string; status: string };
}

const KINDS = [
  ["ALL", "All"],
  ["STOCK", "Stocks"],
  ["MUTUAL_FUND", "Funds"],
  ["FIXED_DEPOSIT", "Deposits"],
  ["OTHER", "Other"],
] as const;
const KIND_LABEL: Record<SaleRow["kind"], string> = { STOCK: "Stock", MUTUAL_FUND: "Mutual fund", FIXED_DEPOSIT: "Fixed deposit", OTHER: "Other asset" };

const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-muted-foreground");
const signed = (n: number, c: string) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatMoney(Math.abs(n), c)}`;
const pct = (pnl: number, cost: number) => (cost > 0 ? `${pnl >= 0 ? "+" : "−"}${Math.abs((pnl / cost) * 100).toFixed(2)}%` : "–");
const qtyText = (s: SaleRow) => (s.quantity ? `${Number(s.quantity)} × ${formatMoney(Number(s.price), s.currency)}` : s.kind === "FIXED_DEPOSIT" ? String(s.detail ?? "") : "Whole asset");
const NOUN: Record<SaleRow["kind"], string> = { STOCK: "sale", MUTUAL_FUND: "redemption", FIXED_DEPOSIT: "closure", OTHER: "sale" };
const verb = (k: SaleRow["kind"]) => (k === "FIXED_DEPOSIT" ? "Closed" : k === "MUTUAL_FUND" ? "Redeemed" : "Sold");

export function SalesHistory({ sales, loading, onChanged }: { sales: SaleRow[]; loading: boolean; onChanged: () => void }) {
  const fx = useCurrency();
  const primary = fx.primary;
  const toPrimary = (n: number, c: string) => fx.toPrimaryAmount(n, c) ?? n;
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("ALL");
  const [year, setYear] = useState("ALL");
  const [q, setQ] = useState("");
  const [showUndone, setShowUndone] = useState(false);
  const [open, setOpen] = useState<SaleRow | null>(null);
  const [undoing, setUndoing] = useState<SaleRow | null>(null);

  const years = useMemo(() => [...new Set(sales.map((s) => s.soldOn.slice(0, 4)))].sort().reverse(), [sales]);
  const rows = useMemo(
    () =>
      sales.filter(
        (s) =>
          (showUndone || !s.reversedAt) &&
          (kind === "ALL" || s.kind === kind) &&
          (year === "ALL" || s.soldOn.startsWith(year)) &&
          (!q || `${s.name} ${s.detail ?? ""} ${s.note ?? ""}`.toLowerCase().includes(q.toLowerCase()))
      ),
    [sales, kind, year, q, showUndone]
  );
  const live = rows.filter((s) => !s.reversedAt);
  const total = (pick: (s: SaleRow) => string) => live.reduce((sum, s) => sum + toPrimary(Number(pick(s)), s.currency), 0);
  const pnl = total((s) => s.realizedPnl);
  const cost = total((s) => s.costBasis);
  const gains = live.filter((s) => Number(s.realizedPnl) > 0).reduce((sum, s) => sum + toPrimary(Number(s.realizedPnl), s.currency), 0);
  const losses = pnl - gains;
  const undoneCount = sales.filter((s) => s.reversedAt).length;

  async function undo(s: SaleRow) {
    const res = await fetch(`/api/investments/sales/${s.id}/undo`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "Couldn't undo the sale.");
      return;
    }
    toast.success(`Undone. ${s.name} is back in your portfolio and the money left ${s.account.name}.`);
    setOpen(null);
    onChanged();
  }

  function exportCsv() {
    const head = ["Date", "Type", "Investment", "Detail", "Quantity", "Price", "Sale value", "Charges", "Received", "Cost", "Profit/loss", "Return %", "Currency", "First bought", "Held", "Credited to", "Credited amount", "Account currency", "Status", "Note"];
    const esc = (v: unknown) => {
      const t = v == null ? "" : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines = rows.map((s) =>
      [
        s.soldOn.slice(0, 10), KIND_LABEL[s.kind], s.name, s.detail, s.quantity ? Number(s.quantity) : "", s.price ? Number(s.price) : "",
        Number(s.grossProceeds), Number(s.charges), Number(s.netProceeds), Number(s.costBasis), Number(s.realizedPnl),
        Number(s.costBasis) > 0 ? ((Number(s.realizedPnl) / Number(s.costBasis)) * 100).toFixed(2) : "", s.currency,
        s.firstBoughtOn.slice(0, 10), heldFor(s.firstBoughtOn, s.soldOn), s.account.name, Number(s.creditedAmount), s.account.currency,
        s.reversedAt ? "Undone" : "Done", s.note,
      ].map(esc).join(",")
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vault-sold-and-closed-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading) return <SkeletonBlock className="h-48" />;
  if (!sales.length)
    return (
      <EmptyState icon={<History className="h-5 w-5" />} title="Nothing sold or closed yet">
        Sell shares, redeem fund units, close a deposit or sell an asset from its row in the other tabs. The money goes to an account you choose, and the trade shows up here with its profit or loss.
      </EmptyState>
    );

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden p-0">
        <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
          <div className="bg-card p-5">
            <Stat label="Realised profit / loss" value={<span className={tone(pnl)}>{signed(Math.round(pnl), primary)}</span>} hint={<><Equivalent both signed value={pnl} currency={primary} className="block text-xs" />{cost > 0 && <span className="block">{pct(pnl, cost)} on what was sold</span>}</>} />
          </div>
          <div className="bg-card p-5"><Stat label="Gains · losses" value={<span className="text-base"><span className="text-positive">+{formatMoney(Math.round(gains), primary)}</span> <span className="text-muted-foreground">·</span> <span className={tone(losses)}>{signed(Math.round(losses), primary)}</span></span>} hint={<><Equivalent both value={gains} currency={primary} /> <span className="text-muted-foreground">·</span> <Equivalent both value={losses} currency={primary} /></>} /></div>
          <div className="bg-card p-5"><Stat label="Received" value={formatMoney(Math.round(total((s) => s.netProceeds)), primary)} hint={<><Equivalent both value={total((s) => s.netProceeds)} currency={primary} className="block text-xs" /><span className="block">After {formatMoney(Math.round(total((s) => s.charges)), primary)} in charges</span></>} /></div>
          <div className="bg-card p-5"><Stat label="Trades and closures" value={live.length} hint={<><span className="block">Cost of what was sold {formatMoney(Math.round(cost), primary)}</span><Equivalent both value={cost} currency={primary} className="block text-xs" /></>} /></div>
        </div>
      </Panel>

      <Panel padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search sales" className="h-8 w-40 pl-8" />
          </div>
          <div role="radiogroup" aria-label="Type" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
            {KINDS.map(([k, label]) => (
              <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("h-7 cursor-pointer rounded-md px-2.5 transition-colors", kind === k ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>
                {label}
              </button>
            ))}
          </div>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger size="sm" className="h-8 w-28" aria-label="Year"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All years</SelectItem>
              {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          {undoneCount > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" className="accent-[var(--brass)]" checked={showUndone} onChange={(e) => setShowUndone(e.target.checked)} />
              Show undone ({undoneCount})
            </label>
          )}
          <Button variant="outline" size="sm" className="ml-auto" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> CSV</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                <th className="py-2.5 pr-3 pl-4 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Investment</th>
                <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">Cost</th>
                <th className="px-3 py-2.5 text-right font-medium">Received</th>
                <th className="px-3 py-2.5 text-right font-medium">Profit / loss</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Held</th>
                <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Credited to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const p = Number(s.realizedPnl);
                return (
                  <tr key={s.id} onClick={() => setOpen(s)} className={cn("cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40", s.reversedAt && "opacity-55")}>
                    <td className="py-2.5 pr-3 pl-4 font-mono text-xs whitespace-nowrap">{formatDate(s.soldOn)}</td>
                    <td className="max-w-[240px] px-3 py-2.5">
                      <p className={cn("truncate font-medium", s.reversedAt && "line-through")}>{s.name}</p>
                      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {verb(s.kind)} · {qtyText(s)}
                        {s.reversedAt && <StatusBadge tone="neutral">Undone</StatusBadge>}
                        {!s.reversedAt && !s.closedPosition && <StatusBadge tone="info" dot={false}>Partial</StatusBadge>}
                      </p>
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{formatMoney(Number(s.costBasis), s.currency)}<Equivalent both stack value={Number(s.costBasis)} currency={s.currency} /></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(Number(s.netProceeds), s.currency)}<Equivalent both stack value={Number(s.netProceeds)} currency={s.currency} /></td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", tone(p))}>
                      {signed(p, s.currency)}
                      <p className="text-xs">{pct(p, Number(s.costBasis))}</p>
                      <Equivalent both stack signed value={p} currency={s.currency} />
                    </td>
                    <td className="hidden px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground lg:table-cell">{heldFor(s.firstBoughtOn, s.soldOn)}</td>
                    <td className="hidden max-w-[160px] truncate px-3 py-2.5 text-xs text-muted-foreground sm:table-cell">{s.account.name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing matches. Try another filter.</p>}
      </Panel>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {open && <SaleDetail s={open} onUndo={() => setUndoing(open)} />}
        </DialogContent>
      </Dialog>
      <ConfirmAction
        open={!!undoing}
        onOpenChange={(o) => !o && setUndoing(null)}
        title={`Undo this ${undoing ? NOUN[undoing.kind] : "sale"}?`}
        description={
          <p>
            {undoing && `${formatMoney(Number(undoing.creditedAmount), undoing.account.currency)} is taken back out of ${undoing.account.name} and ${undoing.name} returns to your portfolio. `}
            The sale stays here marked as undone, and both entries stay in the ledger.
          </p>
        }
        confirmLabel="Undo"
        onConfirm={() => undo(undoing!)}
      />
    </div>
  );
}

function SaleDetail({ s, onUndo }: { s: SaleRow; onUndo: () => void }) {
  const c = s.currency;
  const p = Number(s.realizedPnl);
  const qty = s.quantity ? Number(s.quantity) : null;
  const net = Number(s.netProceeds);
  const snap = s.snapshot as { maturityDate?: string; prematureClosure?: boolean; interestRate?: string };
  const facts: [string, React.ReactNode][] = [
    [s.kind === "FIXED_DEPOSIT" ? "Closed on" : "Sold on", formatDate(s.soldOn)],
    [s.kind === "FIXED_DEPOSIT" ? "Opened on" : "First bought", formatDate(s.firstBoughtOn)],
    ["Held for", heldFor(s.firstBoughtOn, s.soldOn)],
    ...(qty != null ? ([[s.kind === "MUTUAL_FUND" ? "Units" : "Shares", qty], [s.kind === "MUTUAL_FUND" ? "NAV" : "Price", formatMoney(Number(s.price), c)]] as [string, React.ReactNode][]) : []),
    ...(s.kind === "FIXED_DEPOSIT" && snap.maturityDate ? ([["Was due to mature", `${formatDate(snap.maturityDate)}${snap.prematureClosure ? " (closed early)" : ""}`]] as [string, React.ReactNode][]) : []),
    [s.kind === "FIXED_DEPOSIT" ? "Paid out" : "Sale value", <M key="g" v={Number(s.grossProceeds)} c={c} />],
    ["Charges", Number(s.charges) > 0 ? <M key="ch" v={-Number(s.charges)} c={c} /> : "None"],
    ["Received", <M key="n" v={net} c={c} />],
    [s.kind === "FIXED_DEPOSIT" ? "Principal" : "Cost", <M key="co" v={Number(s.costBasis)} c={c} />],
    [
      s.kind === "FIXED_DEPOSIT" ? "Interest earned" : "Profit / loss",
      <span key="pl" className={cn("font-medium", tone(p))}>
        {signed(p, c)} ({pct(p, Number(s.costBasis))})
        <Equivalent both stack signed value={p} currency={c} />
      </span>,
    ],
    [
      "Credited to",
      <span key="acct">
        <Link href={`/accounts/${s.account.id}`} className="underline-offset-2 hover:underline">{s.account.name}</Link>
        {" · "}
        {formatMoney(Number(s.creditedAmount), s.account.currency)}
      </span>,
    ],
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {s.name}
          <StatusBadge tone="outline" dot={false}>{KIND_LABEL[s.kind]}</StatusBadge>
          {s.reversedAt && <StatusBadge tone="neutral">Undone {formatDate(s.reversedAt)}</StatusBadge>}
        </DialogTitle>
        <DialogDescription>
          {verb(s.kind)} {s.closedPosition ? (s.kind === "STOCK" || s.kind === "MUTUAL_FUND" ? "the whole holding" : "") : "part of the holding"}
          {s.detail && s.kind !== "FIXED_DEPOSIT" ? ` · ${s.detail}` : ""} · {c}
        </DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {facts.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border/60 pb-1.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {s.note && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{s.note}</p>}

      {qty != null && s.lots.length > 0 && (
        <div>
          <p className="eyebrow mb-2">Purchases sold (oldest first)</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                  <th className="px-3 py-2 font-medium">Bought</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Profit / loss</th>
                  <th className="px-3 py-2 font-medium">Held</th>
                </tr>
              </thead>
              <tbody>
                {s.lots.map((l, i) => {
                  // Proceeds (after charges) are shared out by quantity.
                  const share = qty > 0 && l.quantity != null ? (net * l.quantity) / qty : 0;
                  const lp = share - l.cost;
                  return (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{formatDate(l.purchaseDate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.price != null ? formatMoney(l.price, c) : "–"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.cost, c)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", tone(lp))}>{signed(Math.round(lp * 100) / 100, c)}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">{heldFor(l.purchaseDate, s.soldOn)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!s.reversedAt && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">Recorded by mistake? Undoing takes the money back out and returns the holding.</p>
          <Button variant="outline" size="sm" onClick={onUndo}><Undo2 className="h-4 w-4" /> Undo…</Button>
        </div>
      )}
    </>
  );
}

/** An amount with its primary and secondary equivalents underneath. */
function M({ v, c }: { v: number; c: string }) {
  return (
    <span>
      {v < 0 ? "−" : ""}
      {formatMoney(Math.abs(v), c)}
      <Equivalent both stack value={Math.abs(v)} currency={c} />
    </span>
  );
}
