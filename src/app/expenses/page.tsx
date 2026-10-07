"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api, localMonth, localToday, newKey } from "@/lib/client";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { addDaysUTC, isoDate, monthLabel } from "@/lib/dates";
import { PageHeader, Panel, Section, EmptyState, SkeletonBlock, ErrorState } from "@/components/app/PageHeader";
import { MonthSwitcher } from "@/components/app/MonthSwitcher";
import { Money } from "@/components/app/Money";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmAction } from "@/components/ConfirmAction";
import { MoreHorizontal, Plus, Receipt, Search, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/context/CurrencyContext";

interface Account { id: string; name: string; currency: string; currentBalance: string; status: string; accountType: string }
interface Category { id: string; name: string; defaultAccountId: string | null }
interface Expense {
  id: string;
  amount: string;
  currency: string;
  date: string;
  description: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  notes: string | null;
  oneTime: boolean;
  countInBudget: boolean;
  category: { id: string; name: string };
  /** Null for a one-time purchase logged without an account. */
  account: { id: string; name: string; currency: string; status: string } | null;
  project: { id: string; name: string } | null;
}
interface Project { id: string; name: string; notes: string | null; archivedAt: string | null; count: number; byCurrency: { currency: string; amount: number }[]; total: number | null; lastDate: string | null }
interface BudgetLine { categoryId: string; budgetAmount: number; spent: number; accountId: string | null; id: string | null }
interface BudgetResp { month: string; currency: string; lines: BudgetLine[]; unbudgeted: BudgetLine[]; hasPlan: boolean }

const NEW_CAT = "__new__";
const NEW_GROUP = "__new_group__";
const NO_GROUP = "__none__";
const NO_ACCOUNT = "__no_account__";

function relDay(iso: string) {
  const today = localToday();
  if (iso === today) return "Today";
  if (iso === isoDate(addDaysUTC(new Date(today), -1))) return "Yesterday";
  return formatDate(iso, { weekday: "short", day: "numeric", month: "short" });
}

/** Budget context for the category in the month the expense falls in. */
function useBudgetHint(month: string) {
  const cache = useRef(new Map<string, BudgetResp>());
  const [data, setData] = useState<BudgetResp | null>(null);
  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const hit = cache.current.get(month);
    if (hit) return setData(hit);
    setData(null);
    api<BudgetResp>(`/api/budget?month=${month}`)
      .then((d) => {
        cache.current.set(month, d);
        setData(d);
      })
      .catch(() => {});
  }, [month]);
  const invalidate = () => cache.current.clear();
  return { data, invalidate };
}

function ExpenseForm({
  accounts,
  categories,
  initial,
  onSaved,
  onCancel,
  onCategoryCreated,
  oneTime = false,
  projects = [],
  onProjectCreated,
  defaultProjectId,
  defaultCategoryId,
}: {
  accounts: Account[];
  categories: Category[];
  initial?: Expense | null;
  onSaved: () => void;
  onCancel?: () => void;
  onCategoryCreated: (c: Category) => void;
  oneTime?: boolean;
  projects?: Project[];
  onProjectCreated?: (p: Project) => void;
  defaultProjectId?: string | null;
  defaultCategoryId?: string;
}) {
  const editing = !!initial;
  const [projectId, setProjectId] = useState(initial?.project?.id ?? defaultProjectId ?? NO_GROUP);
  const [newGroup, setNewGroup] = useState("");
  const [countInBudget, setCountInBudget] = useState(initial?.countInBudget ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [amount, setAmount] = useState(initial ? String(Number(initial.amount)) : "");
  const [date, setDate] = useState(initial ? initial.date.slice(0, 10) : localToday());
  const [categoryId, setCategoryId] = useState(initial?.category.id ?? defaultCategoryId ?? "");
  // One-time purchases don't have to say how they were paid: no account is
  // picked for them unless the user chooses one.
  const [accountId, setAccountId] = useState(initial ? (initial.account?.id ?? NO_ACCOUNT) : oneTime ? NO_ACCOUNT : "");
  const { primary } = useCurrency();
  const [currency, setCurrency] = useState(initial?.currency ?? primary);
  const noAccount = accountId === NO_ACCOUNT;
  const [description, setDescription] = useState(initial?.description ?? "");
  const [newCat, setNewCat] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey());
  const touchedAccount = useRef(!!initial);
  const amountRef = useRef<HTMLInputElement>(null);
  const month = date.slice(0, 7);
  const { data: budget, invalidate } = useBudgetHint(month);

  // Pre-select the account the category's budget is paid from.
  useEffect(() => {
    if (oneTime || touchedAccount.current || !categoryId) return;
    const line = budget?.lines.find((l) => l.categoryId === categoryId);
    const preferred = line?.accountId ?? categories.find((c) => c.id === categoryId)?.defaultAccountId;
    if (preferred && accounts.some((a) => a.id === preferred)) setAccountId(preferred);
  }, [categoryId, budget, categories, accounts, oneTime]);
  useEffect(() => {
    if (!oneTime && !accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [accounts, accountId, oneTime]);

  const line = budget ? [...budget.lines, ...budget.unbudgeted].find((l) => l.categoryId === categoryId && l.id) : null;
  // Categories budgeted for the expense's own month come first; everything
  // else is still allowed, but clearly labelled as outside that budget.
  const budgetedIds = new Set((budget?.lines ?? []).filter((l) => l.id).map((l) => l.categoryId));
  const budgetedCats = categories.filter((c) => budgetedIds.has(c.id));
  const otherCats = categories.filter((c) => !budgetedIds.has(c.id));
  const account = accounts.find((a) => a.id === accountId);
  const cur = account?.currency ?? currency;
  const amt = Number(amount);
  const catName = categories.find((c) => c.id === categoryId)?.name;
  const today = localToday();
  const yesterday = isoDate(addDaysUTC(new Date(today), -1));
  const overdraw = account && !["CREDIT_CARD", "LOAN"].includes(account.accountType) && amt > Number(account.currentBalance) + (initial && initial.account?.id === account.id ? Number(initial.amount) : 0);

  async function createCategory() {
    if (!newCat.trim()) return;
    try {
      const r = await api<{ category: Category }>("/api/categories", { body: { name: newCat.trim() } });
      onCategoryCreated(r.category);
      setCategoryId(r.category.id);
      setNewCat("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function createGroup() {
    if (!newGroup.trim()) return;
    try {
      const r = await api<{ project: Project }>("/api/expense-projects", { body: { name: newGroup.trim() } });
      const p = { ...r.project, count: 0, byCurrency: [], total: 0, lastDate: null };
      onProjectCreated?.(p);
      setProjectId(p.id);
      setNewGroup("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const groupPending = oneTime && projectId === NEW_GROUP;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(amt > 0) || !categoryId || categoryId === NEW_CAT || !accountId || groupPending) return;
    const payFrom = noAccount ? null : accountId;
    const extra = oneTime ? { oneTime: true, countInBudget, projectId: projectId === NO_GROUP ? null : projectId, notes: notes.trim() || null } : {};
    setBusy(true);
    try {
      if (editing) {
        await api(`/api/expenses/${initial!.id}`, { method: "PATCH", body: { amount: amt, date, categoryId, accountId: payFrom, ...(noAccount ? { currency } : {}), description: description || null, ...extra } });
        toast.success("Expense corrected. The original stays on the statement with its reversal.");
      } else {
        const r = await api<{ duplicate: boolean; loanEmi?: { loanName: string; paidCount: number | null } }>("/api/expenses", { body: { amount: amt, date, categoryId, accountId: payFrom, description: description || undefined, currency: cur, idempotencyKey: key, ...extra, notes: oneTime ? notes.trim() || undefined : undefined } });
        toast.success(
          r.duplicate
            ? "Already logged. We didn't add it twice."
            : r.loanEmi
              ? `${formatMoney(amt, cur)} recorded as ${r.loanEmi.loanName} EMI${r.loanEmi.paidCount ? ` #${r.loanEmi.paidCount}` : ""}. It shows as paid in Loans & EMIs.`
              : `${formatMoney(amt, cur)} on ${catName} logged for ${formatDate(date, { day: "numeric", month: "short" })}.`
        );
        setAmount("");
        setDescription("");
        setNotes("");
        setKey(newKey());
        amountRef.current?.focus();
      }
      invalidate();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1.1fr_1.3fr_1.3fr]">
        <div className="space-y-1.5">
          <Label htmlFor="x-amt">Amount{cur ? ` (${cur})` : ""}</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{SUPPORTED_CURRENCIES.find((c) => c.code === cur)?.symbol ?? ""}</span>
            <Input ref={amountRef} id="x-amt" autoFocus type="number" inputMode="decimal" step="0.01" min="0" required value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10 pl-8 text-lg font-medium tabular-nums" placeholder="0" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Choose category" /></SelectTrigger>
            <SelectContent>
              {budgetedCats.length > 0 && (
                <SelectGroup>
                  <SelectLabel>In the {monthLabel(month, "short")} budget</SelectLabel>
                  {budgetedCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectGroup>
              )}
              {budgetedCats.length > 0 && otherCats.length > 0 && <SelectSeparator />}
              {otherCats.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{budgetedCats.length ? `Not budgeted in ${monthLabel(month, "short")}` : budget ? `No budget for ${monthLabel(month, "short")}` : "Categories"}</SelectLabel>
                  {otherCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectGroup>
              )}
              <SelectSeparator />
              <SelectItem value={NEW_CAT}>+ New category…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Paid from{oneTime && <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>
          <Select value={accountId} onValueChange={(v) => { touchedAccount.current = true; setAccountId(v); }}>
            <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
            <SelectContent>
              {oneTime && (
                <>
                  <SelectItem value={NO_ACCOUNT}>Not specified</SelectItem>
                  {accounts.length > 0 && <SelectSeparator />}
                </>
              )}
              {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} <span className="text-muted-foreground">· {formatMoney(a.currentBalance, a.currency)}</span></SelectItem>)}
            </SelectContent>
          </Select>
          {noAccount && (
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="mt-2 h-9 w-full text-xs" aria-label="Currency"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} · {c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {categoryId === NEW_CAT && (
        <div className="flex gap-2">
          <Input autoFocus value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Category name, like Pets" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), createCategory())} />
          <Button type="button" variant="outline" onClick={createCategory}>Create</Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="x-date">Date</Label>
          <div className="flex items-center gap-1.5">
            {[["Today", today], ["Yesterday", yesterday]].map(([l, v]) => (
              <button key={l} type="button" onClick={() => setDate(v)} className={cn("h-9 cursor-pointer rounded-lg border px-3 text-xs transition-colors", date === v ? "border-foreground/40 bg-card font-medium" : "border-border text-muted-foreground hover:text-foreground")}>
                {l}
              </button>
            ))}
            <Input id="x-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="w-[150px]" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="x-desc">{oneTime ? "What was it?" : "Note"}</Label>
          <Input id="x-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={oneTime ? "Sofa, flights, deposit…" : "What was it? (optional)"} />
        </div>
      </div>

      {oneTime && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Group <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>No group</SelectItem>
                {projects.filter((p) => !p.archivedAt || p.id === projectId).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                <SelectSeparator />
                <SelectItem value={NEW_GROUP}>+ New group…</SelectItem>
              </SelectContent>
            </Select>
            {projectId === NEW_GROUP && (
              <div className="flex gap-2 pt-1">
                <Input autoFocus value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Like Liverpool move" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), createGroup())} />
                <Button type="button" variant="outline" onClick={createGroup}>Create</Button>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="x-notes">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="x-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Order number, warranty, who it was for" />
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5 accent-[var(--brass)]" checked={countInBudget} onChange={(e) => setCountInBudget(e.target.checked)} />
            <span>
              Count toward the {monthLabel(month)} budget
              <span className="block text-xs text-muted-foreground">Off by default, so one-offs leave your monthly budget alone.</span>
            </span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="min-h-5 text-xs text-muted-foreground">
          {oneTime && !countInBudget ? (
            <span>{noAccount ? "No account picked, so no balance changes." : "Paid from your balance."} Not counted in the {monthLabel(month, "short")} budget.</span>
          ) : categoryId && categoryId !== NEW_CAT && (
            budget === null ? <span>Checking {monthLabel(month, "short")} budget…</span>
            : line ? (
              <span>
                {catName} in {monthLabel(month)}:{" "}
                <span className={cn("tabular-nums", line.budgetAmount - line.spent - (amt || 0) < 0 ? "text-negative" : "text-foreground")}>
                  {formatMoney(Math.max(line.budgetAmount - line.spent, 0), budget.currency)} left of {formatMoney(line.budgetAmount, budget.currency)}
                </span>
                {amt > 0 && line.budgetAmount - line.spent - amt < 0 && ". This takes it over budget."}
              </span>
            ) : (
              <span>No budget for {catName} in {monthLabel(month)}{date > today ? " · future-dated: it will count when that month comes" : ""}.</span>
            )
          )}
          {overdraw && <span className="ml-2 text-warning">More than {account!.name}&apos;s balance.</span>}
        </div>
        <div className="flex gap-2">
          {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
          <Button type="submit" disabled={busy || !(amt > 0) || !categoryId || categoryId === NEW_CAT || !accountId || groupPending}>
            {busy ? "Saving…" : editing ? "Save correction" : oneTime ? "Log purchase" : "Log expense"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** One-off purchases (a sofa, a move, a laptop): they come out of your
 * accounts like any expense but stay off monthly budgets unless opted in,
 * and can be grouped by occasion. */
function OneTimeView({
  accounts,
  categories,
  onCategoryCreated,
  onBalancesChanged,
}: {
  accounts: Account[];
  categories: Category[];
  onCategoryCreated: (c: Category) => void;
  onBalancesChanged: () => void;
}) {
  const [items, setItems] = useState<Expense[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [baseCurrency, setBaseCurrency] = useState("GBP");
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<string>("ALL");
  const [composer, setComposer] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [removing, setRemoving] = useState<Expense | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [x, p] = await Promise.all([
        api<{ expenses: Expense[] }>("/api/expenses?kind=one_time&includeVoided=1"),
        api<{ projects: Project[]; currency: string }>("/api/expense-projects?includeArchived=1"),
      ]);
      setItems(x.expenses);
      setProjects(p.projects);
      setBaseCurrency(p.currency);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    load();
    onBalancesChanged();
  };
  const visible = (items ?? []).filter((e) => (showRemoved || !e.voidedAt) && (group === "ALL" || (group === NO_GROUP ? !e.project : e.project?.id === group)));
  const liveTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of visible) if (!e.voidedAt) m.set(e.currency, (m.get(e.currency) ?? 0) + Number(e.amount));
    return [...m.entries()];
  }, [visible]);
  const activeProjects = projects.filter((p) => !p.archivedAt);
  const archivedProjects = projects.filter((p) => p.archivedAt);

  async function remove(e: Expense, reason?: string) {
    try {
      await api(`/api/expenses/${e.id}`, { method: "DELETE", body: { reason } });
      toast.success(e.account ? `Removed. ${formatMoney(e.amount, e.currency)} is back in ${e.account.name}.` : "Removed.");
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }
  async function patchProject(p: Project, body: Record<string, unknown>, done: string) {
    try {
      await api(`/api/expense-projects/${p.id}`, { method: "PATCH", body });
      toast.success(done);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }
  async function deleteProject(p: Project) {
    try {
      await api(`/api/expense-projects/${p.id}`, { method: "DELETE" });
      toast.success(`Deleted ${p.name}.`);
      if (group === p.id) setGroup("ALL");
      load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const groupTotal = (p: Project) =>
    p.byCurrency.length === 0 ? (
      <span className="text-muted-foreground">Nothing yet</span>
    ) : p.byCurrency.length === 1 ? (
      <Money value={p.byCurrency[0].amount} currency={p.byCurrency[0].currency} equivalent="below" />
    ) : p.total != null ? (
      <>≈ {formatMoney(p.total, baseCurrency)}</>
    ) : (
      p.byCurrency.map((b) => formatMoney(b.amount, b.currency)).join(" + ")
    );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-muted-foreground">
          For the big or unusual stuff: moving house, a new laptop, a wedding gift. Say which account paid and it comes off that balance; leave it blank and it&apos;s simply recorded. Either way, your monthly budget stays about your monthly life.
        </p>
        <Button onClick={() => setComposer((c) => !c)} variant={composer ? "outline" : "default"}>{composer ? "Close" : <><Plus /> Log one-time purchase</>}</Button>
      </div>
      {error && <ErrorState message={error} onRetry={load} />}

      {composer && (
        <Panel className="settle">
          <ExpenseForm
            oneTime
            accounts={accounts}
            categories={categories}
            projects={projects}
            defaultProjectId={group !== "ALL" && group !== NO_GROUP ? group : null}
            onProjectCreated={(p) => setProjects((ps) => [p, ...ps])}
            onSaved={refresh}
            onCategoryCreated={onCategoryCreated}
          />
        </Panel>
      )}

      {activeProjects.length > 0 && (
        <Section title="Groups" description="Related purchases added up, so you know what the whole thing really cost.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {activeProjects.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "group/card relative rounded-xl border bg-card p-4 text-left shadow-card transition-colors",
                  group === p.id ? "border-foreground/40" : "border-border hover:border-foreground/20"
                )}
              >
                <button type="button" className="absolute inset-0 cursor-pointer rounded-xl" aria-label={`Show purchases in ${p.name}`} onClick={() => setGroup(group === p.id ? "ALL" : p.id)} />
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-medium">{p.name}</p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="relative -mt-1 -mr-1" aria-label={`${p.name} actions`}><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => { setRenaming(p); setNewName(p.name); }}>Rename…</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => patchProject(p, { archived: true }, `${p.name} archived. Its purchases stay where they are.`)}>Archive</DropdownMenuItem>
                      {p.count === 0 && <DropdownMenuItem variant="destructive" onClick={() => deleteProject(p)}>Delete</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <p className="mt-3 text-xl font-semibold tabular-nums tracking-tight">{groupTotal(p)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.count} {p.count === 1 ? "purchase" : "purchases"}
                  {p.lastDate && ` · last ${formatDate(p.lastDate, { day: "numeric", month: "short", year: "numeric" })}`}
                </p>
              </div>
            ))}
          </div>
          {archivedProjects.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Archived:{" "}
              {archivedProjects.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <button className="cursor-pointer underline-offset-4 hover:text-foreground hover:underline" onClick={() => patchProject(p, { archived: false }, `${p.name} is back.`)}>{p.name}</button>
                </span>
              ))}
              . Click one to bring it back.
            </p>
          )}
        </Section>
      )}

      <Section
        title="Purchases"
        description={group === "ALL" ? "Every one-time purchase, newest first." : group === NO_GROUP ? "Purchases that aren't in a group." : `Purchases in ${projects.find((p) => p.id === group)?.name ?? "this group"}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All purchases</SelectItem>
                <SelectItem value={NO_GROUP}>Not in a group</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.archivedAt ? " (archived)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" className="accent-[var(--brass)]" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
              Show removed
            </label>
          </div>
        }
      >
        <Panel padded={false}>
          {items === null ? (
            <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-10" />)}</div>
          ) : visible.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<ShoppingBag className="h-5 w-5" />} title={group === "ALL" ? "No one-time purchases yet" : "Nothing in here yet"} action={!composer ? <Button size="sm" variant="outline" onClick={() => setComposer(true)}>Log a purchase</Button> : undefined}>
                Bought something that isn&apos;t part of a normal month? Log it here and your budget won&apos;t flinch.
              </EmptyState>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border/70">
                {visible.map((e) => (
                  <li key={e.id} className={cn("flex items-center gap-3 px-5 py-3", e.voidedAt && "opacity-60")}>
                    <div className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDate(e.date, { day: "numeric", month: "short" })}<span className="block text-[10px]">{e.date.slice(0, 4)}</span></div>
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm", e.voidedAt && "line-through")}>{e.description || e.category.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {e.project && <span className="text-foreground/80">{e.project.name} · </span>}
                        {e.description ? `${e.category.name} · ` : ""}{e.account?.name ?? "No account"}
                        {e.notes && ` · ${e.notes}`}
                        {e.voidReason && ` · removed: ${e.voidReason}`}
                      </p>
                    </div>
                    {e.countInBudget && !e.voidedAt && <StatusBadge tone="info">In budget</StatusBadge>}
                    {e.voidedAt && <StatusBadge tone="neutral">Removed</StatusBadge>}
                    <Money value={-Number(e.amount)} currency={e.currency} signed tone={e.voidedAt ? "muted" : "plain"} className="text-sm font-medium" />
                    <div className="w-8">
                      {!e.voidedAt && e.account?.status !== "CLOSED" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Purchase actions"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditing(e)}>Edit…</DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setRemoving(e)}>Remove…</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {liveTotals.length > 0 && (
                <div className="flex justify-between gap-3 border-t border-border bg-muted/40 px-5 py-2.5 text-sm">
                  <span className="text-muted-foreground">Total shown</span>
                  <span className="font-medium tabular-nums">{liveTotals.map(([cur, v]) => formatMoney(v, cur)).join(" + ")}</span>
                </div>
              )}
            </>
          )}
        </Panel>
      </Section>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit purchase</DialogTitle>
            <DialogDescription>Saving books a correction: the original is reversed on the statement and the corrected purchase is recorded.</DialogDescription>
          </DialogHeader>
          {editing && (
            <ExpenseForm
              oneTime
              accounts={accounts}
              categories={categories}
              projects={projects}
              initial={editing}
              onProjectCreated={(p) => setProjects((ps) => [p, ...ps])}
              onSaved={() => { setEditing(null); refresh(); }}
              onCancel={() => setEditing(null)}
              onCategoryCreated={onCategoryCreated}
            />
          )}
          <DialogFooter className="hidden" />
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename group</DialogTitle>
            <DialogDescription>Purchases in it move along with it.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              if (renaming && newName.trim()) patchProject(renaming, { name: newName.trim() }, "Renamed.").then(() => setRenaming(null));
            }}
            className="space-y-4"
          >
            <Input autoFocus value={newName} onChange={(ev) => setNewName(ev.target.value)} aria-label="Group name" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
              <Button type="submit" disabled={!newName.trim()}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmAction
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this purchase?"
        withReason="Reason"
        description={
          removing && (
            <>
              <p>
                {removing.description || removing.category.name} · {formatMoney(removing.amount, removing.currency)} on {formatDate(removing.date)}.{removing.account ? <> The amount goes back to <b className="text-foreground">{removing.account.name}</b>.</> : null}
              </p>
              <p>The entry stays on the statement, struck through, with a reversal next to it.</p>
            </>
          )
        }
        confirmLabel="Remove purchase"
        onConfirm={(reason) => remove(removing!, reason)}
      />
    </div>
  );
}

export default function ExpensesPage() {
  const search = useSearchParams();
  const router = useRouter();
  const tab = search.get("tab") === "one-time" ? "one_time" : "monthly";
  const [month, setMonth] = useState(localMonth());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState("ALL");
  const [filterAcct, setFilterAcct] = useState("ALL");
  const [sort, setSort] = useState<"newest" | "oldest" | "largest" | "smallest">("newest");
  const [textFilter, setTextFilter] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);
  const [composer, setComposer] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [removing, setRemoving] = useState<Expense | null>(null);

  useEffect(() => {
    if (search.get("new") === "1") setComposer(true);
  }, [search]);

  const loadRefs = useCallback(async () => {
    const [a, c] = await Promise.all([api<{ accounts: Account[] }>("/api/accounts"), api<{ categories: Category[] }>("/api/categories")]);
    setAccounts(a.accounts.filter((x) => x.status !== "CLOSED"));
    setCategories(c.categories);
  }, []);
  const loadList = useCallback(async () => {
    setError(null);
    try {
      const d = await api<{ expenses: Expense[] }>(`/api/expenses?month=${month}&kind=monthly&includeVoided=1`);
      setExpenses(d.expenses);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month]);
  useEffect(() => {
    loadRefs().catch((e) => setError(e.message));
  }, [loadRefs]);
  useEffect(() => {
    setExpenses(null);
    loadList();
  }, [loadList]);

  const live = useMemo(() => (expenses ?? []).filter((e) => !e.voidedAt), [expenses]);
  const visible = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    const list = (expenses ?? []).filter(
      (e) =>
        (showRemoved || !e.voidedAt) &&
        (filterCat === "ALL" || e.category.id === filterCat) &&
        (filterAcct === "ALL" || e.account?.id === filterAcct) &&
        (!q || `${e.description ?? ""} ${e.category.name} ${e.account?.name ?? ""}`.toLowerCase().includes(q))
    );
    const amt = (e: Expense) => Number(e.amount);
    if (sort === "oldest") list.sort((a, b) => a.date.localeCompare(b.date));
    if (sort === "largest") list.sort((a, b) => amt(b) - amt(a));
    if (sort === "smallest") list.sort((a, b) => amt(a) - amt(b));
    return list;
  }, [expenses, showRemoved, filterCat, filterAcct, textFilter, sort]);
  const byDay = useMemo(() => {
    // Grouped by day when sorted by date; a flat list when sorted by amount.
    if (sort === "largest" || sort === "smallest") return [["", visible] as [string, Expense[]]];
    const m = new Map<string, Expense[]>();
    for (const e of visible) {
      const d = e.date.slice(0, 10);
      m.set(d, [...(m.get(d) ?? []), e]);
    }
    return [...m.entries()];
  }, [visible, sort]);
  const usedCats = useMemo(() => {
    const ids = new Set((expenses ?? []).map((e) => e.category.id));
    return categories.filter((c) => ids.has(c.id));
  }, [expenses, categories]);
  // Totals stay per currency — a USD forex-card spend is never added to rupees.
  const totals = useMemo(() => {
    const byCur = new Map<string, number>();
    const byCat = new Map<string, { name: string; cur: string; v: number }>();
    for (const e of live) {
      byCur.set(e.currency, (byCur.get(e.currency) ?? 0) + Number(e.amount));
      const k = `${e.category.name}|${e.currency}`;
      const c = byCat.get(k) ?? { name: e.category.name, cur: e.currency, v: 0 };
      c.v += Number(e.amount);
      byCat.set(k, c);
    }
    return { byCur: [...byCur.entries()].sort((a, b) => b[1] - a[1]), top: [...byCat.values()].sort((a, b) => b.v - a.v).slice(0, 5) };
  }, [live]);

  async function remove(e: Expense, reason?: string) {
    try {
      await api(`/api/expenses/${e.id}`, { method: "DELETE", body: { reason } });
      toast.success(e.account ? `Removed. ${formatMoney(e.amount, e.currency)} is back in ${e.account.name}.` : "Removed.");
      loadList();
      loadRefs();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const refreshAll = () => {
    loadList();
    loadRefs();
  };

  const tabs = (
    <div className="settle -mt-2 flex gap-1 border-b border-border" role="tablist">
      {(["monthly", "one_time"] as const).map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={tab === t}
          onClick={() => router.replace(t === "monthly" ? "/expenses" : "/expenses?tab=one-time", { scroll: false })}
          className={cn("relative -mb-px h-10 cursor-pointer px-3 text-sm transition-colors", tab === t ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {t === "monthly" ? "Monthly" : "One-time"}
          {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brass" />}
        </button>
      ))}
    </div>
  );

  if (tab === "one_time") {
    return (
      <div className="space-y-8">
        <PageHeader title="Expenses" description="One-off purchases, kept apart from your monthly budget." />
        {tabs}
        <OneTimeView accounts={accounts} categories={categories} onCategoryCreated={(c) => setCategories((cs) => [...cs, c])} onBalancesChanged={() => loadRefs()} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Expenses"
        description="Log what you spend, on any date. Each expense counts toward the budget for its own month."
        actions={<Button onClick={() => setComposer((c) => !c)} variant={composer ? "outline" : "default"}>{composer ? "Close" : <><Plus /> Log expense</>}</Button>}
      />
      {tabs}
      {error && <ErrorState message={error} onRetry={refreshAll} />}

      {composer && (
        <Panel className="settle">
          {accounts.length === 0 ? (
            <EmptyState title="Add an account first">Expenses are paid from an account, card or wallet.</EmptyState>
          ) : (
            <ExpenseForm accounts={accounts} categories={categories} defaultCategoryId={search.get("category") ?? undefined} onSaved={refreshAll} onCategoryCreated={(c) => setCategories((cs) => [...cs, c])} />
          )}
        </Panel>
      )}

      <Section
        title="Logged"
        description={`Everything dated in ${monthLabel(month)}`}
        actions={<MonthSwitcher month={month} onChange={setMonth} />}
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={textFilter} onChange={(e) => setTextFilter(e.target.value)} placeholder="Search" aria-label="Search expenses" className="w-40 pl-8" />
              </div>
              <Select value={filterCat} onValueChange={setFilterCat}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All categories</SelectItem>
                  {usedCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterAcct} onValueChange={setFilterAcct}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All accounts</SelectItem>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="largest">Largest first</SelectItem>
                  <SelectItem value="smallest">Smallest first</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" className="accent-[var(--brass)]" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
                Show removed
              </label>
            </div>
            <Panel padded={false}>
              {expenses === null ? (
                <div className="space-y-2 p-5">{[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-10" />)}</div>
              ) : byDay.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={<Receipt className="h-5 w-5" />} title={`Nothing logged in ${monthLabel(month)}`} action={!composer ? <Button size="sm" variant="outline" onClick={() => setComposer(true)}>Log an expense</Button> : undefined}>
                    You can still log something for this month. Just pick its date in the form.
                  </EmptyState>
                </div>
              ) : (
                byDay.map(([day, items]) => (
                  <div key={day}>
                    {day && <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-1.5 text-[11px] font-medium text-muted-foreground">
                      <span>{relDay(day)}</span>
                      <span className="tabular-nums">{formatMoney(items.filter((e) => !e.voidedAt).reduce((s, e) => s + Number(e.amount), 0), items[0].currency)}</span>
                    </div>}
                    <ul className="divide-y divide-border/70">
                      {items.map((e) => (
                        <li key={e.id} className={cn("flex items-center gap-3 px-5 py-3", e.voidedAt && "opacity-60")}>
                          <div className="min-w-0 flex-1">
                            <p className={cn("truncate text-sm", e.voidedAt && "line-through")}>{e.description || e.category.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {!day && `${formatDate(e.date, { day: "numeric", month: "short" })} · `}
                              {e.description ? `${e.category.name} · ` : ""}{e.account?.name ?? "No account"}
                              {e.voidReason && ` · removed: ${e.voidReason}`}
                            </p>
                          </div>
                          {e.voidedAt && <StatusBadge tone="neutral">Removed</StatusBadge>}
                          <Money value={-Number(e.amount)} currency={e.currency} signed tone={e.voidedAt ? "muted" : "plain"} className="text-sm font-medium" />
                          <div className="w-8">
                            {!e.voidedAt && e.account?.status !== "CLOSED" && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon-sm" aria-label="Expense actions"><MoreHorizontal className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setEditing(e)}>Edit…</DropdownMenuItem>
                                  <DropdownMenuItem variant="destructive" onClick={() => setRemoving(e)}>Remove…</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </Panel>
          </div>

          <aside className="space-y-4">
            <Panel>
              <p className="eyebrow">Spent in {monthLabel(month, "short")}</p>
              {totals.byCur.length === 0 ? (
                <p className="mt-1.5 text-xl font-semibold tabular-nums">–</p>
              ) : (
                totals.byCur.map(([cur, v]) => <p key={cur} className="mt-1.5 text-xl font-semibold tabular-nums">{formatMoney(v, cur)}</p>)
              )}
              <p className="mt-1 text-xs text-muted-foreground">{live.length} {live.length === 1 ? "expense" : "expenses"}. One-time purchases are on their own tab.</p>
              {totals.top.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-border pt-4 text-xs">
                  {totals.top.map((t) => (
                    <li key={`${t.name}|${t.cur}`} className="flex justify-between gap-2"><span className="truncate text-muted-foreground">{t.name}</span><span className="tabular-nums">{formatMoney(t.v, t.cur)}</span></li>
                  ))}
                </ul>
              )}
            </Panel>
          </aside>
        </div>
      </Section>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit expense</DialogTitle>
            <DialogDescription>Saving books a correction: the original is reversed on the statement and the corrected expense is recorded.</DialogDescription>
          </DialogHeader>
          {editing && (
            <ExpenseForm
              accounts={accounts}
              categories={categories}
              initial={editing}
              onSaved={() => { setEditing(null); refreshAll(); }}
              onCancel={() => setEditing(null)}
              onCategoryCreated={(c) => setCategories((cs) => [...cs, c])}
            />
          )}
          <DialogFooter className="hidden" />
        </DialogContent>
      </Dialog>

      <ConfirmAction
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this expense?"
        withReason="Reason"
        description={
          removing && (
            <>
              <p>
                {removing.description || removing.category.name} · {formatMoney(removing.amount, removing.currency)} on {formatDate(removing.date)}. The amount goes back to{" "}
                <b className="text-foreground">{removing.account?.name}</b> and stops counting toward the {removing.category.name} budget.
              </p>
              <p>The entry stays on the statement, struck through, with a reversal next to it.</p>
            </>
          )
        }
        confirmLabel="Remove expense"
        onConfirm={(reason) => remove(removing!, reason)}
      />
    </div>
  );
}
