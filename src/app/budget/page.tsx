"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api, localMonth } from "@/lib/client";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { monthLabel, shiftMonth } from "@/lib/dates";
import { PageHeader, Panel, Section, EmptyState, SkeletonBlock, ErrorState, Stat } from "@/components/app/PageHeader";
import { MonthSwitcher } from "@/components/app/MonthSwitcher";
import { StatusBadge, occurrenceStatus } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmAction } from "@/components/ConfirmAction";
import { ScheduleForm, type ScheduleFormValue } from "@/components/schedules/ScheduleForm";
import { MoreHorizontal, PiggyBank, Plus, Repeat, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/context/CurrencyContext";
import type { Occurrence } from "@/lib/schedules";

interface Line {
  id: string | null;
  categoryId: string;
  categoryName: string;
  isRecurring: boolean;
  source: string;
  accountId: string | null;
  accountName: string | null;
  budgetAmount: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  scheduled: Occurrence[];
  scheduledTotal: number;
}
interface Budget {
  month: string;
  currency: string;
  hasPlan: boolean;
  isPast: boolean;
  totalIncome: number;
  expectedIncome: number;
  totalBudgeted: number;
  totalSpent: number;
  oneTimeExcluded: number;
  lines: Line[];
  unbudgeted: Line[];
}
interface Account { id: string; name: string; currency: string; status: string; currentBalance: string }
interface Category { id: string; name: string; isDefault: boolean }

const NEW = "__new__";

function LineDialog({
  open,
  onOpenChange,
  month,
  line,
  categories,
  accounts,
  prefillCategory,
  takenIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  month: string;
  line: Line | null;
  categories: Category[];
  accounts: Account[];
  prefillCategory?: string | null;
  takenIds: Set<string>;
  onDone: () => void;
}) {
  const editing = !!line?.id;
  const [categoryId, setCategoryId] = useState("");
  const [newName, setNewName] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [scope, setScope] = useState<"MONTH" | "FORWARD">("MONTH");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCategoryId(line?.categoryId ?? prefillCategory ?? "");
    setNewName("");
    setAmount(line ? String(line.budgetAmount) : "");
    setAccountId(line?.accountId ?? "");
    setRecurring(false);
    setScope(line?.isRecurring ? "FORWARD" : "MONTH");
  }, [open, line, prefillCategory]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        await api(`/api/budget/allocations/${line!.id}`, { method: "PATCH", body: { budgetAmount: Number(amount), accountId: accountId || null, scope } });
        toast.success(scope === "FORWARD" ? `Updated from ${monthLabel(month, "short")} onward.` : `Updated for ${monthLabel(month)}.`);
      } else {
        await api("/api/budget/allocations", {
          body: {
            month,
            ...(categoryId === NEW ? { newCategoryName: newName } : { categoryId }),
            budgetAmount: Number(amount || 0),
            accountId: accountId || null,
            recurring,
          },
        });
        toast.success(recurring ? `Budgeted every month from ${monthLabel(month, "short")}.` : `Budgeted for ${monthLabel(month)}.`);
      }
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const available = categories.filter((c) => !takenIds.has(c.id) || c.id === line?.categoryId);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${line!.categoryName}` : "Add to budget"}</DialogTitle>
            <DialogDescription>{monthLabel(month)}{editing && line!.source === "SCHEDULE" ? " · sized from scheduled payments until you change it" : ""}</DialogDescription>
          </DialogHeader>
          {!editing && (
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose category" /></SelectTrigger>
                <SelectContent>
                  {available.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  <SelectSeparator />
                  <SelectItem value={NEW}>+ New category…</SelectItem>
                </SelectContent>
              </Select>
              {categoryId === NEW && <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Category name" />}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="b-amt">Amount</Label>
              <Input id="b-amt" type="number" min="0" step="1" required value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label>Paid from</Label>
              <Select value={accountId || "__any__"} onValueChange={(v) => setAccountId(v === "__any__" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any account</SelectItem>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!editing ? (
            <label className="flex cursor-pointer gap-2.5 rounded-lg border border-border p-3">
              <input type="checkbox" className="mt-0.5 accent-[var(--brass)]" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
              <span>
                <span className="block text-sm">Repeat every month</span>
                <span className="block text-xs text-muted-foreground">From {monthLabel(month)} onward. Earlier months are not changed.</span>
              </span>
            </label>
          ) : (
            <fieldset className="grid grid-cols-2 gap-2">
              {(["MONTH", "FORWARD"] as const).map((s) => (
                <label key={s} className={cn("flex cursor-pointer gap-2 rounded-lg border p-3 text-sm", scope === s ? "border-foreground/40 bg-card shadow-card" : "border-border")}>
                  <input type="radio" className="mt-0.5 accent-[var(--brass)]" checked={scope === s} onChange={() => setScope(s)} />
                  <span>
                    {s === "MONTH" ? `Only ${monthLabel(month, "short")}` : `${monthLabel(month, "short")} and later`}
                    <span className="block text-xs text-muted-foreground">{s === "MONTH" ? "Other months keep their amount" : line!.isRecurring ? "Also changes the recurring amount" : "Every later month that has this line"}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || (!editing && (!categoryId || (categoryId === NEW && !newName.trim())))}>{busy ? "Saving…" : editing ? "Save" : "Add"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Click the planned amount to edit it in place; Enter saves (this month
 * only), Escape cancels. "Change amount or account…" offers the other scopes. */
function InlineAmount({ value, currency, onSave }: { value: number; currency: string; onSave: (v: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(value)); setEditing(true); }}
        title="Click to change this month's amount"
        className="cursor-text rounded-md px-1.5 py-0.5 text-sm font-medium tabular-nums transition-colors hover:bg-muted"
      >
        {formatMoney(Math.round(value), currency)}
      </button>
    );
  }
  const commit = async () => {
    const v = Number(draft);
    if (!Number.isFinite(v) || v < 0 || v === value) return setEditing(false);
    setBusy(true);
    await onSave(v);
    setBusy(false);
    setEditing(false);
  };
  return (
    <Input
      autoFocus
      type="number"
      min="0"
      step="1"
      disabled={busy}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="ml-auto h-8 w-28 text-right tabular-nums"
      aria-label="Planned amount"
    />
  );
}

export default function BudgetPage() {
  const fx = useCurrency();
  const [month, setMonth] = useState(localMonth());
  const [data, setData] = useState<Budget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lineOpen, setLineOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<Line | null>(null);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [incomeDraft, setIncomeDraft] = useState("");
  const [scheduleEdit, setScheduleEdit] = useState<ScheduleFormValue | null>(null);
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, a, c] = await Promise.all([
        api<Budget>(`/api/budget?month=${month}`),
        api<{ accounts: Account[] }>("/api/accounts"),
        api<{ categories: Category[] }>("/api/categories"),
      ]);
      setData(b);
      setIncomeDraft(b.totalIncome ? String(b.totalIncome) : "");
      setAccounts(a.accounts.filter((x) => x.status !== "CLOSED"));
      setCategories(c.categories);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const taken = useMemo(() => new Set((data?.lines ?? []).map((l) => l.categoryId)), [data]);
  const c = data?.currency ?? "INR";

  async function saveIncome(value?: number) {
    try {
      await api("/api/budget", { body: { month, totalIncome: value ?? Number(incomeDraft || 0) } });
      toast.success(`Planned income for ${monthLabel(month, "short")} saved.`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function saveAmount(l: Line, value: number) {
    try {
      await api(`/api/budget/allocations/${l.id}`, { method: "PATCH", body: { budgetAmount: value, scope: "MONTH" } });
      toast.success(`${l.categoryName} set to ${formatMoney(value, c)} for ${monthLabel(month, "short")}.`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function switchCurrency(currency: string) {
    try {
      await api("/api/budget", { method: "PATCH", body: { currency } });
      toast.success(`Every month is now planned in ${currency}. Amounts were converted at today's rate.`);
      load();
      fx.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function removeLine(l: Line, scope: "MONTH" | "FORWARD") {
    try {
      await api(`/api/budget/allocations/${l.id}`, { method: "DELETE", body: { scope } });
      toast.success(scope === "FORWARD" ? `${l.categoryName} removed from ${monthLabel(month, "short")} onward.` : `${l.categoryName} removed from ${monthLabel(month, "short")}.`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function openSchedule(scheduleId: string) {
    try {
      const d = await api<{ schedule: { id: string; kind: string; name: string; amount: number; currency: string; receivingAccountId: string; categoryId: string | null; frequency: ScheduleFormValue["frequency"]; customIntervalDays: number | null; nextExecutionDate: string; endDate: string | null; requiresConfirmation: boolean; notes: string | null } }>(`/api/schedules/${scheduleId}`);
      const s = d.schedule;
      setScheduleEdit({ id: s.id, kind: s.kind, name: s.name, amount: s.amount, currency: s.currency, accountId: s.receivingAccountId, categoryId: s.categoryId, frequency: s.frequency, customIntervalDays: s.customIntervalDays, startDate: s.nextExecutionDate.slice(0, 10), endDate: s.endDate?.slice(0, 10) ?? null, requiresConfirmation: s.requiresConfirmation, notes: s.notes });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const left = data ? data.totalIncome - data.totalBudgeted : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Budget"
        description="Decide what each category can spend this month and which account pays. Scheduled bills like rent are already counted in."
        actions={
          <>
            {data?.hasPlan && (
              <Select value={data.currency} onValueChange={(v) => v !== data.currency && setPendingCurrency(v)}>
                <SelectTrigger className="w-auto gap-2" aria-label="Budget currency"><span className="text-xs text-muted-foreground">Planned in</span><SelectValue /></SelectTrigger>
                <SelectContent>{SUPPORTED_CURRENCIES.map((cur) => <SelectItem key={cur.code} value={cur.code}>{cur.code}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <MonthSwitcher month={month} onChange={setMonth} />
          </>
        }
      />
      {error && <ErrorState message={error} onRetry={load} />}
      {!data ? (
        <div className="space-y-4"><SkeletonBlock className="h-28" /><SkeletonBlock className="h-64" /></div>
      ) : (
        <>
          {data.isPast && !data.hasPlan ? (
            <EmptyState
              icon={<PiggyBank className="h-5 w-5" />}
              title={`No budget was set for ${monthLabel(month)}`}
              action={<Button variant="outline" onClick={() => { setEditingLine(null); setPrefill(null); setLineOpen(true); }}>Create one for {monthLabel(month, "short")}</Button>}
            >
              Recurring budgets only start from the month they were set, so past months aren&apos;t filled in. Spending from that month is listed below.
            </EmptyState>
          ) : (
            <Panel className="settle overflow-hidden p-0">
              <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
                <div className="col-span-2 bg-card p-5 sm:col-span-1">
                  <p className="eyebrow">Planned income</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Input type="number" min="0" value={incomeDraft} onChange={(e) => setIncomeDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveIncome()} placeholder="0" className="h-9 text-lg font-semibold tabular-nums" />
                    {Number(incomeDraft || 0) !== data.totalIncome && <Button size="sm" onClick={() => saveIncome()}>Save</Button>}
                  </div>
                  {data.expectedIncome > 0 && Math.round(data.expectedIncome) !== Math.round(data.totalIncome) && (
                    <button className="mt-1.5 cursor-pointer text-left text-xs text-brass hover:underline" onClick={() => saveIncome(Math.round(data.expectedIncome))}>
                      Use {formatMoney(Math.round(data.expectedIncome), c)} from schedules
                    </button>
                  )}
                </div>
                <div className="bg-card p-5"><Stat label="Budgeted" value={formatMoney(Math.round(data.totalBudgeted), c)} /></div>
                <div className="bg-card p-5"><Stat label="Spent" value={formatMoney(Math.round(data.totalSpent), c)} hint={[data.totalBudgeted > 0 ? `${Math.round((data.totalSpent / data.totalBudgeted) * 100)}% of budget` : null, data.oneTimeExcluded > 0 ? `${formatMoney(Math.round(data.oneTimeExcluded), c)} of one-time purchases not counted` : null].filter(Boolean).join(" · ") || undefined} /></div>
                <div className="col-span-2 bg-card p-5 sm:col-span-1">
                  {data.totalIncome === 0 ? (
                    <Stat label="Left to budget" value={<span className="text-muted-foreground">–</span>} hint="Enter planned income to see what's unassigned" />
                  ) : (
                    <Stat
                      label={left >= 0 ? "Left to budget" : "Over-planned"}
                      value={<span className={left < 0 ? "text-negative" : ""}>{formatMoney(Math.round(Math.abs(left)), c)}</span>}
                      hint={left > 0 ? "Income not yet given a job" : left < 0 ? "Budgets exceed planned income" : "Every bit of income has a job"}
                    />
                  )}
                </div>
              </div>
            </Panel>
          )}

          {(data.hasPlan || !data.isPast) && (
            <Section
              title="Budget lines"
              description={data.lines.length ? `${data.lines.length} categories` : undefined}
              actions={<Button size="sm" onClick={() => { setEditingLine(null); setPrefill(null); setLineOpen(true); }}><Plus /> Add line</Button>}
            >
              {data.lines.length === 0 ? (
                <EmptyState icon={<PiggyBank className="h-5 w-5" />} title={`Nothing budgeted for ${monthLabel(month)} yet`} action={<Button size="sm" variant="outline" onClick={() => setLineOpen(true)}>Add your first line</Button>}>
                  Start with rent and groceries. Mark a line as repeating and it appears in every month after this one.
                </EmptyState>
              ) : (
                <Panel padded={false} className="overflow-hidden">
                  <div className="hidden grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))_40px] gap-3 border-b border-border px-5 py-2.5 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase sm:grid">
                    <span>Category</span><span className="text-right">Planned</span><span className="text-right">Spent</span><span className="text-right">Left</span><span />
                  </div>
                  <ul className="divide-y divide-border">
                  {data.lines.map((l) => {
                    const pct = l.budgetAmount > 0 ? Math.min(100, (l.spent / l.budgetAmount) * 100) : l.spent > 0 ? 100 : 0;
                    const committedPct = l.budgetAmount > 0 ? Math.min(100 - pct, (Math.max(l.scheduledTotal - l.spent, 0) / l.budgetAmount) * 100) : 0;
                    const over = l.spent > l.budgetAmount && l.spent > 0;
                    return (
                      <li key={l.id} className="px-5 py-3.5 transition-colors hover:bg-muted/30">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))_40px]">
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate font-medium">
                              {l.categoryName}
                              {l.isRecurring && <span title="Repeats every month" className="text-muted-foreground"><Repeat className="h-3.5 w-3.5" /></span>}
                              {l.source === "SCHEDULE" && <StatusBadge tone="info" dot={false}>Scheduled</StatusBadge>}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{l.accountName ? `Paid from ${l.accountName}` : "Any account"}</p>
                          </div>
                          <div className="text-right sm:order-none">
                            <InlineAmount value={l.budgetAmount} currency={c} onSave={(v) => saveAmount(l, v)} />
                          </div>
                          <div className="hidden text-right text-sm tabular-nums sm:block"><span className={over ? "text-negative" : ""}>{formatMoney(Math.round(l.spent), c)}</span></div>
                          <div className="hidden text-right text-sm tabular-nums sm:block">
                            {over ? <span className="text-negative">−{formatMoney(Math.round(-l.remaining), c)}</span> : <span className="text-muted-foreground">{formatMoney(Math.round(l.remaining), c)}</span>}
                          </div>
                          <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
                            <span className="text-xs text-muted-foreground tabular-nums sm:hidden">{formatMoney(Math.round(l.spent), c)} spent · {over ? `${formatMoney(Math.round(-l.remaining), c)} over` : `${formatMoney(Math.round(l.remaining), c)} left`}</span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${l.categoryName}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem onClick={() => { setEditingLine(l); setLineOpen(true); }}>Change amount or account…</DropdownMenuItem>
                                <DropdownMenuItem asChild><Link href={`/expenses?new=1&category=${l.categoryId}`}>{l.scheduled.some((o) => o.kind === "EMI") ? "Log this EMI as paid" : "Log an expense"}</Link></DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => removeLine(l, "MONTH")}>Remove from {monthLabel(month, "short")}</DropdownMenuItem>
                                {l.isRecurring && <DropdownMenuItem variant="destructive" onClick={() => removeLine(l, "FORWARD")}>Stop repeating from {monthLabel(month, "short")}</DropdownMenuItem>}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full transition-[width] duration-500", over ? "bg-negative" : pct >= 90 && Math.round(l.spent) !== Math.round(l.budgetAmount) ? "bg-warning" : "bg-foreground/70")} style={{ width: `${pct}%` }} />
                          {committedPct > 0 && <div className="h-full bg-info/40" style={{ width: `${committedPct}%` }} title="Still to pay from scheduled payments" />}
                        </div>
                        {l.scheduled.length > 0 && (
                          <ul className="mt-3 space-y-1 rounded-lg bg-muted/50 p-2">
                            {l.scheduled.map((o) => {
                              const st = occurrenceStatus(o.status, "PAYMENT");
                              const native = o as Occurrence & { nativeAmount?: number; nativeCurrency?: string };
                              return (
                                <li key={`${o.scheduleId}-${o.occurrenceDate}`} className="flex flex-wrap items-center gap-2 px-1.5 py-1 text-xs">
                                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="font-mono text-muted-foreground">{formatDate(o.date, { day: "2-digit", month: "short" })}</span>
                                  <span className="flex-1 truncate">{o.scheduleName}</span>
                                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                                  <span className="text-right tabular-nums">
                                    {native.nativeCurrency && native.nativeCurrency !== c ? <>{formatMoney(Math.round(native.nativeAmount!), native.nativeCurrency)} <span className="text-muted-foreground">≈ {formatMoney(Math.round(o.amount), c)}</span></> : formatMoney(Math.round(o.amount), c)}
                                  </span>
                                  <button className="cursor-pointer text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => openSchedule(o.scheduleId)}>Edit</button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                  </ul>
                </Panel>
              )}
            </Section>
          )}

          {data.unbudgeted.length > 0 && (
            <Section title="Spending without a budget" description={`Categories with spending or scheduled payments in ${monthLabel(month)} but no budget line.`}>
              <Panel padded={false} className="divide-y divide-border">
                {data.unbudgeted.map((l) => (
                  <div key={l.categoryId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <p className="flex-1 text-sm">{l.categoryName}</p>
                    {l.scheduledTotal > 0 && <span className="text-xs text-muted-foreground">{formatMoney(Math.round(l.scheduledTotal), c)} scheduled</span>}
                    <span className="text-sm font-medium tabular-nums">{formatMoney(Math.round(l.spent), c)}</span>
                    {(data.hasPlan || !data.isPast) && (
                      <Button size="sm" variant="outline" onClick={() => { setEditingLine(null); setPrefill(l.categoryId); setLineOpen(true); }}>Budget it</Button>
                    )}
                  </div>
                ))}
              </Panel>
            </Section>
          )}

          <p className="text-xs text-muted-foreground">
            Comparing? <button className="cursor-pointer underline underline-offset-2 hover:text-foreground" onClick={() => setMonth(shiftMonth(month, -1))}>Previous month</button> ·{" "}
            <Link href="/analytics?tab=reports&type=budget" className="underline underline-offset-2 hover:text-foreground">Budget vs actual report</Link>
          </p>
        </>
      )}

      <ConfirmAction
        open={!!pendingCurrency}
        onOpenChange={(o) => !o && setPendingCurrency(null)}
        destructive={false}
        title={`Plan every month in ${pendingCurrency}?`}
        description={<p>Every month&apos;s budget, including planned income, is converted to {pendingCurrency} at today&apos;s rate, and new months start in {pendingCurrency} too. Your actual spending isn&apos;t touched.</p>}
        confirmLabel={`Switch to ${pendingCurrency}`}
        onConfirm={() => switchCurrency(pendingCurrency!)}
      />

      <LineDialog
        open={lineOpen}
        onOpenChange={(o) => { setLineOpen(o); if (!o) { setEditingLine(null); setPrefill(null); } }}
        month={month}
        line={editingLine}
        categories={categories}
        accounts={accounts}
        prefillCategory={prefill}
        takenIds={taken}
        onDone={load}
      />

      <Dialog open={!!scheduleEdit} onOpenChange={(o) => !o && setScheduleEdit(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {scheduleEdit?.name}</DialogTitle>
            <DialogDescription>This is the same schedule you see in Loans & payments. Changes show up there too, and in the coming months&apos; budgets.</DialogDescription>
          </DialogHeader>
          {scheduleEdit && (
            <ScheduleForm
              direction="PAYMENT"
              accounts={accounts}
              categories={categories}
              initial={scheduleEdit}
              onSaved={() => { setScheduleEdit(null); load(); }}
              onCancel={() => setScheduleEdit(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
