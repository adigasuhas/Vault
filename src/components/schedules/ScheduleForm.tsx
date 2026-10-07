"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, localToday } from "@/lib/client";
import { formatMoney } from "@/lib/currencies";
import { useCurrency } from "@/context/CurrencyContext";
import { defaultStartDate, isoDate, neighbours, nthOccurrence, type Frequency } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FxTicker } from "@/components/app/FxTicker";
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
  accountId: string;
  categoryId: string | null;
  frequency: Frequency;
  customIntervalDays: number | null;
  startDate: string; // next occurrence in edit mode
  endDate: string | null;
  requiresConfirmation: boolean;
  notes: string | null;
}

const PREVIEW_COUNT: Record<Frequency, number> = { ONE_TIME: 1, WEEKLY: 4, MONTHLY: 6, QUARTERLY: 4, HALF_YEARLY: 4, YEARLY: 3, CUSTOM: 4 };

export function ScheduleForm({
  direction,
  accounts,
  categories,
  initial,
  onSaved,
  onCancel,
  onCategoryCreated,
}: {
  direction: "INCOME" | "PAYMENT";
  accounts: Account[];
  categories: Category[];
  initial?: ScheduleFormValue | null;
  onSaved: () => void;
  onCancel: () => void;
  onCategoryCreated?: (c: Category) => void;
}) {
  const editing = !!initial?.id;
  const today = localToday();
  const [kind, setKind] = useState(initial?.kind ?? KINDS[direction][0].v);
  const [name, setName] = useState(initial?.name ?? "");
  const [nameTouched, setNameTouched] = useState(!!initial);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? "");
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
  const [overrides, setOverrides] = useState<Record<string, { date?: string; amount?: string }>>({});
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
  useEffect(() => setOverrides({}), [frequency, startDate, customDays]);

  const account = accounts.find((a) => a.id === accountId);
  const amt = Number(amount);
  const cur = currency || account?.currency || fx.primary;
  const currencyChoices = [...new Set([account?.currency, fx.primary, fx.secondary, cur].filter((c): c is string => !!c))];
  // Today's rate from the amount's currency into the account's.
  const crossRate = account && cur !== account.currency && fx.toPrimary[cur] != null && (account.currency === fx.primary || fx.toPrimary[account.currency])
    ? (fx.toPrimary[cur] as number) / (account.currency === fx.primary ? 1 : (fx.toPrimary[account.currency] as number))
    : null;
  const rule = useMemo(
    () => ({ startDate: new Date(startDate || today), frequency, customIntervalDays: Number(customDays) || 30 }),
    [startDate, frequency, customDays, today]
  );
  const preview = useMemo(() => {
    if (!startDate) return [];
    const out: Date[] = [];
    const end = endDate ? new Date(endDate) : null;
    for (let n = 0; n < PREVIEW_COUNT[frequency]; n++) {
      const d = nthOccurrence(rule.startDate, frequency, n, rule.customIntervalDays);
      if (end && d > end) break;
      out.push(d);
      if (frequency === "ONE_TIME") break;
    }
    return out;
  }, [rule, frequency, startDate, endDate]);

  const overrideErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    for (const [nominal, o] of Object.entries(overrides)) {
      if (!o.date) continue;
      const { prev, next } = neighbours(rule, new Date(nominal));
      const d = new Date(o.date);
      if ((prev && d <= prev) || (next && d >= next)) errs[nominal] = "Keep it within its own period";
    }
    return errs;
  }, [overrides, rule]);

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

  const valid =
    name.trim() && amt > 0 && accountId && startDate && (direction === "INCOME" || (categoryId && categoryId !== "__new__")) && Object.keys(overrideErrors).length === 0 && (!endDate || endDate >= startDate);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const body = {
      kind,
      name: name.trim(),
      amount: amt,
      currency: cur,
      accountId,
      categoryId: direction === "PAYMENT" ? categoryId : null,
      frequency,
      customIntervalDays: frequency === "CUSTOM" ? Number(customDays) : null,
      startDate,
      endDate: endDate || null,
      requiresConfirmation: confirmEach,
      notes: notes || null,
    };
    try {
      if (editing) {
        const changed = startDate !== initial!.startDate || frequency !== initial!.frequency || (frequency === "CUSTOM" && Number(customDays) !== initial!.customIntervalDays);
        // Only re-anchor the pattern when it actually changed — otherwise the
        // schedule keeps its original anchor (and its moved occurrences).
        await api(`/api/schedules/${initial!.id}`, {
          method: "PATCH",
          body: changed ? body : { ...body, startDate: undefined, frequency: undefined, customIntervalDays: undefined },
        });
        toast.success("Schedule updated. Anything in the past stays exactly as it was.");
      } else {
        const r = await api<{ due: { pending: number; executed: number } }>("/api/schedules", {
          body: {
            ...body,
            direction,
            overrides: Object.entries(overrides)
              .filter(([, o]) => o.date || o.amount)
              .map(([nominal, o]) => ({ occurrenceDate: nominal, date: o.date || null, amount: o.amount ? Number(o.amount) : null })),
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
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1.5">
        <Label>Type</Label>
        <div className="flex flex-wrap gap-1.5">
          {KINDS[direction].map((k) => (
            <button
              key={k.v}
              type="button"
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
          <Label htmlFor="s-amt">Amount</Label>
          <div className="flex gap-1.5">
            <Input id="s-amt" type="number" inputMode="decimal" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
            <Select value={cur} onValueChange={setCurrency}>
              <SelectTrigger className="w-[86px] shrink-0" aria-label="Currency"><SelectValue /></SelectTrigger>
              <SelectContent>{currencyChoices.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
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
          <Label>{direction === "INCOME" ? "Credited to" : "Paid from"}</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
            <SelectContent>
              {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · {a.currency}</SelectItem>)}
            </SelectContent>
          </Select>
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
          <Label htmlFor="s-start">{editing ? "Next date" : frequency === "ONE_TIME" ? "Date" : "First date"}</Label>
          <Input id="s-start" type="date" required value={startDate} min={editing ? today : undefined} onChange={(e) => { setStartTouched(true); setStartDate(e.target.value); }} />
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
            <Input id="s-end" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Leave empty to continue until you end it.</p>
          </div>
        )}
      </div>

      {!editing && preview.length > 0 && amt > 0 && (
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-xs font-medium">Upcoming dates</p>
            <p className="text-[11px] text-muted-foreground">Change any date or amount that differs</p>
          </div>
          <ul className="divide-y divide-border/70">
            {preview.map((d) => {
              const key = isoDate(d);
              const o = overrides[key] ?? {};
              return (
                <li key={key} className="grid grid-cols-[1fr_140px_110px] items-center gap-2 px-3 py-1.5">
                  <span className={cn("text-xs", (o.date || o.amount) && "text-brass")}>
                    {d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
                    {overrideErrors[key] && <span className="ml-2 text-negative">{overrideErrors[key]}</span>}
                  </span>
                  <Input
                    type="date"
                    aria-label={`Date for ${key}`}
                    value={o.date ?? key}
                    onChange={(e) => setOverrides((s) => ({ ...s, [key]: { ...s[key], date: e.target.value && e.target.value !== key ? e.target.value : undefined } }))}
                    className="h-8 text-xs"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label={`Amount for ${key}`}
                    placeholder={String(amt)}
                    value={o.amount ?? ""}
                    onChange={(e) => setOverrides((s) => ({ ...s, [key]: { ...s[key], amount: e.target.value || undefined } }))}
                    className="h-8 text-right text-xs tabular-nums"
                  />
                </li>
              );
            })}
          </ul>
          {frequency !== "ONE_TIME" && <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">You can move later dates from the schedule any time.</p>}
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

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          {amt > 0 && account && frequency !== "ONE_TIME" && `${formatMoney(amt, cur)} · ${frequencyLabel(frequency, Number(customDays)).toLowerCase()}`}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={!valid || busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create schedule"}</Button>
        </div>
      </div>
    </form>
  );
}
