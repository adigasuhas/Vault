"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, localMonth, localToday } from "@/lib/client";
import { formatMoney } from "@/lib/currencies";
import { useCurrency } from "@/context/CurrencyContext";
import { formatDate } from "@/lib/format";
import { monthLabel } from "@/lib/dates";
import { Panel, Section, EmptyState, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { MonthSwitcher } from "@/components/app/MonthSwitcher";
import { StatusBadge, occurrenceStatus } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmAction } from "@/components/ConfirmAction";
import { ScheduleForm, frequencyLabel, KINDS, type ScheduleFormValue } from "@/components/schedules/ScheduleForm";
import { CalendarClock, Check, MoreHorizontal, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Occurrence } from "@/lib/schedules";
import { Equivalent } from "@/components/app/Money";
import { FxTicker } from "@/components/app/FxTicker";

interface Account { id: string; name: string; currency: string; status: string; currentBalance: string }
interface Category { id: string; name: string }
export interface Schedule {
  id: string;
  name: string;
  kind: string;
  direction: "INCOME" | "PAYMENT";
  amount: number;
  currency: string;
  frequency: string;
  customIntervalDays: number | null;
  startDate: string;
  endDate: string | null;
  nextExecutionDate: string;
  isActive: boolean;
  cancelledAt: string | null;
  requiresConfirmation: boolean;
  notes: string | null;
  categoryId: string | null;
  receivingAccount: { id: string; name: string; currency: string; status: string } | null;
  category: { id: string; name: string } | null;
  loan: { id: string; name: string } | null;
  upcoming: Occurrence[];
  history: { id: string; date: string; amount: number; status: string }[];
  /** Booked (confirmed) payments, all time. */
  paidCount: number;
}

const kindLabel = (k: string) => [...KINDS.INCOME, ...KINDS.PAYMENT].find((x) => x.v === k)?.l ?? k;

/** Confirm a due occurrence with what actually happened. */
function ConfirmDialog({ occ, accounts, onClose, onDone }: { occ: Occurrence | null; accounts: Account[]; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const fx = useCurrency();
  // The schedule's amount expressed in `to` at today's rate (null: no rate).
  const inCurrency = (o: Occurrence, to: string) => {
    if (o.currency === to) return o.amount;
    const from = o.currency === fx.primary ? 1 : fx.toPrimary[o.currency];
    const into = to === fx.primary ? 1 : fx.toPrimary[to];
    return from != null && into ? Math.round(((o.amount * from) / into) * 100) / 100 : null;
  };
  const pickAccount = (o: Occurrence, id: string) => {
    if (!id) {
      setAccountId("");
      setAmount(String(o.amount));
      return;
    }
    setAccountId(id);
    const cur = accounts.find((a) => a.id === id)?.currency ?? o.currency;
    const v = inCurrency(o, cur);
    setAmount(v == null ? "" : String(v));
  };
  useEffect(() => {
    if (occ) {
      setDate(occ.date > localToday() ? localToday() : occ.date);
      pickAccount(occ, occ.accountId ?? "");
      // No account on the schedule: suggest the one on that month's budget line.
      if (!occ.accountId && occ.categoryId) {
        api<{ lines: { categoryId: string; accountId: string | null }[] }>(`/api/budget?month=${occ.date.slice(0, 7)}`)
          .then((b) => {
            const id = b.lines.find((l) => l.categoryId === occ.categoryId)?.accountId;
            if (id && accounts.some((a) => a.id === id)) pickAccount(occ, id);
          })
          .catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occ]);
  if (!occ) return null;
  const income = occ.direction === "INCOME";
  // A loan's EMI stays in the loan's currency; anything else can be paid
  // from (or into) an account in another currency, converted.
  const choices = occ.kind === "EMI" ? accounts.filter((a) => a.currency === occ.currency) : accounts;
  const accountCur = accounts.find((a) => a.id === accountId)?.currency ?? occ.currency;
  const cross = accountCur !== occ.currency;
  const expected = inCurrency(occ, accountCur);
  async function submit() {
    setBusy(true);
    try {
      await api(`/api/occurrences/${occ!.executionId}/confirm`, { body: { amount: Number(amount), date, accountId } });
      toast.success(income ? `${occ!.scheduleName} received.` : `${occ!.scheduleName} marked paid.`);
      onClose();
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{income ? "Confirm money received" : "Confirm payment made"}</DialogTitle>
          <DialogDescription>{occ.scheduleName} · due {formatDate(occ.date)}. Adjust anything that differs from the schedule.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-amt">Amount ({accountCur})</Label>
              <Input id="c-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-date">{income ? "Arrived on" : "Paid on"}</Label>
              <Input id="c-date" type="date" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{income ? "Into" : "From"}</Label>
            <Select value={accountId} onValueChange={(v) => pickAccount(occ, v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>
                {choices.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · {formatMoney(a.currentBalance, a.currency)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {cross ? (
            <p className="text-xs text-muted-foreground">
              Scheduled as {formatMoney(occ.amount, occ.currency)}{expected != null ? <>, about {formatMoney(expected, accountCur)} at today&apos;s rate</> : null}. Enter the {accountCur} amount that actually {income ? "arrived" : "left the account"}.
              <FxTicker compact className="mt-1 flex" />
            </p>
          ) : (
            Number(amount) > 0 && Number(amount) !== occ.amount && (
              <p className="text-xs text-warning">Differs from the scheduled {formatMoney(occ.amount, occ.currency)}. The amount you enter here is what gets booked.</p>
            )
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !(Number(amount) > 0) || !date || !accountId}><Check /> {busy ? "Booking…" : income ? "Mark received" : "Mark paid"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pays everything left on a schedule in one go and ends it. */
function PayoffDialog({ schedule, accounts, onClose, onDone }: { schedule: Schedule | null; accounts: Account[]; onClose: () => void; onDone: () => void }) {
  const [left, setLeft] = useState<{ count: number; total: number; currency: string } | null>(null);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(localToday());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!schedule) return;
    setLeft(null);
    setAccountId(schedule.receivingAccount?.id ?? "");
    setDate(localToday());
    api<{ count: number; total: number; currency: string }>(`/api/schedules/${schedule.id}/payoff`).then(setLeft).catch((e) => toast.error((e as Error).message));
  }, [schedule]);
  if (!schedule) return null;
  const income = schedule.direction === "INCOME";
  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ payments: number; total: number; currency: string }>(`/api/schedules/${schedule!.id}/payoff`, { body: { accountId, date } });
      toast.success(`${schedule!.name} closed: ${r.payments} ${r.payments === 1 ? "payment" : "payments"} of ${formatMoney(r.total, r.currency)} booked.`);
      onClose();
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{income ? `Settle ${schedule.name}` : `Pay off ${schedule.name}`}</DialogTitle>
          <DialogDescription>
            Payments have already been made on this one, so it closes by settling what&apos;s left.{" "}
            {left ? (left.count ? <>{left.count} remaining {left.count === 1 ? "payment" : "payments"}: <b className="text-foreground">{formatMoney(left.total, left.currency)}</b>, booked on the date below.</> : "Nothing is left to pay.") : "Working out what's left…"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{income ? "Into" : "Paid from"}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · {formatMoney(a.currentBalance, a.currency)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-date">{income ? "Received on" : "Paid on"}</Label>
            <Input id="po-date" type="date" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !accountId || !left?.count}><Check /> {busy ? "Booking…" : income ? "Settle & close" : "Pay off & close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Move an upcoming occurrence or change its amount. */
function OverrideDialog({ occ, onClose, onDone }: { occ: Occurrence | null; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (occ) {
      setDate(occ.date);
      setAmount(String(occ.amount));
    }
  }, [occ]);
  if (!occ) return null;
  async function save(clear = false) {
    setBusy(true);
    try {
      await api(`/api/schedules/${occ!.scheduleId}/override`, {
        method: "PUT",
        body: clear ? { occurrenceDate: occ!.occurrenceDate, date: null, amount: null } : { occurrenceDate: occ!.occurrenceDate, date: date !== occ!.occurrenceDate ? date : null, amount: Number(amount) },
      });
      toast.success(clear ? "Back to the regular schedule." : "Updated.");
      onClose();
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change this date or amount</DialogTitle>
          <DialogDescription>{occ.scheduleName} · regularly on {formatDate(occ.occurrenceDate)}. Only this one changes.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="o-date">Date</Label>
            <Input id="o-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="o-amt">Amount ({occ.currency})</Label>
            <Input id="o-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          {occ.overridden ? <Button variant="ghost" onClick={() => save(true)} disabled={busy}>Reset to regular</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={() => save()} disabled={busy || !date || !(Number(amount) > 0)}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusLegend({ direction }: { direction: "INCOME" | "PAYMENT" }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
      {["SCHEDULED", "PENDING", "CONFIRMED", "SKIPPED", "FAILED", "REVERSED"].map((s) => {
        const st = occurrenceStatus(s, direction);
        return <StatusBadge key={s} tone={st.tone}>{st.label}</StatusBadge>;
      })}
    </div>
  );
}

export function SchedulesBoard({
  direction,
  openNew,
  extraTop,
  headerActions,
}: {
  direction: "INCOME" | "PAYMENT";
  openNew?: boolean;
  extraTop?: ReactNode;
  headerActions?: (open: () => void) => ReactNode;
}) {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pending, setPending] = useState<Occurrence[]>([]);
  const [month, setMonth] = useState(localMonth());
  const [monthOcc, setMonthOcc] = useState<Occurrence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleFormValue | null>(null);
  const [confirming, setConfirming] = useState<Occurrence | null>(null);
  const [overriding, setOverriding] = useState<Occurrence | null>(null);
  const [skipping, setSkipping] = useState<Occurrence | null>(null);
  const [reversing, setReversing] = useState<Occurrence | null>(null);
  const [ending, setEnding] = useState<Schedule | null>(null);
  const [payingOff, setPayingOff] = useState<Schedule | null>(null);
  // Something actually booked: deleting would orphan it from the ledger.
  // (Reversed ones don't count: the ledger keeps them either way.)
  const hasPaid = (s: Schedule) => s.paidCount > 0;
  const income = direction === "INCOME";

  const load = useCallback(async () => {
    setError(null);
    try {
      await api("/api/schedules/run-due", { body: {} }).catch(() => null);
      const [s, a, c, p] = await Promise.all([
        api<{ schedules: Schedule[] }>(`/api/schedules?direction=${direction}`),
        api<{ accounts: Account[] }>("/api/accounts"),
        api<{ categories: Category[] }>("/api/categories"),
        api<{ occurrences: Occurrence[] }>(`/api/occurrences?direction=${direction}&status=PENDING,FAILED`),
      ]);
      setSchedules(s.schedules);
      setAccounts(a.accounts.filter((x) => x.status !== "CLOSED"));
      setCategories(c.categories);
      setPending(p.occurrences);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [direction]);
  const loadMonth = useCallback(async () => {
    try {
      const d = await api<{ occurrences: Occurrence[] }>(`/api/occurrences?direction=${direction}&month=${month}`);
      setMonthOcc(d.occurrences);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [direction, month]);
  const refresh = useCallback(() => {
    load();
    loadMonth();
  }, [load, loadMonth]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setMonthOcc(null);
    loadMonth();
  }, [loadMonth]);
  useEffect(() => {
    if (openNew) setFormOpen(true);
  }, [openNew]);

  const active = useMemo(() => (schedules ?? []).filter((s) => s.isActive), [schedules]);
  const ended = useMemo(() => (schedules ?? []).filter((s) => !s.isActive), [schedules]);
  const monthTotal = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of monthOcc ?? []) if (o.status !== "SKIPPED" && o.status !== "REVERSED") m.set(o.currency, (m.get(o.currency) ?? 0) + o.amount);
    return [...m.entries()];
  }, [monthOcc]);

  async function act(path: string, body: unknown, ok: string) {
    try {
      await api(path, { body });
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function edit(s: Schedule) {
    setEditing({
      id: s.id,
      kind: s.kind,
      name: s.name,
      amount: s.amount,
      accountId: s.receivingAccount?.id ?? null,
      currency: s.currency,
      categoryId: s.categoryId,
      frequency: s.frequency as ScheduleFormValue["frequency"],
      customIntervalDays: s.customIntervalDays,
      startDate: s.nextExecutionDate.slice(0, 10),
      endDate: s.endDate ? s.endDate.slice(0, 10) : null,
      requiresConfirmation: s.requiresConfirmation,
      notes: s.notes,
    });
    setFormOpen(true);
  }

  async function toggleActive(s: Schedule) {
    try {
      await api(`/api/schedules/${s.id}`, { method: "PATCH", body: { isActive: !s.isActive } });
      toast.success(s.isActive ? `${s.name} paused. Nothing will come due until you resume it.` : `${s.name} resumed.`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function endSchedule(s: Schedule) {
    try {
      const r = await api<{ deleted: boolean }>(`/api/schedules/${s.id}`, { method: "DELETE" });
      toast.success(r.deleted ? `${s.name} deleted.` : `${s.name} ended. Its history is kept.`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const occRow = (o: Occurrence, showActions = true) => {
    const st = occurrenceStatus(o.status, o.direction);
    const future = o.date > localToday();
    return (
      <li key={`${o.scheduleId}-${o.occurrenceDate}`} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3", (o.status === "SKIPPED" || o.status === "REVERSED") && "opacity-70")}>
        <div className="w-12 shrink-0 text-center">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{formatDate(o.date, { month: "short" })}</p>
          <p className="font-display text-xl leading-none">{formatDate(o.date, { day: "numeric" })}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{o.scheduleName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {accounts.find((a) => a.id === o.accountId)?.name ?? "Account not set"}
            {o.overridden && <span className="text-brass"> · moved from {formatDate(o.occurrenceDate, { day: "numeric", month: "short" })}</span>}
            {o.failureReason && <span className="text-negative"> · {o.failureReason}</span>}
            {o.note && ` · ${o.note}`}
          </p>
        </div>
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
        <span className={cn("w-28 text-right text-sm font-medium tabular-nums", o.status === "REVERSED" && "line-through", income && o.status === "CONFIRMED" && "text-positive")}>
          {income ? "+" : "−"}{formatMoney(o.amount, o.currency)}
        </span>
        <div className="flex w-[148px] justify-end gap-1">
          {showActions && (o.status === "PENDING" || o.status === "FAILED") && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSkipping(o)}>Skip</Button>
              <Button size="sm" onClick={() => setConfirming(o)}>{o.status === "FAILED" ? "Retry" : income ? "Received" : "Paid"}</Button>
            </>
          )}
          {showActions && o.status === "SCHEDULED" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="More options"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setOverriding(o)}>Change date or amount…</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSkipping(o)}>{income ? "Didn't arrive? Skip…" : "Skip / cancel this one…"}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {showActions && o.status === "SKIPPED" && o.executionId && future && (
            <Button size="sm" variant="ghost" onClick={() => act(`/api/occurrences/${o.executionId}/restore`, {}, "Brought back.")}>Restore</Button>
          )}
          {showActions && o.status === "CONFIRMED" && o.executionId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="More options"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onClick={() => setReversing(o)}>Reverse…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      {headerActions?.(() => { setEditing(null); setFormOpen(true); })}
      {error && <ErrorState message={error} onRetry={refresh} />}
      {extraTop}

      {pending.length > 0 && (
        <Section title={income ? "Waiting for confirmation" : "Due"} description={income ? "These came due. Confirm what actually arrived, or skip if it didn't." : "These came due. Confirm once paid, or skip/cancel."}>
          <Panel padded={false} className="border-warning/40"><ul className="divide-y divide-border">{pending.map((o) => occRow(o))}</ul></Panel>
        </Section>
      )}

      <Section
        title={`${income ? "Income" : "Payments"} in ${monthLabel(month)}`}
        description={monthTotal.length ? `${monthTotal.map(([c, v]) => formatMoney(v, c)).join(" + ")} expected or booked this month` : undefined}
        actions={<MonthSwitcher month={month} onChange={setMonth} />}
      >
        <Panel padded={false}>
          {monthOcc === null ? (
            <div className="space-y-2 p-5">{[0, 1].map((i) => <SkeletonBlock key={i} className="h-10" />)}</div>
          ) : monthOcc.length === 0 ? (
            <div className="p-5"><EmptyState icon={<CalendarClock className="h-5 w-5" />} title={`Nothing ${income ? "due to arrive" : "due"} in ${monthLabel(month)}`}>Quarterly and yearly schedules only appear in the months they fall in.</EmptyState></div>
          ) : (
            <ul className="divide-y divide-border">{monthOcc.map((o) => occRow(o))}</ul>
          )}
          <div className="border-t border-border px-5 py-3"><StatusLegend direction={direction} /></div>
        </Panel>
      </Section>

      <Section title={income ? "Schedules" : "Scheduled payments"} description={`${active.length} active${ended.length ? ` · ${ended.length} ended or paused` : ""}`}>
        {schedules === null ? (
          <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <SkeletonBlock key={i} className="h-32" />)}</div>
        ) : schedules.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="h-5 w-5" />}
            title={income ? "No income scheduled" : "No scheduled payments"}
            action={<Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> {income ? "Schedule income" : "Schedule a payment"}</Button>}
          >
            {income ? "Add your salary, stipend or any regular money coming in. You'll confirm each one as it lands." : "Rent, subscriptions, insurance, fees. Each one lands in the right month of your budget by itself."}
          </EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {[...active, ...ended].map((s) => (
              <div key={s.id} className={cn("rounded-xl border border-border bg-card p-5 shadow-card", !s.isActive && "opacity-70")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {kindLabel(s.kind)} · {frequencyLabel(s.frequency, s.customIntervalDays)}
                      {s.category && ` · ${s.category.name}`}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" className="-mr-2 -mt-1" aria-label={`Actions for ${s.name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {!s.cancelledAt || s.isActive ? <DropdownMenuItem onClick={() => edit(s)}>Edit…</DropdownMenuItem> : null}
                      <DropdownMenuItem onClick={() => toggleActive(s)}>{s.isActive ? "Pause" : "Resume"}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {s.loan ? (
                        <DropdownMenuItem asChild><Link href={`/loans/${s.loan.id}`}>Pay off or delete on the loan…</Link></DropdownMenuItem>
                      ) : !hasPaid(s) ? (
                        <DropdownMenuItem variant="destructive" onClick={() => setEnding(s)}>Delete…</DropdownMenuItem>
                      ) : s.endDate && s.isActive ? (
                        <DropdownMenuItem onClick={() => setPayingOff(s)}>{income ? "Settle & close…" : "Pay off & close…"}</DropdownMenuItem>
                      ) : s.isActive ? (
                        <DropdownMenuItem variant="destructive" onClick={() => setEnding(s)}>End schedule…</DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xl font-semibold tabular-nums tracking-tight">{formatMoney(s.amount, s.currency)}</p>
                    <Equivalent value={s.amount} currency={s.currency} className="text-xs" />
                    <p className="mt-0.5 text-xs text-muted-foreground">{income ? "into" : "from"} {s.receivingAccount?.name ?? "the budget line's account"}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 text-right">
                    {s.isActive ? (
                      s.upcoming[0] ? <span className="text-xs text-muted-foreground">Next <span className="text-foreground">{formatDate(s.upcoming[0].date, { day: "numeric", month: "short" })}</span></span> : <span className="text-xs text-muted-foreground">Nothing left to come</span>
                    ) : (
                      <StatusBadge tone="neutral">{s.cancelledAt ? "Ended" : "Paused"}</StatusBadge>
                    )}
                    <StatusBadge tone={s.requiresConfirmation ? "outline" : "brass"} dot={false}>{s.requiresConfirmation ? "Confirm each" : "Automatic"}</StatusBadge>
                  </div>
                </div>
                {s.isActive && s.upcoming.length > 1 && (
                  <div className="mt-4 flex gap-1.5 overflow-x-auto border-t border-border pt-3">
                    {s.upcoming.slice(0, 6).map((o) => (
                      <button
                        key={o.occurrenceDate}
                        onClick={() => setOverriding(o)}
                        title="Change this one"
                        className={cn("shrink-0 cursor-pointer rounded-md border px-2 py-1 text-[11px] tabular-nums transition-colors hover:border-foreground/40", o.status === "SKIPPED" ? "border-dashed text-muted-foreground line-through" : o.overridden ? "border-brass/50 text-brass" : "border-border text-muted-foreground")}
                      >
                        {formatDate(o.date, { day: "numeric", month: "short" })}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Dialog open={formOpen} onOpenChange={(o) => { setFormOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : income ? "Schedule income" : "Schedule a payment"}</DialogTitle>
            <DialogDescription>
              {income ? "Salary, stipend, refunds or pocket money. Once, or on repeat." : "Rent, EMIs, subscriptions and other regular payments. Each one lands in its month's budget."}
            </DialogDescription>
          </DialogHeader>
          {accounts.length === 0 ? (
            <EmptyState title="Add an account first">Schedules credit or debit one of your accounts.</EmptyState>
          ) : (
            <ScheduleForm
              key={editing?.id ?? "new"}
              direction={direction}
              accounts={accounts}
              categories={categories}
              initial={editing}
              onSaved={() => { setFormOpen(false); setEditing(null); refresh(); }}
              onCancel={() => { setFormOpen(false); setEditing(null); }}
              onCategoryCreated={(c) => setCategories((cs) => [...cs, c])}
            />
          )}
        </DialogContent>
      </Dialog>

      {payingOff && <PayoffDialog schedule={payingOff} accounts={accounts} onClose={() => setPayingOff(null)} onDone={refresh} />}
      {confirming && <ConfirmDialog occ={confirming} accounts={accounts} onClose={() => setConfirming(null)} onDone={refresh} />}
      {overriding && <OverrideDialog occ={overriding} onClose={() => setOverriding(null)} onDone={refresh} />}

      <ConfirmAction
        open={!!skipping}
        onOpenChange={(o) => !o && setSkipping(null)}
        destructive={false}
        title={skipping?.status === "SCHEDULED" ? "Skip this one?" : "Skip this one?"}
        withReason="Note"
        description={skipping && <p>{skipping.scheduleName} on {formatDate(skipping.date)} · {formatMoney(skipping.amount, skipping.currency)}. No money moves; it&apos;s kept on record as skipped{skipping.status === "SCHEDULED" ? " and can be restored until its date" : ""}.</p>}
        confirmLabel="Skip it"
        onConfirm={(note) =>
          skipping!.executionId
            ? act(`/api/occurrences/${skipping!.executionId}/skip`, { note }, "Skipped.")
            : act(`/api/schedules/${skipping!.scheduleId}/skip`, { occurrenceDate: skipping!.occurrenceDate, note }, "Skipped ahead of time.")
        }
      />
      <ConfirmAction
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        title={income ? "Reverse this credit?" : "Reverse this payment?"}
        withReason="Why?"
        description={
          reversing && (
            <>
              <p>{formatMoney(reversing.amount, reversing.currency)} {income ? "comes back out of" : "goes back into"} {accounts.find((a) => a.id === reversing.accountId)?.name ?? "the account"}.</p>
              <p>The original booking stays in the ledger next to its reversal. This can&apos;t be undone.</p>
            </>
          )
        }
        confirmLabel="Reverse"
        onConfirm={(reason) => act(`/api/occurrences/${reversing!.executionId}/reverse`, { reason }, "Reversed. The ledger keeps both entries.")}
      />
      <ConfirmAction
        open={!!ending}
        onOpenChange={(o) => !o && setEnding(null)}
        title={ending && hasPaid(ending) ? `End ${ending.name}?` : `Delete ${ending?.name}?`}
        description={
          ending && (hasPaid(ending)
            ? <p>It has no end date, so nothing more is owed: nothing new will come due. Everything already {income ? "received" : "paid"} stays on record. {direction === "PAYMENT" && "Coming months' budgets drop the scheduled amount."}</p>
            : <p>Nothing has been {income ? "received" : "paid"} on it yet, so it&apos;s removed entirely, including anything waiting to be confirmed. {direction === "PAYMENT" && "Coming months' budgets drop it too."}</p>)
        }
        confirmLabel={ending && hasPaid(ending) ? "End schedule" : "Delete"}
        onConfirm={() => endSchedule(ending!)}
      />
    </>
  );
}
