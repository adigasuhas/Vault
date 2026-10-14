"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, History, Undo2 } from "lucide-react";
import { formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { localToday, newKey } from "@/lib/client";
import { roundMoney } from "@/lib/validate";
import { Equivalent } from "@/components/app/Money";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Investment cash on the Investments page: money from sales kept for
 * reinvesting, plus anything added from an account. One balance per
 * currency (see lib/investment-cash). Adding and withdrawing are deliberate
 * moves the user confirms; nothing here moves money on its own.
 */

export interface CashBalance { currency: string; balance: number }
export interface CashRow {
  id: string;
  type: "SALE_PROCEEDS" | "PURCHASE" | "FROM_ACCOUNT" | "TO_ACCOUNT" | "REVERSAL";
  currency: string;
  amount: number;
  date: string;
  description: string | null;
  sale: { id: string; name: string } | null;
  account: { id: string; name: string; currency: string; amount: number } | null;
  reversedAt: string | null;
  reversalOfId: string | null;
}
interface Account { id: string; name: string; currency: string; status: string; currentBalance: string; accountType: string }

type MoveRequest = { direction: "IN" | "OUT"; currency?: string; amount?: number };

interface CashCtx {
  balances: CashBalance[];
  loaded: boolean;
  /** Balance in a currency (0 when there is none). */
  balanceOf: (currency: string) => number;
  reload: () => Promise<void>;
  openMove: (r: MoveRequest) => void;
  openHistory: () => void;
}

const Ctx = createContext<CashCtx | null>(null);
export const useInvestmentCash = () => useContext(Ctx);

export function InvestmentCashProvider({ children, onChanged }: { children: ReactNode; onChanged?: () => void }) {
  const [balances, setBalances] = useState<CashBalance[]>([]);
  const [history, setHistory] = useState<CashRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [move, setMove] = useState<MoveRequest | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/investments/cash");
      if (!r.ok) return;
      const d = await r.json();
      setBalances(d.balances ?? []);
      setHistory(d.history ?? []);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    // Loaded after mount, like the rest of the page's data.
    Promise.resolve().then(reload);
  }, [reload]);

  const value = useMemo<CashCtx>(
    () => ({
      balances,
      loaded,
      balanceOf: (c) => balances.find((b) => b.currency === c)?.balance ?? 0,
      reload,
      openMove: setMove,
      openHistory: () => setHistoryOpen(true),
    }),
    [balances, loaded, reload]
  );
  const changed = async () => {
    await reload();
    onChanged?.();
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <MoveDialog request={move} balances={balances} onClose={() => setMove(null)} onDone={changed} />
      <HistorySheet open={historyOpen} onOpenChange={setHistoryOpen} rows={history} onChanged={changed} />
    </Ctx.Provider>
  );
}

// ------------------------------------------------------------------- strip

/** The balance, under the portfolio summary, with its three actions. */
export function InvestmentCashStrip() {
  const cash = useInvestmentCash()!;
  const shown = cash.balances.filter((b) => Math.abs(b.balance) > 0.004);
  const hasHistory = cash.balances.length > 0;
  if (!cash.loaded) return null;
  return (
    <section aria-label="Investment cash" className="settle flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border bg-card px-4 py-3 shadow-card sm:px-5">
      <div className="flex min-w-0 items-baseline gap-x-3 gap-y-1 border-l-2 border-brass pl-3">
        <p className="eyebrow shrink-0">Investment cash</p>
        {shown.length ? (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            {shown.map((b) => (
              <span key={b.currency} className="text-lg font-semibold tracking-[-0.02em] tabular-nums">
                {formatMoney(b.balance, b.currency)}
                <Equivalent both value={b.balance} currency={b.currency} className="ml-1.5 text-xs font-normal" />
              </span>
            ))}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing waiting. Sale proceeds you keep for reinvesting land here.</p>
        )}
      </div>
      {shown.length > 0 && <p className="hidden text-xs text-muted-foreground md:block">Ready to reinvest</p>}
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={() => cash.openMove({ direction: "IN" })}>
          <ArrowDownToLine className="h-4 w-4" />Add money
        </Button>
        {shown.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => cash.openMove({ direction: "OUT" })}>
            <ArrowUpFromLine className="h-4 w-4" />Withdraw
          </Button>
        )}
        {hasHistory && (
          <Button size="sm" variant="ghost" onClick={cash.openHistory}>
            <History className="h-4 w-4" />History
          </Button>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------- move dialog

function MoveDialog({ request, balances, onClose, onDone }: { request: MoveRequest | null; balances: CashBalance[]; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {request && <MoveForm key={`${request.direction}:${request.currency ?? ""}`} request={request} balances={balances} onClose={onClose} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

function MoveForm({ request, balances, onClose, onDone }: { request: MoveRequest; balances: CashBalance[]; onClose: () => void; onDone: () => void }) {
  const adding = request.direction === "IN";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [picked, setPicked] = useState("");
  const held = balances.filter((b) => b.balance > 0.004);
  const [currency, setCurrency] = useState(request.currency ?? (adding ? "" : held[0]?.currency ?? ""));
  // An account in the same currency first, else the first open one.
  const want = request.currency ?? currency;
  const accountId = picked || ((want ? accounts.find((a) => a.currency === want) : undefined) ?? accounts[0])?.id || "";
  const [amount, setAmount] = useState(request.amount ? String(request.amount) : "");
  const [arrived, setArrived] = useState("");
  const [date, setDate] = useState(localToday());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [key] = useState(() => newKey());

  useEffect(() => {
    let live = true;
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d) => {
        if (live) setAccounts((d.accounts ?? []).filter((a: Account) => a.status !== "CLOSED"));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const account = accounts.find((a) => a.id === accountId);
  const cashCurrency = currency || account?.currency || "";
  const cross = !!(account && cashCurrency && account.currency !== cashCurrency);
  const before = balances.find((b) => b.currency === cashCurrency)?.balance ?? 0;
  const amt = Number(amount) || 0;
  // What changes in investment cash: the amount that arrives when adding
  // across currencies, otherwise the amount itself.
  const cashDelta = adding ? (cross ? Number(arrived) || 0 : amt) : amt;
  const after = roundMoney(before + (adding ? cashDelta : -cashDelta));
  const accountBalance = account ? Number(account.currentBalance) : 0;
  const debit = account && !["CREDIT_CARD", "LOAN"].includes(account.accountType);
  const overDraw = adding && debit && amt > accountBalance + 0.004;
  const overWithdraw = !adding && amt > before + 0.004;
  const invalid = !(amt > 0) || !accountId || !cashCurrency || (cross && !(Number(arrived) > 0)) || overDraw || overWithdraw;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || invalid) return;
    setSaving(true);
    const res = await fetch("/api/investments/cash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction: request.direction,
        accountId,
        currency: cashCurrency,
        amount: amt,
        ...(cross ? { arrivedAmount: Number(arrived) } : {}),
        date,
        note: note || undefined,
        idempotencyKey: key,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error || (adding ? "Couldn't add the money." : "Couldn't withdraw."));
      return;
    }
    toast.success(
      data.duplicate
        ? "Already done: this was saved once."
        : adding
          ? `Added ${formatMoney(cashDelta, cashCurrency)} to investment cash from ${account?.name}.`
          : `Withdrew ${formatMoney(amt, cashCurrency)} to ${account?.name}.`
    );
    onClose();
    onDone();
  }

  const accountPicker = (
    <div className="space-y-1.5">
      <Label>{adding ? "From" : "To"}</Label>
      <Select value={accountId} onValueChange={setPicked}>
        <SelectTrigger className="w-full" aria-label={adding ? "From account" : "To account"}><SelectValue placeholder={accounts.length ? "Choose account" : "Add an account first"} /></SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name} <span className="text-muted-foreground">· {formatMoney(a.currentBalance, a.currency)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{adding ? "Add money to investment cash" : "Withdraw investment cash"}</DialogTitle>
        <DialogDescription>
          {adding
            ? "Moves money out of an account so it's ready to invest. It isn't spending: your net worth stays the same."
            : "Moves money you aren't reinvesting back into an account. Withdraw all of it or just part."}
        </DialogDescription>
      </DialogHeader>

      {!adding && held.length > 1 && (
        <div className="space-y-1.5">
          <Label>Which balance</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="w-full" aria-label="Investment cash currency"><SelectValue /></SelectTrigger>
            <SelectContent>{held.map((b) => <SelectItem key={b.currency} value={b.currency}>{formatMoney(b.balance, b.currency)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      {accountPicker}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="cash-amount">Amount{cashCurrency ? ` (${adding ? account?.currency ?? cashCurrency : cashCurrency})` : ""}</Label>
            {!adding && before > 0 && (
              <button type="button" className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setAmount(String(before))}>All</button>
            )}
          </div>
          <Input id="cash-amount" type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required aria-invalid={overDraw || overWithdraw} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cash-date">Date</Label>
          <Input id="cash-date" type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} required />
        </div>
      </div>
      {cross && account && (
        <div className="space-y-1.5">
          <Label htmlFor="cash-arrived">Amount that arrives in {adding ? cashCurrency : account.currency}</Label>
          <Input id="cash-arrived" type="number" inputMode="decimal" step="0.01" min="0" value={arrived} onChange={(e) => setArrived(e.target.value)} required />
        </div>
      )}
      <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note (optional)" aria-label="Note" />

      {overDraw && account && <p className="text-xs text-negative">{account.name} has {formatMoney(accountBalance, account.currency)}.</p>}
      {overWithdraw && <p className="text-xs text-negative">You can withdraw up to {formatMoney(before, cashCurrency)}.</p>}
      {cashCurrency && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
          <dt className="text-muted-foreground">Investment cash now</dt>
          <dd className="text-right tabular-nums">{formatMoney(before, cashCurrency)}</dd>
          <dt className="font-medium">After this</dt>
          <dd className={cn("text-right font-semibold tabular-nums", after < -0.004 && "text-negative")}>{formatMoney(after, cashCurrency)}</dd>
        </dl>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving || invalid}>{saving ? "Saving…" : adding ? "Add money" : "Withdraw"}</Button>
      </DialogFooter>
    </form>
  );
}

// ----------------------------------------------------------------- history

const TYPE_LABEL: Record<Exclude<CashRow["type"], "REVERSAL">, string> = {
  SALE_PROCEEDS: "Sale proceeds",
  PURCHASE: "Paid for a purchase",
  FROM_ACCOUNT: "Added from an account",
  TO_ACCOUNT: "Withdrawn to an account",
};
/** What undoing each kind of entry looks like in the history. */
const UNDO_LABEL: Record<Exclude<CashRow["type"], "REVERSAL">, string> = {
  SALE_PROCEEDS: "Sale undone",
  PURCHASE: "Returned from a purchase",
  FROM_ACCOUNT: "Sent back to the account",
  TO_ACCOUNT: "Withdrawal undone",
};

function HistorySheet({ open, onOpenChange, rows, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; rows: CashRow[]; onChanged: () => void }) {
  const [undoing, setUndoing] = useState<CashRow | null>(null);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  async function undo(r: CashRow) {
    const res = await fetch(`/api/investments/cash/${r.id}/undo`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "Couldn't undo that.");
      return;
    }
    toast.success(r.type === "FROM_ACCOUNT" ? `Undone. The money went back to ${r.account?.name ?? "the account"}.` : `Undone. The money is back in investment cash.`);
    onChanged();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Investment cash history</SheetTitle>
          <SheetDescription>Every movement, newest first. Undoing adds an entry; nothing is deleted.</SheetDescription>
        </SheetHeader>
        <ol className="flex-1 divide-y divide-border/60 overflow-y-auto">
          {rows.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No movements yet.</li>}
          {rows.map((r) => {
            const original = r.type === "REVERSAL" && r.reversalOfId ? byId.get(r.reversalOfId) : null;
            const label = r.type === "REVERSAL" ? (original && original.type !== "REVERSAL" ? UNDO_LABEL[original.type] : "Undone") : TYPE_LABEL[r.type];
            const other = r.sale?.name ?? r.account?.name ?? original?.sale?.name ?? original?.account?.name ?? null;
            const canUndo = (r.type === "FROM_ACCOUNT" || r.type === "TO_ACCOUNT") && !r.reversedAt;
            return (
              <li key={r.id} className={cn("flex items-start gap-3 px-4 py-3", r.reversedAt && "opacity-60")}>
                <span className="w-20 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">{formatDate(r.date)}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {label}
                    {r.reversedAt && <StatusBadge tone="neutral">Undone</StatusBadge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{r.description ?? other ?? ""}</p>
                  {r.account && r.account.currency !== r.currency && (
                    <p className="text-xs text-muted-foreground">{formatMoney(r.account.amount, r.account.currency)} in {r.account.name}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn("text-sm tabular-nums", r.amount > 0 ? "text-positive" : "text-foreground")}>
                    {r.amount > 0 ? "+" : "−"}{formatMoney(Math.abs(r.amount), r.currency)}
                  </span>
                  {canUndo && (
                    <button type="button" onClick={() => setUndoing(r)} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                      <Undo2 className="h-3 w-3" />Undo
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </SheetContent>
      <ConfirmAction
        open={!!undoing}
        onOpenChange={(o) => !o && setUndoing(null)}
        title={undoing?.type === "FROM_ACCOUNT" ? "Undo adding this money?" : "Undo this withdrawal?"}
        description={
          <p>
            {undoing?.type === "FROM_ACCOUNT"
              ? `${formatMoney(Math.abs(undoing.amount), undoing.currency)} leaves investment cash and goes back to ${undoing.account?.name ?? "the account"}.`
              : undoing
                ? `${formatMoney(Math.abs(undoing.amount), undoing.currency)} comes back into investment cash from ${undoing.account?.name ?? "the account"}.`
                : null}{" "}
            Both entries stay in the history.
          </p>
        }
        destructive={false}
        confirmLabel="Undo"
        onConfirm={() => undo(undoing!)}
      />
    </Sheet>
  );
}
