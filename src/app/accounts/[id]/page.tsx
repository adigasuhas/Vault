"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/client";
import { formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { PageHeader, Panel, EmptyState, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { Money } from "@/components/app/Money";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CloseAccountDialog } from "@/components/accounts/CloseAccountDialog";
import { kindOf } from "@/components/accounts/account-kinds";
import { ArrowLeft, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Equivalent } from "@/components/app/Money";

interface Row {
  id: string;
  type: string;
  amount: number;
  signed: number;
  currency: string;
  date: string;
  description: string | null;
  categoryName: string | null;
  counterpartyName: string | null;
  scheduleName: string | null;
  reversedAt: string | null;
  isReversal: boolean;
  runningBalance: number;
}
interface Data {
  account: { id: string; name: string; bankName: string | null; accountNumber: string | null; currency: string; accountType: string; currentBalance: string; status: string; closedAt: string | null; closureNote: string | null; openingDate: string | null; createdAt: string };
  ledgerEntries: Row[];
  total: number;
  hasMore: boolean;
  page: number;
  reconciled: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  EXPENSE: "Expense",
  INCOME: "Income",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  ADJUSTMENT: "Adjustment",
  OPENING: "Opening balance",
  REVERSAL: "Reversal",
  INVESTMENT_SALE: "Investment sale",
  INVESTMENT_PURCHASE: "Investment purchase",
};

function describe(r: Row) {
  if (r.type === "OPENING") return "Opening balance";
  if (r.type === "TRANSFER_IN") return `From ${r.counterpartyName ?? "another account"}${r.description ? ` · ${r.description}` : ""}`;
  if (r.type === "TRANSFER_OUT") return `To ${r.counterpartyName ?? "another account"}${r.description ? ` · ${r.description}` : ""}`;
  return r.description || r.scheduleName || r.categoryName || TYPE_LABEL[r.type];
}

export default function AccountStatementPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [closing, setClosing] = useState(false);
  const [allAccounts, setAllAccounts] = useState<{ id: string; name: string; currency: string; currentBalance: string; status: string }[]>([]);

  const load = useCallback(async () => {
    setError(null);
    const q = new URLSearchParams({ page: String(page) });
    if (type !== "ALL") q.set("type", type);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    try {
      setData(await api<Data>(`/api/accounts/${id}?${q}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, type, from, to, page]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api<{ accounts: typeof allAccounts }>("/api/accounts").then((d) => setAllAccounts(d.accounts)).catch(() => {});
  }, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <div className="space-y-4"><SkeletonBlock className="h-16 w-80" /><SkeletonBlock className="h-96" /></div>;

  const a = data.account;
  const closed = a.status === "CLOSED";
  // The whole statement, from the month the account opened (statements aren't
  // bound by the 5-year cap on monthly reports).
  const thisMonth = new Date().toISOString().slice(0, 7);
  const sinceMonth = [a.openingDate, a.createdAt].map((d) => (d || "").slice(0, 7)).find((m) => /^\d{4}-\d{2}$/.test(m) && m <= thisMonth) ?? thisMonth;
  const csvHref = `/api/reports/statement?format=csv&accountId=${a.id}&from=${sinceMonth}&to=${thisMonth}`;

  return (
    <div className="space-y-6">
      <Link href="/accounts" className="settle inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Accounts
      </Link>
      <PageHeader
        eyebrow={[kindOf(a.accountType).label, a.bankName, a.accountNumber ? `•••• ${a.accountNumber.slice(-4)}` : null].filter(Boolean).join(" · ")}
        title={a.name}
        description={closed ? `Closed ${formatDate(a.closedAt)}${a.closureNote ? ` (${a.closureNote})` : ""}. The statement stays here for your records.` : undefined}
        actions={
          <>
            <Button variant="outline" asChild><a href={csvHref}><Download /> CSV</a></Button>
            {!closed && <Button variant="outline" asChild><Link href={`/accounts?tab=transfers&new=1&from=${a.id}`}>Transfer</Link></Button>}
            {!closed && <Button variant="ghost" className="text-negative hover:text-negative" onClick={() => setClosing(true)}>Close account</Button>}
          </>
        }
      />

      <div className="settle flex flex-wrap items-end justify-between gap-6 border-y border-border py-5">
        <div>
          <p className="eyebrow">Balance</p>
          <p className={cn("mt-1 font-display text-[2.1rem] leading-none tabular-nums", Number(a.currentBalance) < 0 && "text-negative")}>{formatMoney(a.currentBalance, a.currency)}</p>
          <Equivalent value={Number(a.currentBalance)} currency={a.currency} className="text-sm" />
        </div>
        <div className="flex items-center gap-2 text-xs">
          {data.reconciled ? (
            <span className="inline-flex items-center gap-1.5 text-positive"><CheckCircle2 className="h-4 w-4" /> Balance matches the sum of {data.total} entries</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-negative"><AlertTriangle className="h-4 w-4" /> Balance doesn&apos;t match the ledger. Contact support</span>
          )}
        </div>
      </div>

      <div className="settle flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={(v) => { setType(v); setPage(0); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All entries</SelectItem>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="w-40" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="w-40" />
        {(type !== "ALL" || from || to) && (
          <Button variant="ghost" size="sm" onClick={() => { setType("ALL"); setFrom(""); setTo(""); setPage(0); }}>Clear</Button>
        )}
      </div>

      <Panel padded={false} className="settle overflow-hidden">
        {data.ledgerEntries.length === 0 ? (
          <div className="p-6"><EmptyState title="No entries match">Try clearing the filters.</EmptyState></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Description</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.ledgerEntries.map((r) => (
                  <tr key={r.id} className={cn("border-b border-border/60 last:border-0", (r.reversedAt || r.isReversal) && "bg-muted/40")}>
                    <td className="px-5 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground">{formatDate(r.date)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(r.reversedAt && "text-muted-foreground line-through decoration-muted-foreground/50")}>{describe(r)}</span>
                        {r.categoryName && r.type === "EXPENSE" && r.description && <span className="text-xs text-muted-foreground">{r.categoryName}</span>}
                        {r.reversedAt && <StatusBadge tone="neutral">Reversed</StatusBadge>}
                        {r.isReversal && <StatusBadge tone="outline">Reversal</StatusBadge>}
                        {r.type === "ADJUSTMENT" && <StatusBadge tone="info">Adjustment</StatusBadge>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right"><Money value={r.signed} currency={r.currency} signed className={cn("font-medium", r.reversedAt && "opacity-60")} /></td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{formatMoney(Math.round(r.runningBalance * 100) / 100, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(data.page > 0 || data.hasMore) && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <span>{data.total} entries</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</Button>
              <Button size="sm" variant="outline" disabled={!data.hasMore} onClick={() => setPage((p) => p + 1)}>Older</Button>
            </div>
          </div>
        )}
      </Panel>

      <CloseAccountDialog
        account={closing ? { id: a.id, name: a.name, currency: a.currency, currentBalance: a.currentBalance, status: a.status } : null}
        accounts={allAccounts}
        open={closing}
        onOpenChange={setClosing}
        onClosed={load}
      />
    </div>
  );
}
