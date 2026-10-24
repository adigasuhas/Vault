"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, localToday } from "@/lib/client";
import { formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { useCurrency } from "@/context/CurrencyContext";
import { defaultStartDate, isoDate, type Frequency } from "@/lib/dates";
import { nominalsFrom, overrideDateProblem, overridesKeptOnReanchor, isNominalOf } from "@/lib/recurrence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FxTicker } from "@/components/app/FxTicker";
import { ErrorState, SkeletonBlock } from "@/components/app/PageHeader";
import { StatusBadge, occurrenceStatus } from "@/components/app/StatusBadge";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export const KINDS = {
  INCOME: [
    { v: "STIPEND", l: "Stipend or grant" },
    { v: "SALARY", l: "Salary" },
    { v: "REFUND", l: "Refund / reimbursement" },
    { v: "POCKET_MONEY", l: "Pocket money" },
    { v: "OTHER_INCOME", l: "Other income" },
  ],
  PAYMENT: [
    { v: "RENT", l: "Rent" },
    { v: "EMI", l: "Loan EMI" },
    { v: "SUBSCRIPTION", l: "Subscription" },
    { v: "INSURANCE", l: "Insurance" },
    { v: "FEES", l: "Fees" },
    { v: "UTILITIES", l: "Utilities" },
    { v: "OTHER_PAYMENT", l: "Other payment" },
  ],
} as const;

export const FREQUENCIES: { v: Frequency; l: string }[] = [
  { v: "ONE_TIME", l: "Once" },
  { v: "WEEKLY", l: "Weekly" },
  { v: "MONTHLY", l: "Monthly" },
  { v: "QUARTERLY", l: "Quarterly" },
  { v: "HALF_YEARLY", l: "Half-yearly" },
  { v: "YEARLY", l: "Yearly" },
  { v: "CUSTOM", l: "Every N days" },
];

export const frequencyLabel = (f: string, n?: number | null) =>
  f === "CUSTOM" ? `Every ${n ?? 30} days` : FREQUENCIES.find((x) => x.v === f)?.l ?? f;

/** Category name a payment kind most likely books under. */
const KIND_CATEGORY: Record<string, RegExp> = {
  RENT: /rent|housing/i,
  SUBSCRIPTION: /subscri/i,
  INSURANCE: /insur/i,
  FEES: /fee|tuition/i,
  UTILITIES: /utilit|internet|electric/i,
};

interface Account { id: string; name: string; currency: string; status: string; currentBalance: string }
interface Category { id: string; name: string }

export interface ScheduleFormValue {
  id?: string;
  kind: string;
  name: string;
  amount: number;
  /** The amount's currency; may differ from the account's (converted when booked). */
  currency?: string;
  accountId: string | null;
  categoryId: string | null;
  frequency: Frequency;
  customIntervalDays: number | null;
  startDate: string; // next occurrence in edit mode
  endDate: string | null;
  requiresConfirmation: boolean;
  notes: string | null;
}

/** What's saved for a schedule being edited, loaded fresh from the server so
 * the editor never starts from a stale list or a recalculated guess. */
interface SavedSchedule {
  /** The rule's real anchor (its day of the month survives short months). */
  anchor: string;
  next: string;
  overrides: { occurrenceDate: string; date: string | null; amount: number | null }[];
  executions: { occurrenceDate: string | null; executedDate: string; amount: number; status: string }[];
}

interface ScheduleDetail {
  schedule: {
    id: string; kind: string; name: string; amount: number; currency: string; receivingAccountId: string | null; categoryId: string | null;
    frequency: Frequency; customIntervalDays: number | null; startDate: string; nextExecutionDate: string; endDate: string | null;
    requiresConfirmation: boolean; notes: string | null;
  };
  overrides: { occurrenceDate: string; date: string | null; amount: number | null }[];
  executions: { occurrenceDate: string | null; executedDate: string; amount: number; status: string }[];
}

const day = (s: string) => s.slice(0, 10);
const asDate = (s: string) => new Date(`${day(s)}T00:00:00.000Z`);
const nice = (s: string) => formatDate(s, { day: "numeric", month: "short", year: "numeric" });

/** The API's schedule detail as the form's starting values plus what's saved. */
function toDetail(d: ScheduleDetail): { initial: ScheduleFormValue; saved: SavedSchedule } {
  const s = d.schedule;
  return {
    initial: {
      id: s.id,
      kind: s.kind,
      name: s.name,
      amount: s.amount,
      currency: s.currency,
      accountId: s.receivingAccountId,
      categoryId: s.categoryId,
      frequency: s.frequency,
      customIntervalDays: s.customIntervalDays,
      startDate: day(s.nextExecutionDate),
      endDate: s.endDate ? day(s.endDate) : null,
      requiresConfirmation: s.requiresConfirmation,
      notes: s.notes,
    },
    saved: {
      anchor: day(s.startDate),
      next: day(s.nextExecutionDate),
      overrides: d.overrides.map((o) => ({ occurrenceDate: day(o.occurrenceDate), date: o.date ? day(o.date) : null, amount: o.amount })),
      executions: d.executions.map((x) => ({ ...x, occurrenceDate: x.occurrenceDate ? day(x.occurrenceDate) : null, executedDate: day(x.executedDate) })),
    },
  };
}

const PREVIEW_COUNT: Record<Frequency, number> = { ONE_TIME: 1, WEEKLY: 4, MONTHLY: 6, QUARTERLY: 4, HALF_YEARLY: 4, YEARLY: 3, CUSTOM: 4 };

type FormProps = {
  direction: "INCOME" | "PAYMENT";
  accounts: Account[];
  categories: Category[];
  initial?: ScheduleFormValue | null;
  onSaved: () => void;
  onCancel: () => void;
  onCategoryCreated?: (c: Category) => void;
};

/** Create or edit a schedule. Editing loads the saved schedule first. */
export function ScheduleForm(props: FormProps) {
  const id = props.initial?.id;
  const [detail, setDetail] = useState<{ initial: ScheduleFormValue; saved: SavedSchedule } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bumped by "Try again" to refetch.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id) return;
    let live = true;
    api<ScheduleDetail>(`/api/schedules/${id}`)
      .then((d) => live && setDetail(toDetail(d)))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [id, attempt]);
  const retry = () => {
    setError(null);
    setAttempt((a) => a + 1);
  };

  if (!id) return <ScheduleFormFields {...props} initial={props.initial ?? null} saved={null} />;
  if (error) return <ErrorState message={`We couldn't load this schedule. ${error}`} onRetry={retry} />;
  if (!detail) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading schedule">
        <SkeletonBlock className="h-8 w-2/3" />
        <SkeletonBlock className="h-10" />
        <SkeletonBlock className="h-10" />
        <SkeletonBlock className="h-40" />
      </div>
    );
  }
  return <ScheduleFormFields {...props} initial={detail.initial} saved={detail.saved} />;
}

/** One hand edit in the Upcoming dates list. A key present means the user
 * touched it: `date` is the date they expect it on, `amount` "" resets it. */
type Draft = { date?: string; amount?: string };

function ScheduleFormFields({
  direction,
  accounts,
  categories,
  initial,
  saved,
  onSaved,
  onCancel,
  onCategoryCreated,
}: Omit<FormProps, "initial"> & { initial: ScheduleFormValue | null; saved: SavedSchedule | null }) {
  const editing = !!initial?.id && !!saved;
  const today = localToday();
  const [kind, setKind] = useState(initial?.kind ?? KINDS[direction][0].v);
  const [name, setName] = useState(initial?.name ?? "");
  const [nameTouched, setNameTouched] = useState(!!initial);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  // "" = decide later (payments only): each one is paid from that month's
  // budget-line account, or picked when it's confirmed.
  const [accountId, setAccountId] = useState(initial ? (initial.accountId ?? "") : direction === "PAYMENT" ? "" : (accounts[0]?.id ?? ""));
  // "EACH": the amount is per payment. "TOTAL": split across every payment
  // between the first date and the end date (the default once there's an end).
  const [amountMode, setAmountMode] = useState<"EACH" | "TOTAL">("EACH");
  const [modeTouched, setModeTouched] = useState(!!initial);
  // "" follows the account's currency.
  const [currency, setCurrency] = useState(initial?.currency ?? "");
  const fx = useCurrency();
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? "MONTHLY");
  const [customDays, setCustomDays] = useState(String(initial?.customIntervalDays ?? 30));
  const [startDate, setStartDate] = useState(initial?.startDate ?? isoDate(defaultStartDate("MONTHLY", new Date(today))));
  const [startTouched, setStartTouched] = useState(!!initial);
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [confirmEach, setConfirmEach] = useState(initial?.requiresConfirmation ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // Hand edits, keyed by nominal date. Kept across pattern changes: an edit
  // the new pattern doesn't have is set aside (and listed), not thrown away,
  // so switching back brings it back.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newCat, setNewCat] = useState("");
  const [busy, setBusy] = useState(false);

  // Sensible first date for the chosen frequency, until the user picks one.
  useEffect(() => {
    if (!startTouched) setStartDate(isoDate(defaultStartDate(frequency, new Date(today))));
  }, [frequency, startTouched, today]);
  useEffect(() => {
    if (!nameTouched) setName(KINDS[direction].find((k) => k.v === kind)?.l.split(" /")[0] ?? "");
  }, [kind, direction, nameTouched]);
  useEffect(() => {
    if (direction !== "PAYMENT" || categoryId) return;
    const re = KIND_CATEGORY[kind];
    const match = re && categories.find((c) => re.test(c.name));
    if (match) setCategoryId(match.id);
  }, [kind, direction, categories, categoryId]);

  const account = accounts.find((a) => a.id === accountId);
  const amt = Number(amount);
  const cur = currency || account?.currency || fx.primary;
  const currencyChoices = [...new Set([account?.currency, fx.primary, fx.secondary, cur].filter((c): c is string => !!c))];
  // Today's rate from the amount's currency into the account's.
  const crossRate = account && cur !== account.currency && fx.toPrimary[cur] != null && (account.currency === fx.primary || fx.toPrimary[account.currency])
    ? (fx.toPrimary[cur] as number) / (account.currency === fx.primary ? 1 : (fx.toPrimary[account.currency] as number))
    : null;
  const days = Number(customDays) || 30;

  // Editing re-anchors the pattern only when its shape changes; otherwise the
  // saved anchor (and its moved dates) stay exactly as they are.
  const patternChanged =
    editing &&
    (startDate !== initial!.startDate || frequency !== initial!.frequency || (frequency === "CUSTOM" && days !== initial!.customIntervalDays));
  const keepsSavedPattern = editing && !patternChanged;

  const rule = useMemo(
    () =>
      keepsSavedPattern
        ? { startDate: asDate(saved!.anchor), frequency: initial!.frequency, customIntervalDays: initial!.customIntervalDays, endDate: endDate ? asDate(endDate) : null }
        : { startDate: asDate(startDate || today), frequency, customIntervalDays: days, endDate: endDate ? asDate(endDate) : null },
    [keepsSavedPattern, saved, initial, startDate, today, frequency, days, endDate]
  );

  // What's saved for each nominal date once this form is saved, before any
  // hand edits here: the saved overrides that survive a pattern change.
  const { baseline, droppedSaved } = useMemo(() => {
    const out = new Map<string, { date: string | null; amount: number | null }>();
    if (!saved) return { baseline: out, droppedSaved: [] as SavedSchedule["overrides"] };
    const all = saved.overrides.map((o) => ({ ...o, occurrenceDate: asDate(o.occurrenceDate), date: o.date ? asDate(o.date) : null, src: o }));
    const { kept, dropped } = patternChanged ? overridesKeptOnReanchor(rule, all, asDate(today)) : { kept: all, dropped: [] };
    for (const o of kept) out.set(o.src.occurrenceDate, { date: o.src.date, amount: o.src.amount });
    return { baseline: out, droppedSaved: dropped.map((o) => o.src) };
  }, [saved, patternChanged, rule, today]);

  // Stored occurrences ahead of the next date: skipped ahead of time. After a
  // pattern change only those the new pattern still has remain.
  const stored = useMemo(() => {
    const m = new Map<string, SavedSchedule["executions"][number]>();
    for (const x of saved?.executions ?? []) {
      if (!x.occurrenceDate) continue;
      if (patternChanged && !isNominalOf(rule, asDate(x.occurrenceDate))) continue;
      m.set(x.occurrenceDate, x);
    }
    return m;
  }, [saved, patternChanged, rule]);

  // Every nominal date up to the end (capped), or the next few when open-ended.
  const nominals = useMemo(() => {
    if (!startDate) return [];
    const from = keepsSavedPattern ? asDate(saved!.next) : asDate(startDate);
    return nominalsFrom(rule, from, endDate ? 120 : PREVIEW_COUNT[frequency]).map(isoDate);
  }, [rule, keepsSavedPattern, saved, startDate, endDate, frequency]);

  useEffect(() => {
    if (!modeTouched) setAmountMode(endDate && frequency !== "ONE_TIME" ? "TOTAL" : "EACH");
  }, [endDate, frequency, modeTouched]);
  // A total is split evenly; the last payment absorbs the rounding.
  const splitting = amountMode === "TOTAL" && !editing && frequency !== "ONE_TIME" && !!endDate && nominals.length > 0;
  const each = splitting ? Math.floor((amt / nominals.length) * 100) / 100 : amt;
  const lastAmount = splitting ? Math.round((amt - each * (nominals.length - 1)) * 100) / 100 : amt;
  const defaultFor = (i: number) => (splitting && i === nominals.length - 1 ? lastAmount : each);

  /** One row of Upcoming dates: what's saved, what's been typed, and what
   * will be saved. Untouched rows keep their saved values exactly. */
  const rows = nominals.map((key, i) => {
    const base = baseline.get(key);
    const draft = drafts[key];
    const regular = defaultFor(i);
    const finalDate = draft?.date !== undefined ? (draft.date && draft.date !== key ? draft.date : null) : (base?.date ?? null);
    const typedAmount = draft?.amount !== undefined && draft.amount !== "" ? Number(draft.amount) : null;
    const finalAmount =
      draft?.amount !== undefined ? (typedAmount != null && Math.abs(typedAmount - regular) > 0.004 ? typedAmount : null) : (base?.amount ?? null);
    const changed = finalDate !== (base?.date ?? null) || finalAmount !== (base?.amount ?? null);
    const x = stored.get(key);
    const problem =
      x ? null
      : draft?.date === "" ? "Pick a date"
      : finalDate ? overrideDateProblem(rule, asDate(key), asDate(finalDate))?.replace(/\d{4}-\d{2}-\d{2}/g, nice) ?? null
      : typedAmount != null && !(typedAmount > 0) ? "Amount must be more than zero"
      : null;
    return { key, regular, date: draft?.date ?? finalDate ?? key, amountShown: finalAmount ?? regular, finalDate, finalAmount, changed, stored: x, problem };
  });
  const plannedTotal = rows.reduce((t, r) => t + (r.stored?.status === "SKIPPED" ? 0 : r.amountShown), 0);
  // Edits typed for dates the current pattern doesn't produce.
  const setAside = Object.entries(drafts).filter(([k, d]) => !nominals.includes(k) && (d.date !== undefined || d.amount !== undefined) && !(d.date === k && !d.amount));
  const rowProblems = rows.filter((r) => r.problem);

  const setDraft = (key: string, patch: Draft) => setDrafts((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  // Back to the regular date and amount (clears a saved change on save).
  const resetRow = (key: string) => setDrafts((s) => ({ ...s, [key]: { date: key, amount: "" } }));

  async function createCategory() {
    if (!newCat.trim()) return;
    try {
      const r = await api<{ category: Category }>("/api/categories", { body: { name: newCat.trim() } });
      onCategoryCreated?.(r.category);
      setCategoryId(r.category.id);
      setNewCat("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // Everything that stops a save, in the order it appears on the form.
  const problems = [
    !name.trim() && "Give it a name.",
    !(amt > 0) && "Enter an amount above zero.",
    !accountId && direction === "INCOME" && "Choose the account it's credited to.",
    direction === "PAYMENT" && (!categoryId || categoryId === "__new__") && "Choose a budget category.",
    !startDate && "Pick a date.",
    patternChanged && startDate && startDate < today && "A new pattern has to start today or later. Past dates stay as they were.",
    endDate && startDate && endDate < startDate && "The end date is before the first date.",
    rowProblems.length > 0 && `Fix the date${rowProblems.length > 1 ? "s" : ""} marked under Upcoming dates.`,
  ].filter((p): p is string => !!p);
  const valid = problems.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const body = {
      kind,
      name: name.trim(),
      amount: each,
      currency: cur,
      accountId: accountId || null,
      categoryId: direction === "PAYMENT" ? categoryId : null,
      frequency,
      customIntervalDays: frequency === "CUSTOM" ? days : null,
      startDate,
      endDate: endDate || null,
      requiresConfirmation: confirmEach,
      notes: notes || null,
    };
    const changes = rows.filter((r) => r.changed && !r.stored);
    try {
      if (editing) {
        // Only re-anchor the pattern when it actually changed — otherwise the
        // schedule keeps its original anchor (and its moved occurrences).
        await api(`/api/schedules/${initial!.id}`, {
          method: "PATCH",
          body: patternChanged ? body : { ...body, startDate: undefined, frequency: undefined, customIntervalDays: undefined },
        });
        // Per-date changes, each sent whole (date and amount together) so
        // changing one never resets the other.
        const failed: string[] = [];
        for (const r of changes) {
          try {
            await api(`/api/schedules/${initial!.id}/override`, { method: "PUT", body: { occurrenceDate: r.key, date: r.finalDate, amount: r.finalAmount } });
          } catch (err) {
            failed.push(`${nice(r.key)}: ${(err as Error).message}`);
          }
        }
        if (failed.length) toast.error(`Schedule saved, but ${failed.length === 1 ? "one date" : "some dates"} couldn't be changed. ${failed.join(" ")}`);
        else toast.success(changes.length ? `Schedule and ${changes.length} date${changes.length > 1 ? "s" : ""} updated. Past ones stay exactly as they were.` : "Schedule updated. Past ones stay exactly as they were.");
      } else {
        const last = rows[rows.length - 1];
        const r = await api<{ due: { pending: number; executed: number } }>("/api/schedules", {
          body: {
            ...body,
            direction,
            overrides: rows
              .filter((x) => x.finalDate || x.finalAmount != null || (splitting && x === last && Math.abs(lastAmount - each) > 0.004))
              // The split's last payment carries the rounding.
              .map((x) => ({ occurrenceDate: x.key, date: x.finalDate, amount: x.finalAmount ?? (splitting && x === last && Math.abs(lastAmount - each) > 0.004 ? lastAmount : null) })),
          },
        });
        toast.success(
          r.due.pending > 0
            ? `${name} scheduled. ${r.due.pending} occurrence${r.due.pending > 1 ? "s are" : " is"} already due. Confirm below.`
            : r.due.executed > 0
              ? `${name} scheduled and the due occurrence was booked.`
              : `${name} scheduled.`
        );
      }
      onSaved();
    } catch (err) {
      toast.error(`Not saved. ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const nextRow = rows[0];
  const showList = rows.length > 0 && amt > 0;

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="space-y-1.5">
        <Label>Type</Label>
        <div className="flex flex-wrap gap-1.5">
          {KINDS[direction].map((k) => (
            <button
              key={k.v}
              type="button"
              aria-pressed={kind === k.v}
              onClick={() => setKind(k.v)}
              className={cn("h-8 cursor-pointer rounded-lg border px-3 text-xs transition-colors", kind === k.v ? "border-foreground/50 bg-card font-medium text-foreground shadow-card" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {k.l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="s-name">Name</Label>
          <Input id="s-name" required value={name} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} placeholder={direction === "INCOME" ? "Monthly salary" : "Rent, Flat 4B"} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="s-amt">{splitting ? "Total amount" : "Amount"}</Label>
            {!editing && frequency !== "ONE_TIME" && (
              <div className="flex rounded-md border border-border p-0.5 text-[11px]" role="radiogroup" aria-label="Amount is">
                {(["EACH", "TOTAL"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={amountMode === m}
                    title={m === "TOTAL" && !endDate ? "Set an end date to split a total" : undefined}
                    onClick={() => { setModeTouched(true); setAmountMode(m); }}
                    className={cn("cursor-pointer rounded px-1.5 py-0.5", amountMode === m ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    {m === "EACH" ? "Each payment" : "Total"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-1.5">
            <Input id="s-amt" type="number" inputMode="decimal" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
            <Select value={cur} onValueChange={setCurrency}>
              <SelectTrigger className="w-[86px] shrink-0" aria-label="Currency"><SelectValue /></SelectTrigger>
              <SelectContent>{currencyChoices.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {amountMode === "TOTAL" && !editing && frequency !== "ONE_TIME" && (
            <p className="text-[11px] text-muted-foreground">
              {splitting && amt > 0
                ? <>Split into {nominals.length} payments of {formatMoney(each, cur)}{Math.abs(lastAmount - each) > 0.004 ? <> (last {formatMoney(lastAmount, cur)})</> : null}. Change any of them below.</>
                : "Set an end date and the total is split across every payment."}
            </p>
          )}
          {editing && <p className="text-[11px] text-muted-foreground">Applies to every upcoming date that doesn&apos;t have its own amount.</p>}
          {account && cur !== account.currency && (
            <p className="text-[11px] text-muted-foreground">
              {crossRate != null && amt > 0 ? <>≈ {formatMoney(amt * crossRate, account.currency)} at today&apos;s rate. </> : null}
              Converted into {account.currency} when it&apos;s booked; you can enter the exact amount when you confirm.
              <FxTicker compact className="mt-1 flex" />
            </p>
          )}
        </div>
      </div>

      <div className={cn("grid gap-3", direction === "PAYMENT" && "sm:grid-cols-2")}>
        <div className="space-y-1.5">
          <Label>{direction === "INCOME" ? "Credited to" : <>Paid from <span className="font-normal text-muted-foreground">(optional)</span></>}</Label>
          <Select value={accountId || (direction === "PAYMENT" ? "__later__" : "")} onValueChange={(v) => setAccountId(v === "__later__" ? "" : v)}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
            <SelectContent>
              {direction === "PAYMENT" && <SelectItem value="__later__">Decide later</SelectItem>}
              {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · {a.currency}</SelectItem>)}
            </SelectContent>
          </Select>
          {direction === "PAYMENT" && !accountId && (
            <p className="text-[11px] text-muted-foreground">Each payment comes from the account on that month&apos;s budget line, or the one you pick when you confirm it.</p>
          )}
        </div>
        {direction === "PAYMENT" && (
          <div className="space-y-1.5">
            <Label>Budget category</Label>
            <Select value={categoryId ?? ""} onValueChange={(v) => setCategoryId(v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose category" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                <SelectSeparator />
                <SelectItem value="__new__">+ New category…</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {categoryId === "__new__" && (
        <div className="flex gap-2">
          <Input autoFocus value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="e.g. Hostel" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), createCategory())} />
          <Button type="button" variant="outline" onClick={createCategory}>Create</Button>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>How often</Label>
        <div className="flex flex-wrap gap-1.5">
          {FREQUENCIES.map((f) => (
            <button
              key={f.v}
              type="button"
              aria-pressed={frequency === f.v}
              onClick={() => setFrequency(f.v)}
              className={cn("h-8 cursor-pointer rounded-lg border px-3 text-xs transition-colors", frequency === f.v ? "border-foreground/50 bg-card font-medium text-foreground shadow-card" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {f.l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="s-start">{editing ? "Next regular date" : frequency === "ONE_TIME" ? "Date" : "First date"}</Label>
          <Input
            id="s-start"
            type="date"
            required
            value={startDate}
            aria-invalid={patternChanged && !!startDate && startDate < today}
            aria-describedby="s-start-hint"
            onChange={(e) => { setStartTouched(true); setStartDate(e.target.value); }}
          />
          <p id="s-start-hint" className={cn("text-[11px]", patternChanged && startDate && startDate < today ? "text-negative" : "text-muted-foreground")}>
            {patternChanged && startDate && startDate < today
              ? "Pick today or later for the new pattern."
              : editing && frequency !== "ONE_TIME"
                ? nextRow && nextRow.date !== nextRow.key && keepsSavedPattern
                  ? <>Expected on {nice(nextRow.date)}. Changing this date resets the pattern from it; to move one payment, change it below.</>
                  : "Changing this resets the pattern from that date. To move one payment, change it below."
                : null}
          </p>
        </div>
        {frequency === "CUSTOM" && (
          <div className="space-y-1.5">
            <Label htmlFor="s-days">Every (days)</Label>
            <Input id="s-days" type="number" min="1" max="3650" value={customDays} onChange={(e) => setCustomDays(e.target.value)} />
          </div>
        )}
        {frequency !== "ONE_TIME" && (
          <div className="space-y-1.5">
            <Label htmlFor="s-end">Ends</Label>
            <Input id="s-end" type="date" value={endDate} aria-invalid={!!endDate && endDate < startDate} onChange={(e) => setEndDate(e.target.value)} />
            <p className={cn("text-[11px]", endDate && endDate < startDate ? "text-negative" : "text-muted-foreground")}>
              {endDate && endDate < startDate ? "The end date is before the first date." : "Leave empty to continue until you end it."}
            </p>
          </div>
        )}
      </div>

      {(droppedSaved.length > 0 || setAside.length > 0) && (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
          {droppedSaved.length > 0 && (
            <p>
              The new pattern doesn&apos;t have {droppedSaved.length === 1 ? "the date" : "the dates"} you changed by hand for{" "}
              {droppedSaved.map((o) => nice(o.occurrenceDate)).join(", ")}. {droppedSaved.length === 1 ? "That change is" : "Those changes are"} cleared when you save.
            </p>
          )}
          {setAside.length > 0 && (
            <p className={cn(droppedSaved.length > 0 && "mt-1")}>
              Your edit{setAside.length > 1 ? "s" : ""} for {setAside.map(([k]) => nice(k)).join(", ")} {setAside.length > 1 ? "don't" : "doesn't"} match this pattern and won&apos;t be saved. Switch back to keep {setAside.length > 1 ? "them" : "it"}.
            </p>
          )}
        </div>
      )}

      {showList && (
        <div className="rounded-lg border border-border">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-border px-3 py-2">
            <p className="text-xs font-medium">Upcoming dates</p>
            <p className="text-[11px] text-muted-foreground">
              {frequency === "ONE_TIME" ? "Change the date above" : "Change the date or amount of any payment that differs"}
            </p>
          </div>
          {frequency !== "ONE_TIME" && (
            <div className="hidden grid-cols-[1fr_150px_120px_32px] gap-2 px-3 pt-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase sm:grid">
              <span>Regular date</span>
              <span>Expected on</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
          )}
          <ul className="divide-y divide-border/70">
            {rows.map((r) => {
              const st = r.stored ? occurrenceStatus(r.stored.status, direction) : null;
              const custom = !!r.finalDate || r.finalAmount != null;
              return (
                <li key={r.key} className="grid grid-cols-[1fr_1fr_32px] items-center gap-x-2 gap-y-1 px-3 py-2 sm:grid-cols-[1fr_150px_120px_32px] sm:py-1.5">
                  <div className="col-span-3 flex min-w-0 flex-wrap items-center gap-1.5 sm:col-span-1">
                    <span className={cn("text-xs tabular-nums", r.stored?.status === "SKIPPED" && "text-muted-foreground line-through")}>{nice(r.key)}</span>
                    {st ? (
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                    ) : r.changed ? (
                      <StatusBadge tone="brass" dot={false}>Unsaved</StatusBadge>
                    ) : custom ? (
                      <StatusBadge tone="brass" dot={false}>{r.finalDate && r.finalAmount != null ? "Date & amount set" : r.finalDate ? "Moved" : "Amount set"}</StatusBadge>
                    ) : null}
                  </div>
                  {r.stored ? (
                    <p className="col-span-3 text-[11px] text-muted-foreground sm:col-span-3">
                      {r.stored.status === "SKIPPED" ? "Skipped ahead of time. Restore it from the schedule to bring it back." : `On record for ${nice(r.stored.executedDate)}.`}
                    </p>
                  ) : frequency === "ONE_TIME" ? (
                    <p className="col-span-3 text-right text-xs tabular-nums sm:col-span-3">{formatMoney(r.amountShown, cur)}</p>
                  ) : (
                    <>
                      <Input
                        type="date"
                        aria-label={`Date for ${r.key}`}
                        aria-invalid={!!r.problem}
                        value={r.date}
                        onChange={(e) => setDraft(r.key, { date: e.target.value })}
                        className={cn("h-8 text-xs", r.finalDate && "text-brass")}
                      />
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        aria-label={`Amount for ${r.key}`}
                        placeholder={String(r.regular)}
                        value={drafts[r.key]?.amount ?? (r.finalAmount != null ? String(r.finalAmount) : "")}
                        onChange={(e) => setDraft(r.key, { amount: e.target.value })}
                        className={cn("h-8 text-right text-xs tabular-nums", r.finalAmount != null && "text-brass")}
                      />
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Reset ${nice(r.key)} to the regular date and amount`}
                        title="Back to the regular date and amount"
                        disabled={!custom}
                        onClick={() => resetRow(r.key)}
                        className={cn(!custom && "invisible")}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      {r.problem && <p className="col-span-3 text-[11px] text-negative sm:col-start-2 sm:col-span-3">{r.problem}</p>}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {endDate && frequency !== "ONE_TIME" ? (
            <p className={cn("border-t border-border px-3 py-2 text-[11px]", splitting && Math.abs(plannedTotal - amt) > 0.004 ? "text-warning" : "text-muted-foreground")}>
              {rows.length} payments · {formatMoney(Math.round(plannedTotal * 100) / 100, cur)} in all
              {splitting && Math.abs(plannedTotal - amt) > 0.004 && <> (the total is {formatMoney(amt, cur)})</>}
            </p>
          ) : (
            frequency !== "ONE_TIME" && <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">Showing the next {rows.length}. Later dates can be changed from the schedule any time.</p>
          )}
        </div>
      )}

      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1.5 text-sm font-medium">When it comes due</legend>
        {[
          { v: true, t: "Ask me to confirm", d: direction === "INCOME" ? "Shows as awaiting confirmation; you confirm the amount and date it actually arrived." : "Shows as due; you confirm once it's paid." },
          { v: false, t: direction === "INCOME" ? "Credit automatically" : "Pay automatically", d: "Booked to the ledger on the due date without asking. Failures are flagged." },
        ].map((o) => (
          <label key={String(o.v)} className={cn("flex cursor-pointer gap-2.5 rounded-lg border p-3 transition-colors", confirmEach === o.v ? "border-foreground/40 bg-card shadow-card" : "border-border")}>
            <input type="radio" className="mt-0.5 accent-[var(--brass)]" checked={confirmEach === o.v} onChange={() => setConfirmEach(o.v)} />
            <span>
              <span className="block text-sm">{o.t}{o.v && <span className="ml-1.5 text-[11px] text-muted-foreground">recommended</span>}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{o.d}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="s-notes">Notes</Label>
        <Input id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>

      {editing && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Changes apply from the next occurrence. Everything already received, paid or skipped stays exactly as recorded, and the change is logged.
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {problems.length
            ? problems[0]
            : amt > 0 && account && frequency !== "ONE_TIME" && `${formatMoney(amt, cur)} · ${frequencyLabel(frequency, days).toLowerCase()}`}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={!valid || busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create schedule"}</Button>
        </div>
      </div>
    </form>
  );
}
