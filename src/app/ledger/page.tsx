"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { formatDate } from "@/lib/format";
import { PageHeader, Panel, EmptyState, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { Money } from "@/components/app/Money";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileSpreadsheet, ScrollText, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  date: string;
  type: string;
  typeLabel: string;
  account: { id: string; name: string; currency: string; status: string } | null;
  category: string | null;
  description: string;
  amount: number;
  currency: string;
  reversedAt: string | null;
  isReversal: boolean;
}
interface Data { entries: Row[]; total: number; page: number; hasMore: boolean }

const TYPES: [string, string][] = [
  ["ALL", "All types"],
  ["EXPENSE", "Expenses"],
  ["INCOME", "Income"],
  ["TRANSFER_OUT", "Transfers out"],
  ["TRANSFER_IN", "Transfers in"],
  ["REVERSAL", "Reversals"],
  ["ADJUSTMENT", "Adjustments"],
  ["OPENING", "Opening balances"],
];

export default function LedgerPage() {
  const [accounts, setAccounts] = useState<{ id: string; name: string; status: string }[]>([]);
  const [accountId, setAccountId] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ accounts: { id: string; name: string; status: string }[] }>("/api/accounts?includeClosed=1").then((d) => setAccounts(d.accounts)).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (accountId !== "ALL") p.set("accountId", accountId);
    if (type !== "ALL") p.set("type", type);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (query) p.set("q", query);
    return p;
  }, [accountId, type, from, to, query]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<Data>(`/api/ledger?${params}&page=${page}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [params, page]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(0), [params]);

  const filtered = accountId !== "ALL" || type !== "ALL" || from || to || query;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ledger"
        description="Every entry ever recorded, across all accounts. Nothing here is ever deleted: a correction or reversal appears as its own entry."
        actions={
          <>
            <Button variant="outline" asChild><a href={`/api/ledger?${params}&format=csv`}><Download /> CSV</a></Button>
            <Button asChild><a href={`/api/ledger?${params}&format=xlsx`}><FileSpreadsheet /> Excel</a></Button>
          </>
        }
      />

      <div className="settle flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search descriptions" className="w-56 pl-8" aria-label="Search" />
        </div>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All accounts</SelectItem>
            {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.status === "CLOSED" ? " (closed)" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        {filtered && <Button size="sm" variant="ghost" onClick={() => { setAccountId("ALL"); setType("ALL"); setFrom(""); setTo(""); setQ(""); }}>Clear</Button>}
        {data && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{data.total.toLocaleString()} entries</span>}
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      <Panel padded={false} className="settle overflow-hidden">
        {!data ? (
          <div className="space-y-2 p-5">{[0, 1, 2, 3, 4].map((i) => <SkeletonBlock key={i} className="h-9" />)}</div>
        ) : data.entries.length === 0 ? (
          <div className="p-6"><EmptyState icon={<ScrollText className="h-5 w-5" />} title={filtered ? "No entries match these filters" : "Your ledger is empty"}>{filtered ? "Try clearing a filter." : "Add an account and every movement of money will show up here."}</EmptyState></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Description</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Account</th>
                  <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Type</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((r) => (
                  <tr key={r.id} className={cn("border-b border-border/60 last:border-0 transition-colors hover:bg-muted/40", (r.reversedAt || r.isReversal) && "bg-muted/30")}>
                    <td className="px-5 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">{formatDate(r.date)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(r.reversedAt && "text-muted-foreground line-through decoration-muted-foreground/40")}>{r.description}</span>
                        {r.category && r.description !== r.category && <span className="text-xs text-muted-foreground">{r.category}</span>}
                        {r.reversedAt && <StatusBadge tone="neutral">Reversed</StatusBadge>}
                        {r.isReversal && <StatusBadge tone="outline">Reversal</StatusBadge>}
                      </div>
                      <p className="text-xs text-muted-foreground md:hidden">{r.account?.name ?? "No account"}</p>
                    </td>
                    <td className="hidden px-3 py-2.5 md:table-cell">
                      {r.account ? <Link href={`/accounts/${r.account.id}`} className="text-muted-foreground hover:text-foreground hover:underline">{r.account.name}</Link> : <span className="text-muted-foreground">No account</span>}
                    </td>
                    <td className="hidden px-3 py-2.5 text-xs text-muted-foreground lg:table-cell">{r.typeLabel}</td>
                    <td className="px-5 py-2.5 text-right">
                      <Money value={r.amount} currency={r.currency} signed tone={r.amount > 0 ? "positive" : "plain"} equivalent="below" className={cn("font-medium", r.reversedAt && "opacity-60")} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (data.page > 0 || data.hasMore) && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <span>Page {data.page + 1}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</Button>
              <Button size="sm" variant="outline" disabled={!data.hasMore} onClick={() => setPage((p) => p + 1)}>Older</Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
