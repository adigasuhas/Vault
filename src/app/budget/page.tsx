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
import { AlertTriangle, CalendarClock, ChevronDown, ChevronRight, CornerDownRight, HandCoins, Landmark, MoreHorizontal, PiggyBank, Plus, Repeat, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/context/CurrencyContext";
import { MoneySources } from "@/components/budget/MoneySources";
import { FundingEditor, useChoices, type FundingRow } from "@/components/budget/FundingEditor";
import { sourceKey, type Account, type Budget, type Category, type Group, type Line } from "@/components/budget/types";

const NEW = "__new__";
const NONE = "__none__";
const TOP = "__top__";

/** The line dialog: add a line (any category, or a new one, optionally as a
 * subcategory) or edit one, with where its money comes from and, optionally,
 * the loan or scheduled payment it plans for. Remounted per line. */
function LineForm({
  month,
  line,
  data,
  categories,
  accounts,
  prefillCategory,
  subcategoryOf,
  onDone,
  onCancel,
}: {
  month: string;
  line: Line | null;
  data: Budget;
  categories: Category[];
  accounts: Account[];
  prefillCategory?: string | null;
  /** Adding a subcategory budget under this parent. */
  subcategoryOf?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const editing = !!line?.id;
  const c = data.currency;
  const [categoryId, setCategoryId] = useState(line?.categoryId ?? prefillCategory ?? "");
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string | null>(subcategoryOf ?? null);
  const [amount, setAmount] = useState(line ? String(line.budgetAmount) : "");
  const [accountId, setAccountId] = useState(line?.accountId ?? "");
  const [recurring, setRecurring] = useState(false);
  const [scope, setScope] = useState<"MONTH" | "FORWARD">(line?.isRecurring ? "FORWARD" : "MONTH");
  const [rows, setRows] = useState<FundingRow[]>(() =>
    (line?.funding ?? []).map((f) => {
      const s = data.sources.find((x) => x.id === f.sourceId);
      return { key: s ? sourceKey(s) : `S:${f.sourceId}`, ref: { sourceId: f.sourceId }, amount: String(f.amount) };
    })
  );
  const [loanId, setLoanId] = useState(line?.loan?.id ?? "");
  const [scheduleId, setScheduleId] = useState(line?.paymentSchedule?.id ?? "");
  const [showLinks, setShowLinks] = useState(!!(line?.loan || line?.paymentSchedule));
  const [busy, setBusy] = useState(false);
  const choices = useChoices(data.sources, data.fundingOptions, line?.funding ?? []);

  const taken = new Set(data.lines.map((l) => l.categoryId));
  const tops = categories.filter((x) => x.depth === 0);
  const pickable = categories.filter((x) => (subcategoryOf ? x.parentId === subcategoryOf : true));
  const amt = Number(amount || 0);
  // A parent's line funds its whole group, so it can take up to the group's total.
  const group = data.groups.find((g) => g.categoryId === (line?.categoryId ?? categoryId));
  const target = group && (line?.categoryId ?? categoryId) === group.categoryId ? Math.max(amt, group.breakdown) : amt;
  const funding = rows.filter((r) => Number(r.amount) > 0).map((r) => ({ ...r.ref, amount: Number(r.amount) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const links = { loanId: loanId || null, paymentScheduleId: scheduleId || null };
      if (editing) {
        await api(`/api/budget/allocations/${line!.id}`, { method: "PATCH", body: { budgetAmount: amt, accountId: accountId || null, scope, funding, ...links } });
        toast.success(scope === "FORWARD" ? `Updated from ${monthLabel(month, "short")} onward.` : `Updated for ${monthLabel(month)}.`);
      } else {
        await api("/api/budget/allocations", {
          body: {
            month,
            ...(categoryId === NEW ? { newCategoryName: newName.trim(), newCategoryParentId: newParent } : { categoryId }),
            budgetAmount: amt,
            accountId: accountId || null,
            recurring,
            funding,
            ...links,
          },
        });
        toast.success(recurring ? `Budgeted every month from ${monthLabel(month, "short")}.` : `Budgeted for ${monthLabel(month)}.`);
      }
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title = editing ? `Edit ${line!.categoryName}` : subcategoryOf ? `Split ${categories.find((x) => x.id === subcategoryOf)?.name}` : "Add to budget";
  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {monthLabel(month)}
          {editing && line!.source === "SCHEDULE" ? " · sized from scheduled payments until you change it" : ""}
          {subcategoryOf ? " · a subcategory's budget is part of its parent's, not extra" : ""}
        </DialogDescription>
      </DialogHeader>

      {!editing && (
        <div className="space-y-1.5">
          <Label>{subcategoryOf ? "Subcategory" : "Category"}</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Choose category" /></SelectTrigger>
            <SelectContent>
              {pickable.map((x) => (
                <SelectItem key={x.id} value={x.id} disabled={taken.has(x.id)}>
                  <span className={cn("flex items-center gap-1.5", x.depth === 1 && !subcategoryOf && "pl-3")}>
                    {x.depth === 1 && !subcategoryOf && <CornerDownRight className="h-3 w-3 text-muted-foreground" />}
                    {x.name}
                    {taken.has(x.id) && <span className="text-muted-foreground">· already budgeted</span>}
                  </span>
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={NEW}>+ New {subcategoryOf ? "subcategory" : "category"}…</SelectItem>
            </SelectContent>
          </Select>
          {categoryId === NEW && (
            <div className={cn("grid gap-2", !subcategoryOf && "sm:grid-cols-2")}>
              <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={subcategoryOf ? "e.g. Dairy" : "Category name"} aria-label="New category name" />
              {!subcategoryOf && (
                <Select value={newParent ?? TOP} onValueChange={(v) => setNewParent(v === TOP ? null : v)}>
                  <SelectTrigger className="w-full" aria-label="Sits under"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TOP}>Top level</SelectItem>
                    {tops.map((t) => <SelectItem key={t.id} value={t.id}>Under {t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="b-amt">Amount ({c})</Label>
          <Input id="b-amt" type="number" inputMode="decimal" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
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
            <span className="block text-xs text-muted-foreground">The amount, from {monthLabel(month)} onward. Funding is chosen each month.</span>
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

      <fieldset className="space-y-2.5 border-t border-border pt-4">
        <legend className="sr-only">Funding</legend>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium">Where the money comes from</p>
          {editing && scope === "FORWARD" && <p className="text-[11px] text-muted-foreground">For {monthLabel(month, "short")} only</p>}
        </div>
        <FundingEditor currency={c} target={target} rows={rows} onChange={setRows} choices={choices} />
      </fieldset>

      <fieldset className="border-t border-border pt-4">
        <legend className="sr-only">Plan for a loan or a scheduled payment</legend>
        <button type="button" aria-expanded={showLinks} onClick={() => setShowLinks((v) => !v)} className="flex w-full cursor-pointer items-center gap-1.5 text-left text-sm font-medium">
          {showLinks ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Plan for a loan or a scheduled payment
          <span className="ml-auto text-xs font-normal text-muted-foreground">Optional</span>
        </button>
        {showLinks && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Loan</Label>
              <Select value={loanId || NONE} onValueChange={(v) => setLoanId(v === NONE ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {data.linkOptions.loans.map((l) => <SelectItem key={l.id} value={l.id}>{l.name} <span className="text-muted-foreground">· EMI {formatMoney(l.emi, l.currency)}</span></SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scheduled payment</Label>
              <Select value={scheduleId || NONE} onValueChange={(v) => setScheduleId(v === NONE ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {data.linkOptions.paymentSchedules.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} <span className="text-muted-foreground">· {formatMoney(p.amount, p.currency)}</span></SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">Linking only compares the plan with what&apos;s actually paid. It doesn&apos;t pay anything, mark a payment done or change what you owe.</p>
          </div>
        )}
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy || (!editing && (!categoryId || (categoryId === NEW && !newName.trim())))}>{busy ? "Saving…" : editing ? "Save" : "Add"}</Button>
      </DialogFooter>
    </form>
  );
}

/** Click the planned amount to edit it in place; Enter saves (this month
 * only), Escape cancels. The line's menu offers the other scopes. */
function InlineAmount({ value, currency, onSave, label }: { value: number; currency: string; onSave: (v: number) => Promise<void>; label: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(value)); setEditing(true); }}
        title="Click to change this month's amount"
        aria-label={`${label}: ${formatMoney(value, currency)}. Change`}
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
      aria-label={`${label}: planned amount`}
    />
  );
}

const grid = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,0.75fr))_40px]";
const dot = (color: string | null | undefined) => (color ? `var(--series-${color})` : undefined);

export default function BudgetPage() {
  const fx = useCurrency();
  const [month, setMonth] = useState(localMonth());
  const [data, setData] = useState<Budget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [dialog, setDialog] = useState<{ line: Line | null; prefill?: string | null; subcategoryOf?: string | null } | null>(null);
  const [incomeDraft, setIncomeDraft] = useState<string | null>(null);
  const [scheduleEdit, setScheduleEdit] = useState<ScheduleFormValue | null>(null);
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    Promise.all([api<Budget>(`/api/budget?month=${month}`), api<{ accounts: Account[] }>("/api/accounts"), api<{ categories: Category[] }>("/api/categories")])
      .then(([b, a, cs]) => {
        if (!alive) return;
        setData(b);
        setError(null);
        setIncomeDraft(null);
        setAccounts(a.accounts.filter((x) => x.status !== "CLOSED"));
        setCategories(cs.categories);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [month, nonce]);
  const changeMonth = (m: string) => {
    setData(null);
    setMonth(m);
  };

  const c = data?.currency ?? "INR";
  const catById = useMemo(() => new Map(categories.map((x) => [x.id, x])), [categories]);
  const lineByCat = useMemo(() => new Map((data?.lines ?? []).map((l) => [l.categoryId, l])), [data]);

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
  async function nestUnder(categoryId: string, parentId: string, name: string, parentName: string) {
    try {
      await api(`/api/budget/categories/${categoryId}`, { method: "PATCH", body: { parentId } });
      toast.success(`${name} now sits under ${parentName}, so its amount counts as part of ${parentName}'s, once.`);
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

  const usesSources = !!data && data.sources.length > 0;
  const available = data ? (usesSources ? (data.available?.total ?? 0) : data.totalIncome) : 0;
  const left = available - (data?.totalBudgeted ?? 0);
  const allocatedPct = available > 0 ? ((data?.totalBudgeted ?? 0) / available) * 100 : 0;
  const unfundedTotal = data ? Math.max(0, data.totalBudgeted - data.totalFunded) : 0;
  const incomeValue = incomeDraft ?? (data?.totalIncome ? String(data.totalIncome) : "");

  /** One line's details: funding, links, warnings, scheduled payments. */
  const details = (l: Line, g: Group | null) => {
    const atRisk = l.funding.filter((f) => f.atRisk);
    return (
      <>
        {l.loan?.alsoBudgeted && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{l.loan.alsoBudgeted.name} already budgets {formatMoney(l.loan.alsoBudgeted.amount, c)} for this loan, so the repayment is planned twice.</span>
            <button className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline" onClick={() => nestUnder(l.loan!.alsoBudgeted!.categoryId, l.categoryId, l.loan!.alsoBudgeted!.name, l.categoryName)}>
              Put it under {l.categoryName}
            </button>
          </div>
        )}
        {(l.loan || l.paymentSchedule) && (
          <ul className="mt-2.5 space-y-1 text-xs text-muted-foreground">
            {l.loan && (
              <li className="flex flex-wrap items-center gap-x-2">
                <HandCoins className="h-3.5 w-3.5" />
                <span>Plans {formatMoney(l.budgetAmount, c)} towards <Link href="/loans" className="text-foreground underline-offset-2 hover:underline">{l.loan.name}</Link></span>
                <span className={cn("tabular-nums", l.loan.repaid >= l.budgetAmount - 0.005 && l.budgetAmount > 0 ? "text-positive" : "")}>· {formatMoney(l.loan.repaid, c)} repaid this month{l.loan.payments ? ` (${l.loan.payments} payment${l.loan.payments === 1 ? "" : "s"})` : ""}</span>
              </li>
            )}
            {l.paymentSchedule && (
              <li className="flex flex-wrap items-center gap-x-2">
                <CalendarClock className="h-3.5 w-3.5" />
                <span>Covers <button className="cursor-pointer text-foreground underline-offset-2 hover:underline" onClick={() => openSchedule(l.paymentSchedule!.id)}>{l.paymentSchedule.name}</button></span>
                <span className="tabular-nums">· {formatMoney(l.paymentSchedule.planned, c)} due this month, {formatMoney(l.paymentSchedule.paid, c)} paid</span>
              </li>
            )}
          </ul>
        )}
        {atRisk.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            Relies on {atRisk.map((f) => f.label).join(" and ")}, which no longer covers all it was counted for.
          </p>
        )}
        {g && g.over > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            Its subcategories add up to {formatMoney(g.breakdown, c)}, {formatMoney(g.over, c)} more than {g.name}&apos;s {formatMoney(g.own ?? 0, c)}. The budget counts {formatMoney(g.total, c)}.
          </p>
        )}
        {l.scheduled.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg bg-muted/50 p-2">
            {l.scheduled.map((o) => {
              const st = occurrenceStatus(o.status, "PAYMENT");
              return (
                <li key={`${o.scheduleId}-${o.occurrenceDate}`} className="flex flex-wrap items-center gap-2 px-1.5 py-1 text-xs">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-muted-foreground">{formatDate(o.date, { day: "2-digit", month: "short" })}</span>
                  <span className="flex-1 truncate">{o.scheduleName}</span>
                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  <span className="text-right tabular-nums">
                    {o.nativeCurrency && o.nativeCurrency !== c ? <>{formatMoney(Math.round(o.nativeAmount!), o.nativeCurrency)} <span className="text-muted-foreground">≈ {formatMoney(Math.round(o.amount), c)}</span></> : formatMoney(Math.round(o.amount), c)}
                  </span>
                  <button className="cursor-pointer text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => openSchedule(o.scheduleId)}>Edit</button>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  };

  /** Funding in a few words, under a line's name. */
  const fundingLine = (l: Line | undefined, g: Group) => {
    const parts = (l?.funding ?? []).map((f) => `${f.label.replace(/ \(\d+ \w+\)$/, "")} ${formatMoney(f.amount, c)}`);
    const childFunded = g.funded - (l?.funded ?? 0);
    if (childFunded > 0.005) parts.push(`${formatMoney(childFunded, c)} funded in subcategories`);
    return (
      <p className="truncate text-xs text-muted-foreground">
        {parts.length ? <><Wallet className="mr-1 inline h-3 w-3 align-[-1px]" />{parts.join(" · ")}</> : l?.accountName ? `Paid from ${l.accountName}` : usesSources ? "No source yet" : l ? "Any account" : "Budgeted in its subcategories"}
        {usesSources && g.unfunded > 0.005 && parts.length > 0 && <span className="text-warning"> · {formatMoney(g.unfunded, c)} unfunded</span>}
      </p>
    );
  };

  const lineMenu = (l: Line, g: Group | null) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${l.categoryName}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={() => setDialog({ line: l })}>Edit amount, funding or links…</DropdownMenuItem>
        {g && catById.get(g.categoryId)?.depth === 0 && <DropdownMenuItem onClick={() => setDialog({ line: null, subcategoryOf: g.categoryId })}>Split into subcategories…</DropdownMenuItem>}
        <DropdownMenuItem asChild><Link href={`/expenses?new=1&category=${l.categoryId}`}>{l.scheduled.some((o) => o.kind === "EMI") ? "Log this EMI as paid" : "Log an expense"}</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => removeLine(l, "MONTH")}>Remove from {monthLabel(month, "short")}</DropdownMenuItem>
        {l.isRecurring && <DropdownMenuItem variant="destructive" onClick={() => removeLine(l, "FORWARD")}>Stop repeating from {monthLabel(month, "short")}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const bar = (spent: number, planned: number, scheduled = 0) => {
    const pct = planned > 0 ? Math.min(100, (spent / planned) * 100) : spent > 0 ? 100 : 0;
    const committedPct = planned > 0 ? Math.min(100 - pct, (Math.max(scheduled - spent, 0) / planned) * 100) : 0;
    const over = spent > planned && spent > 0;
    return (
      <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full transition-[width] duration-500", over ? "bg-negative" : pct >= 90 && Math.round(spent) !== Math.round(planned) ? "bg-warning" : "bg-foreground/70")} style={{ width: `${pct}%` }} />
        {committedPct > 0 && <div className="h-full bg-info/40" style={{ width: `${committedPct}%` }} title="Still to pay from scheduled payments" />}
      </div>
    );
  };

  const leftCell = (remaining: number) =>
    remaining < 0 ? <span className="text-negative">−{formatMoney(Math.round(-remaining), c)}</span> : <span className="text-muted-foreground">{formatMoney(Math.round(remaining), c)}</span>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Budget"
        description="Give every bit of this month's money a job: which categories it's for, how much, and where it comes from. Planning only; nothing here moves money."
        actions={
          <>
            {data?.hasPlan && (
              <Select value={data.currency} onValueChange={(v) => v !== data.currency && setPendingCurrency(v)}>
                <SelectTrigger className="w-auto gap-2" aria-label="Budget currency"><span className="text-xs text-muted-foreground">Planned in</span><SelectValue /></SelectTrigger>
                <SelectContent>{SUPPORTED_CURRENCIES.map((cur) => <SelectItem key={cur.code} value={cur.code}>{cur.code}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <MonthSwitcher month={month} onChange={changeMonth} />
          </>
        }
      />
      {error && <ErrorState message={error} onRetry={load} />}
      {!data ? (
        <div className="space-y-4"><SkeletonBlock className="h-28" /><SkeletonBlock className="h-40" /><SkeletonBlock className="h-64" /></div>
      ) : (
        <>
          {data.isPast && !data.hasPlan ? (
            <EmptyState
              icon={<PiggyBank className="h-5 w-5" />}
              title={`No budget was set for ${monthLabel(month)}`}
              action={<Button variant="outline" onClick={() => setDialog({ line: null })}>Create one for {monthLabel(month, "short")}</Button>}
            >
              Recurring budgets only start from the month they were set, so past months aren&apos;t filled in. Spending from that month is listed below.
            </EmptyState>
          ) : (
            <Panel className="settle overflow-hidden p-0">
              <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
                <div className="col-span-2 bg-card p-5 sm:col-span-1">
                  {usesSources ? (
                    <Stat
                      label="Available"
                      value={formatMoney(Math.round(available), c)}
                      hint={[
                        data.available!.received > 0 ? `${formatMoney(Math.round(data.available!.received), c)} received` : null,
                        data.available!.expected > 0 ? `${formatMoney(Math.round(data.available!.expected), c)} expected` : null,
                        data.available!.fromAccounts > 0 ? `${formatMoney(Math.round(data.available!.fromAccounts), c)} from balances` : null,
                      ].filter(Boolean).join(" · ")}
                    />
                  ) : (
                    <>
                      <p className="eyebrow">Planned income</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Input type="number" min="0" value={incomeValue} onChange={(e) => setIncomeDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveIncome()} placeholder="0" aria-label="Planned income" className="h-9 text-lg font-semibold tabular-nums" />
                        {incomeDraft != null && Number(incomeDraft || 0) !== data.totalIncome && <Button size="sm" onClick={() => saveIncome()}>Save</Button>}
                      </div>
                      {data.expectedIncome > 0 && Math.round(data.expectedIncome) !== Math.round(data.totalIncome) && (
                        <button className="mt-1.5 cursor-pointer text-left text-xs text-brass hover:underline" onClick={() => saveIncome(Math.round(data.expectedIncome))}>
                          Use {formatMoney(Math.round(data.expectedIncome), c)} from schedules
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="bg-card p-5">
                  <Stat label="Allocated" value={formatMoney(Math.round(data.totalBudgeted), c)} hint={available > 0 ? `${Math.round(allocatedPct)}% of ${usesSources ? "available" : "income"}` : undefined} />
                </div>
                <div className="bg-card p-5">
                  {available === 0 ? (
                    <Stat label="Unallocated" value={<span className="text-muted-foreground">–</span>} hint="Add money or planned income to see what's left" />
                  ) : (
                    <Stat
                      label={left >= 0 ? "Unallocated" : "Over-allocated"}
                      value={<span className={left < 0 ? "text-negative" : ""}>{formatMoney(Math.round(Math.abs(left)), c)}</span>}
                      hint={left > 0.5 ? "Not given a job yet" : left < -0.5 ? "Allocations exceed what's available" : "Every bit has a job"}
                    />
                  )}
                </div>
                <div className="col-span-2 bg-card p-5 sm:col-span-1">
                  <Stat label="Spent" value={formatMoney(Math.round(data.totalSpent), c)} hint={[data.totalBudgeted > 0 ? `${Math.round((data.totalSpent / data.totalBudgeted) * 100)}% of budget` : null, data.oneTimeExcluded > 0 ? `${formatMoney(Math.round(data.oneTimeExcluded), c)} of one-time purchases not counted` : null].filter(Boolean).join(" · ") || undefined} />
                </div>
              </div>
              {available > 0 && (
                <div className="border-t border-border px-5 py-3">
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(allocatedPct)}% of available money allocated`}>
                    <div className={cn("h-full transition-[width] duration-500", left < -0.5 ? "bg-negative" : "bg-brass")} style={{ width: `${Math.min(100, allocatedPct)}%` }} />
                  </div>
                  <p className="mt-1.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatMoney(Math.round(data.totalBudgeted), c)} of {formatMoney(Math.round(available), c)} allocated</span>
                    {usesSources && (unfundedTotal > 0.5 ? <span className="text-warning">{formatMoney(Math.round(unfundedTotal), c)} of the budget has no source yet</span> : data.totalBudgeted > 0 ? <span className="text-positive">Every line has a source</span> : null)}
                    {usesSources && data.available!.short > 0.5 && <span className="text-warning">{formatMoney(Math.round(data.available!.short), c)} of the money counted on is no longer there</span>}
                  </p>
                </div>
              )}
            </Panel>
          )}

          {(data.hasPlan || !data.isPast) && <MoneySources data={data} onChanged={load} />}

          {(data.hasPlan || !data.isPast) && (
            <Section
              title="Allocations"
              description={data.groups.length ? `${data.groups.length} ${data.groups.length === 1 ? "category" : "categories"}${data.lines.length > data.groups.length ? `, ${data.lines.length - data.groups.length} split into subcategories` : ""}` : undefined}
              actions={<Button size="sm" onClick={() => setDialog({ line: null })}><Plus /> Add allocation</Button>}
            >
              {data.groups.length === 0 ? (
                <EmptyState icon={<PiggyBank className="h-5 w-5" />} title={`Nothing budgeted for ${monthLabel(month)} yet`} action={<Button size="sm" variant="outline" onClick={() => setDialog({ line: null })}>Add your first allocation</Button>}>
                  Start with rent and groceries. Budget a whole category, or split it into subcategories; mark one as repeating and it appears every month.
                </EmptyState>
              ) : (
                <Panel padded={false} className="overflow-hidden">
                  <div className={cn(grid, "hidden border-b border-border px-5 py-2.5 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase sm:grid")}>
                    <span>Category</span><span className="text-right">Planned</span><span className="text-right">Spent</span><span className="text-right">Left</span><span />
                  </div>
                  <ul className="divide-y divide-border">
                    {data.groups.map((g) => {
                      const own = g.lineId ? data.lines.find((l) => l.id === g.lineId) : undefined;
                      const kids = g.children;
                      const isOpen = open.has(g.categoryId);
                      const cat = catById.get(g.categoryId);
                      return (
                        <li key={g.categoryId} className="px-5 py-3.5 transition-colors hover:bg-muted/20">
                          <div className={grid}>
                            <div className="flex min-w-0 items-start gap-2">
                              {kids.length > 0 ? (
                                <button
                                  type="button"
                                  aria-expanded={isOpen}
                                  aria-label={`${isOpen ? "Hide" : "Show"} ${g.name}'s subcategories`}
                                  onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(g.categoryId)) n.delete(g.categoryId); else n.add(g.categoryId); return n; })}
                                  className="-ml-1.5 grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </button>
                              ) : (
                                <span className="-ml-1.5 w-6 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <p className="flex items-center gap-2 truncate font-medium">
                                  {cat?.color && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot(cat.color) }} />}
                                  <span className="truncate">{g.name}</span>
                                  {own?.isRecurring && <span title="Repeats every month" className="text-muted-foreground"><Repeat className="h-3.5 w-3.5" /></span>}
                                  {own?.source === "SCHEDULE" && <StatusBadge tone="info" dot={false}>Scheduled</StatusBadge>}
                                  {kids.length > 0 && <span className="text-xs font-normal text-muted-foreground">{kids.length} sub</span>}
                                </p>
                                {fundingLine(own, g)}
                              </div>
                            </div>
                            <div className="text-right">
                              {own ? (
                                <InlineAmount value={own.budgetAmount} currency={c} label={g.name} onSave={(v) => saveAmount(own, v)} />
                              ) : (
                                <span className="px-1.5 text-sm font-medium tabular-nums text-muted-foreground" title="The total of its subcategories">{formatMoney(Math.round(g.total), c)}</span>
                              )}
                              {own && g.breakdown > 0 && <p className="px-1.5 text-[11px] text-muted-foreground tabular-nums">{formatMoney(Math.round(g.breakdown), c)} split</p>}
                            </div>
                            <div className="hidden text-right text-sm tabular-nums sm:block"><span className={g.spent > g.total && g.spent > 0 ? "text-negative" : ""}>{formatMoney(Math.round(g.spent), c)}</span></div>
                            <div className="hidden text-right text-sm tabular-nums sm:block">{leftCell(g.remaining)}</div>
                            <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
                              <span className="text-xs text-muted-foreground tabular-nums sm:hidden">{formatMoney(Math.round(g.spent), c)} spent · {g.remaining < 0 ? `${formatMoney(Math.round(-g.remaining), c)} over` : `${formatMoney(Math.round(g.remaining), c)} left`}</span>
                              {own ? (
                                lineMenu(own, g)
                              ) : (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More for ${g.name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-60">
                                    <DropdownMenuItem onClick={() => setDialog({ line: null, prefill: g.categoryId })}>Set one amount for {g.name}…</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setDialog({ line: null, subcategoryOf: g.categoryId })}>Add another subcategory…</DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </div>
                          {bar(g.spent, g.total, own?.scheduledTotal ?? 0)}
                          {own && details(own, g)}
                          {kids.length > 0 && isOpen && (
                            <ul aria-label={`${g.name}'s subcategories`} className="mt-3 divide-y divide-border/60 rounded-lg border border-border/70 bg-muted/20">
                              {kids.map((id) => {
                                const l = lineByCat.get(id);
                                const spent = data.spentByCategory[id] ?? 0;
                                const name = catById.get(id)?.name ?? l?.categoryName ?? "Subcategory";
                                return (
                                  <li key={id} className="px-3 py-2.5">
                                    <div className={grid}>
                                      <div className="flex min-w-0 items-start gap-2 pl-1">
                                        <CornerDownRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                                        <div className="min-w-0">
                                          <p className="truncate text-sm">{name}</p>
                                          <p className="truncate text-[11.5px] text-muted-foreground">
                                            {l ? (l.funding.length ? l.funding.map((f) => `${f.label.replace(/ \(\d+ \w+\)$/, "")} ${formatMoney(f.amount, c)}`).join(" · ") : `Part of ${g.name}`) : `Spent in ${g.name}, no amount of its own`}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        {l ? <InlineAmount value={l.budgetAmount} currency={c} label={name} onSave={(v) => saveAmount(l, v)} /> : <span className="px-1.5 text-sm text-muted-foreground">–</span>}
                                      </div>
                                      <div className="hidden text-right text-sm tabular-nums sm:block">{formatMoney(Math.round(spent), c)}</div>
                                      <div className="hidden text-right text-sm tabular-nums sm:block">{l ? leftCell(l.budgetAmount - spent) : <span className="text-muted-foreground">–</span>}</div>
                                      <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
                                        <span className="text-xs text-muted-foreground tabular-nums sm:hidden">{formatMoney(Math.round(spent), c)} spent{l ? ` · ${formatMoney(Math.round(l.budgetAmount - spent), c)} left` : ""}</span>
                                        {l ? lineMenu(l, null) : <Button size="sm" variant="ghost" onClick={() => setDialog({ line: null, prefill: id, subcategoryOf: g.categoryId })}>Budget it</Button>}
                                      </div>
                                    </div>
                                    {l && details(l, null)}
                                  </li>
                                );
                              })}
                              {g.unassigned > 0 && (
                                <li className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
                                  <span className="pl-6">Not split out: in {g.name}, for anything else</span>
                                  <span className="tabular-nums">{formatMoney(Math.round(g.unassigned), c)}</span>
                                </li>
                              )}
                            </ul>
                          )}
                          {kids.length > 0 && !isOpen && g.unassigned > 0 && own && (
                            <p className="mt-2 pl-7 text-[11.5px] text-muted-foreground">{formatMoney(Math.round(g.unassigned), c)} of it isn&apos;t split into a subcategory</p>
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
                    <p className="flex-1 text-sm">{catById.get(l.categoryId)?.path ?? l.categoryName}</p>
                    {l.scheduledTotal > 0 && <span className="text-xs text-muted-foreground">{formatMoney(Math.round(l.scheduledTotal), c)} scheduled</span>}
                    <span className="text-sm font-medium tabular-nums">{formatMoney(Math.round(l.spent), c)}</span>
                    {(data.hasPlan || !data.isPast) && (
                      <Button size="sm" variant="outline" onClick={() => setDialog({ line: null, prefill: l.categoryId })}>Budget it</Button>
                    )}
                  </div>
                ))}
              </Panel>
            </Section>
          )}

          <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            <Landmark className="mr-1 h-3.5 w-3.5" />
            Comparing? <button className="cursor-pointer underline underline-offset-2 hover:text-foreground" onClick={() => changeMonth(shiftMonth(month, -1))}>Previous month</button> ·{" "}
            <Link href="/analytics?tab=reports&type=budget" className="underline underline-offset-2 hover:text-foreground">Budget vs actual report</Link> ·{" "}
            <Link href="/settings#categories" className="underline underline-offset-2 hover:text-foreground">Manage categories</Link>
          </p>
        </>
      )}

      <ConfirmAction
        open={!!pendingCurrency}
        onOpenChange={(o) => !o && setPendingCurrency(null)}
        destructive={false}
        title={`Plan every month in ${pendingCurrency}?`}
        description={<p>Every month&apos;s budget, including planned income, money sources and funding, is converted to {pendingCurrency} at today&apos;s rate, and new months start in {pendingCurrency} too. Your actual spending isn&apos;t touched.</p>}
        confirmLabel={`Switch to ${pendingCurrency}`}
        onConfirm={() => switchCurrency(pendingCurrency!)}
      />

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          {dialog && data && (
            <LineForm
              key={dialog.line?.id ?? `new:${dialog.prefill ?? ""}:${dialog.subcategoryOf ?? ""}`}
              month={month}
              line={dialog.line}
              data={data}
              categories={categories}
              accounts={accounts}
              prefillCategory={dialog.prefill}
              subcategoryOf={dialog.subcategoryOf}
              onDone={() => { setDialog(null); load(); }}
              onCancel={() => setDialog(null)}
            />
          )}
        </DialogContent>
      </Dialog>

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
