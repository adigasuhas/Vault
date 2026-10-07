"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError, localToday, newKey } from "@/lib/client";
import { formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { Panel, Section, EmptyState, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmAction } from "@/components/ConfirmAction";
import { isCredit } from "@/components/accounts/account-kinds";
import { ArrowDown, ArrowLeftRight, AlertTriangle, MoreHorizontal, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Account {
  id: string;
  name: string;
  currency: string;
  currentBalance: string;
  accountType: string;
  creditLimit: string | null;
  status: string;
}
interface Transfer {
  id: string;
  amount: string;
  currency: string;
  toAmount: string | null;
  toCurrency: string | null;
  date: string;
  notes: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
  fromAccount: { id: string; name: string; status: string };
  toAccount: { id: string; name: string; status: string };
}

function available(a: Account) {
  const bal = Number(a.currentBalance);
  if (isCredit(a.accountType)) return a.creditLimit != null ? Number(a.creditLimit) + bal : Infinity;
  return bal;
}

function TransferDialog({
  open,
  onOpenChange,
  accounts,
  initialFrom,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accounts: Account[];
  initialFrom?: string | null;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<"compose" | "review">("compose");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [date, setDate] = useState(localToday());
  const [notes, setNotes] = useState("");
  const [key, setKey] = useState(newKey());
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(false);

  useEffect(() => {
    if (open) {
      setStage("compose");
      setFromId(initialFrom ?? "");
      setToId("");
      setAmount("");
      setToAmount("");
      setDate(localToday());
      setNotes("");
      setKey(newKey());
      setDuplicate(false);
    }
  }, [open, initialFrom]);

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const amt = Number(amount);
  const cross = !!from && !!to && from.currency !== to.currency;
  const arriving = cross ? Number(toAmount) : amt;
  const avail = from ? available(from) : 0;
  const problems: string[] = [];
  if (from && to && from.id === to.id) problems.push("Pick two different accounts.");
  if (amount && !(amt > 0)) problems.push("Enter an amount greater than zero.");
  if (from && amt > 0 && amt > avail + 0.005)
    problems.push(isCredit(from.accountType) ? `That would exceed ${from.name}'s credit limit.` : `${from.name} has only ${formatMoney(avail, from.currency)} available.`);
  if (cross && toAmount && !(arriving > 0)) problems.push(`Enter the ${to!.currency} amount that arrives.`);
  if (date > localToday()) problems.push("A transfer can't be dated in the future. Schedule it instead.");
  const ready = !!from && !!to && amt > 0 && (!cross || arriving > 0) && problems.length === 0;

  async function send(confirmDuplicate = false) {
    setBusy(true);
    try {
      const r = await api<{ duplicate: boolean }>("/api/transfers", {
        body: { fromAccountId: fromId, toAccountId: toId, amount: amt, toAmount: cross ? arriving : undefined, date, notes: notes || undefined, idempotencyKey: key, confirmDuplicate },
      });
      toast.success(r.duplicate ? "That transfer was already recorded. Nothing was sent twice." : `Moved ${formatMoney(amt, from!.currency)} to ${to!.name}.`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE") {
        setDuplicate(true);
        setKey(newKey());
      } else toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        {stage === "compose" ? (
          <>
            <DialogHeader>
              <DialogTitle>New transfer</DialogTitle>
              <DialogDescription>Between your own accounts. You&apos;ll review it before anything moves.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>From</Label>
                <Select value={fromId} onValueChange={setFromId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id} disabled={a.id === toId}>
                        {a.name} <span className="text-muted-foreground">· {formatMoney(a.currentBalance, a.currency)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-center">
                <button
                  type="button"
                  aria-label="Swap accounts"
                  onClick={() => { setFromId(toId); setToId(fromId); }}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-1.5">
                <Label>To</Label>
                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id} disabled={a.id === fromId}>
                        {a.name} <span className="text-muted-foreground">· {a.currency}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className={cn("grid gap-3", cross ? "grid-cols-2" : "grid-cols-[1fr_auto]")}>
                <div className="space-y-1.5">
                  <Label htmlFor="t-amt">Amount{from ? ` (${from.currency})` : ""}</Label>
                  <Input id="t-amt" type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-base tabular-nums" />
                </div>
                {cross ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="t-toamt">Arrives as ({to!.currency})</Label>
                    <Input id="t-toamt" type="number" inputMode="decimal" step="0.01" min="0" value={toAmount} onChange={(e) => setToAmount(e.target.value)} className="text-base tabular-nums" />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="t-date">Date</Label>
                    <Input id="t-date" type="date" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
                  </div>
                )}
              </div>
              {cross && amt > 0 && arriving > 0 && (
                <p className="text-xs text-muted-foreground">Rate: 1 {to!.currency} = {(amt / arriving).toFixed(4)} {from!.currency}</p>
              )}
              {cross && (
                <div className="space-y-1.5">
                  <Label htmlFor="t-date2">Date</Label>
                  <Input id="t-date2" type="date" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="t-note">Note</Label>
                <Input id="t-note" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, like Card bill for September" />
              </div>
              {problems.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-negative-soft px-3 py-2 text-xs text-negative">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!ready} onClick={() => setStage("review")}>Review transfer</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Review and confirm</DialogTitle>
              <DialogDescription>Check the accounts and amount. Nothing has moved yet.</DialogDescription>
            </DialogHeader>
            <div className="overflow-hidden rounded-lg border border-border">
              {[{ a: from!, delta: -amt, cur: from!.currency }, { a: to!, delta: arriving, cur: to!.currency }].map(({ a, delta, cur }, i) => (
                <div key={a.id} className={cn("flex items-center justify-between gap-3 px-4 py-3", i === 0 && "border-b border-border")}>
                  <div>
                    <p className="eyebrow">{i === 0 ? "From" : "To"}</p>
                    <p className="mt-0.5 text-sm font-medium">{a.name}</p>
                  </div>
                  <div className="text-right text-xs tabular-nums">
                    <p className={cn("text-sm font-semibold", delta < 0 ? "text-foreground" : "text-positive")}>
                      {delta < 0 ? "−" : "+"}{formatMoney(Math.abs(delta), cur)}
                    </p>
                    <p className="text-muted-foreground">
                      {formatMoney(a.currentBalance, cur)} → {formatMoney(Number(a.currentBalance) + delta, cur)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <dl className="grid grid-cols-[90px_1fr] gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Date</dt>
              <dd>{formatDate(date)}</dd>
              {notes && (<><dt className="text-muted-foreground">Note</dt><dd>{notes}</dd></>)}
            </dl>
            {duplicate && (
              <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>The same transfer between these accounts was made in the last few minutes. If you really mean to send it twice, confirm below.</span>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setStage("compose"); setDuplicate(false); }} disabled={busy}>Back</Button>
              <Button onClick={() => send(duplicate)} disabled={busy} variant={duplicate ? "danger" : "default"}>
                {busy ? "Transferring…" : duplicate ? "Send it again" : `Confirm · ${formatMoney(amt, from!.currency)}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TransfersPanel({ onChanged }: { onChanged?: () => void }) {
  const search = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "reversed">("all");
  const [reversing, setReversing] = useState<Transfer | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [a, t] = await Promise.all([api<{ accounts: Account[] }>("/api/accounts"), api<{ transfers: Transfer[] }>("/api/transfers")]);
      setAccounts(a.accounts.filter((x) => x.status !== "CLOSED"));
      setTransfers(t.transfers);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (search.get("new") === "1") setOpen(true);
  }, [search]);

  async function reverse(t: Transfer, reason?: string) {
    try {
      await api(`/api/transfers/${t.id}`, { body: { reason } });
      toast.success("Transfer reversed. Both statements show the original and the reversal.");
      load();
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const shown = useMemo(
    () => (transfers ?? []).filter((t) => (filter === "all" ? true : filter === "reversed" ? !!t.reversedAt : !t.reversedAt)),
    [transfers, filter]
  );

  return (
    <div className="space-y-8">

      {error && <ErrorState message={error} onRetry={load} />}

      <Section
        title="Transfers"
        description="Money moved between your own accounts. Not income, not spending."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs">
            {(["all", "active", "reversed"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn("h-7 cursor-pointer rounded-md px-2.5 capitalize transition-colors", filter === f ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {f === "active" ? "Completed" : f}
              </button>
            ))}
            </div>
            <Button size="sm" onClick={() => setOpen(true)} disabled={accounts.length < 2}><Plus /> New transfer</Button>
          </div>
        }
      >
        <Panel padded={false}>
          {transfers === null ? (
            <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-10" />)}</div>
          ) : shown.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<ArrowLeftRight className="h-5 w-5" />} title={transfers.length ? "Nothing in this view" : "No transfers yet"}>
                {accounts.length < 2 ? <>Add a second account to move money between them. <Link className="underline" href="/accounts?new=1">Add account</Link></> : "Paying a card bill or topping up a wallet? Record it as a transfer."}
              </EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((t) => (
                <li key={t.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5", t.reversedAt && "bg-muted/30")}>
                  <span className="w-20 font-mono text-xs text-muted-foreground">{formatDate(t.date)}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("flex flex-wrap items-center gap-1.5 text-sm", t.reversedAt && "text-muted-foreground")}>
                      {t.fromAccount.name} <span className="text-muted-foreground">→</span> {t.toAccount.name}
                    </p>
                    {(t.notes || t.reversalReason) && (
                      <p className="truncate text-xs text-muted-foreground">{t.notes}{t.reversalReason ? ` · Reversed: ${t.reversalReason}` : ""}</p>
                    )}
                  </div>
                  {t.reversedAt ? <StatusBadge tone="neutral">Reversed {formatDate(t.reversedAt, { day: "numeric", month: "short" })}</StatusBadge> : <StatusBadge tone="positive">Completed</StatusBadge>}
                  <div className={cn("w-32 text-right text-sm font-medium tabular-nums", t.reversedAt && "text-muted-foreground line-through")}>
                    {formatMoney(t.amount, t.currency)}
                    {t.toAmount && <p className="text-[11px] font-normal text-muted-foreground no-underline">→ {formatMoney(t.toAmount, t.toCurrency!)}</p>}
                  </div>
                  <div className="w-9">
                    {!t.reversedAt && t.fromAccount.status !== "CLOSED" && t.toAccount.status !== "CLOSED" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Transfer actions"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem variant="destructive" onClick={() => setReversing(t)}>Reverse…</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Section>

      <ConfirmAction
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        title="Reverse this transfer?"
        withReason="Why are you reversing it?"
        description={
          reversing && (
            <>
              <p>
                {formatMoney(reversing.toAmount ?? reversing.amount, reversing.toCurrency ?? reversing.currency)} goes back from{" "}
                <b className="text-foreground">{reversing.toAccount.name}</b> to <b className="text-foreground">{reversing.fromAccount.name}</b>.
              </p>
              <p>The original transfer stays on both statements with a matching reversal entry. This can&apos;t be undone. Make a new transfer if you need to.</p>
            </>
          )
        }
        confirmLabel="Reverse transfer"
        onConfirm={(reason) => reverse(reversing!, reason)}
      />

      <TransferDialog open={open} onOpenChange={setOpen} accounts={accounts} initialFrom={search.get("from")} onDone={() => { load(); onChanged?.(); }} />
    </div>
  );
}
