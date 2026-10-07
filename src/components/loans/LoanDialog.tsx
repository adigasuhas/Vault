"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/context/SessionContext";
import { api, localToday } from "@/lib/client";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { amortizationSchedule, computeEmi, monthsBetween } from "@/lib/loans";
import { addMonthsUTC } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Account { id: string; name: string; currency: string; status: string }

/** A stored loan, for editing. `termsLocked`: EMIs already paid or skipped. */
export interface EditableLoan {
  id: string;
  name: string;
  principal: string | number;
  interestRate: string | number;
  installments: number;
  emiAmount: string | number;
  startDate: string;
  currency: string;
  linkedAccountId: string | null;
  termsLocked: boolean;
}

/** Add-a-loan form. `initial` pre-fills it (e.g. from a Notebook entry, whose
 * id is passed as `notebookEntryId` so the entry is marked as turned into
 * this loan). With `editing`, it edits that loan instead. */
export function LoanDialog({
  open,
  onOpenChange,
  onDone,
  initial,
  notebookEntryId,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  initial?: { name?: string; principal?: number; currency?: string };
  notebookEntryId?: string;
  editing?: EditableLoan | null;
}) {
  const { user } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const blank = () => {
    if (editing) {
      const start = editing.startDate.slice(0, 10);
      const principal = Number(editing.principal);
      const rate = Number(editing.interestRate);
      const auto = Math.round(computeEmi(principal, rate, editing.installments) * 100) / 100;
      const stored = Number(editing.emiAmount);
      return {
        name: editing.name,
        principal: String(principal),
        rate: rate ? String(rate) : "",
        installments: String(editing.installments),
        startDate: start,
        endDate: addMonthsUTC(new Date(`${start}T00:00:00Z`), editing.installments - 1).toISOString().slice(0, 10),
        emi: Math.abs(stored - auto) > 0.005 ? String(stored) : "",
        currency: editing.currency,
        accountId: editing.linkedAccountId ?? "",
        schedule: true,
        confirm: true,
      };
    }
    return { name: initial?.name ?? "", principal: initial?.principal ? String(initial.principal) : "", rate: "", installments: "", startDate: localToday(), endDate: "", emi: "", currency: initial?.currency ?? user?.baseCurrency ?? "INR", accountId: "", schedule: true, confirm: true };
  };
  const locked = !!editing?.termsLocked;
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    // Fresh form (and the latest pre-fill) each time the dialog opens.
    setWasOpen(open);
    if (open) setF(blank());
  }
  useEffect(() => {
    if (open) api<{ accounts: Account[] }>("/api/accounts").then((d) => setAccounts(d.accounts.filter((a) => a.status !== "CLOSED")));
  }, [open]);
  const months = Number(f.installments);
  // Default EMI: the computed one, an equal split of the amount when the rate is 0.
  const autoEmi = Number(f.principal) > 0 && months > 0 ? Math.round(computeEmi(Number(f.principal), Number(f.rate) || 0, months) * 100) / 100 : 0;
  const customEmi = f.emi !== "" && Number(f.emi) > 0 ? Number(f.emi) : null;
  const emi = customEmi ?? autoEmi;
  const rows = emi > 0 ? amortizationSchedule(Number(f.principal), Number(f.rate) || 0, months, new Date(`${f.startDate}T00:00:00Z`), emi) : [];
  const lastEmi = rows.length ? rows[rows.length - 1].emi : 0;
  const totalPaid = rows.reduce((t, r) => t + r.emi, 0);
  const pastDue = rows.filter((r) => r.dueDate.toISOString().slice(0, 10) < localToday()).length;
  // The first EMI falls on the start date, so n EMIs end n-1 months later.
  const endFrom = (start: string, n: number) => (start && n > 0 ? addMonthsUTC(new Date(`${start}T00:00:00Z`), n - 1).toISOString().slice(0, 10) : "");
  const setMonths = (v: string) => setF({ ...f, installments: v, endDate: endFrom(f.startDate, Number(v)) });
  const setStart = (v: string) => setF({ ...f, startDate: v, endDate: endFrom(v, months) });
  const setEnd = (v: string) => {
    const n = v && f.startDate ? monthsBetween(new Date(`${f.startDate}T00:00:00Z`), new Date(`${v}T00:00:00Z`)) + 1 : 0;
    setF({ ...f, endDate: v, installments: n > 0 ? String(n) : "" });
  };
  const sameCur = accounts.filter((a) => a.currency === f.currency);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        await api(`/api/loans/${editing.id}`, {
          method: "PATCH",
          body: {
            name: f.name,
            ...(f.accountId && f.accountId !== editing.linkedAccountId ? { linkedAccountId: f.accountId } : {}),
            ...(locked
              ? {}
              : { principal: Number(f.principal), interestRate: Number(f.rate) || 0, installments: months, startDate: f.startDate, emiAmount: customEmi }),
          },
        });
        toast.success(`${f.name} updated.`);
        onOpenChange(false);
        onDone();
        return;
      }
      await api("/api/loans", {
        body: {
          name: f.name,
          principal: Number(f.principal),
          interestRate: Number(f.rate) || 0,
          installments: months,
          emiAmount: customEmi ?? undefined,
          currency: f.currency,
          startDate: f.startDate,
          linkedAccountId: f.accountId || undefined,
          scheduleEmis: f.schedule && !!f.accountId,
          requiresConfirmation: f.confirm,
          notebookEntryId,
        },
      });
      toast.success(`${f.name} added${f.schedule && f.accountId ? " with its EMI schedule" : ""}.`);
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit loan" : "Add a loan"}</DialogTitle>
            <DialogDescription>
              {editing
                ? locked
                  ? "EMIs have already been paid or skipped, so only the name and the account can change. To restructure the loan, close it and add a new one."
                  : "Nothing has been paid yet, so everything can change. The EMI schedule is rebuilt to match."
                : "Education loan, a laptop on EMI, a personal loan. Enter the amount and dates: VAULT splits it into equal monthly EMIs, which you can change."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="l-name">Name</Label>
              <Input id="l-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="SBI education loan" />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select disabled={!!editing} value={f.currency} onValueChange={(v) => setF({ ...f, currency: v, accountId: "" })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="l-p">Loan amount</Label>
              <Input id="l-p" disabled={locked} type="number" min="0" step="0.01" required value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-r">Interest (% / yr)</Label>
              <Input id="l-r" disabled={locked} type="number" min="0" step="0.01" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="0 (none)" />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_1fr_0.7fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="l-s">First EMI</Label>
              <Input id="l-s" disabled={locked} type="date" value={f.startDate} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-e">Last EMI</Label>
              <Input id="l-e" disabled={locked} type="date" min={f.startDate} value={f.endDate} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-n">Months</Label>
              <Input id="l-n" disabled={locked} type="number" min="1" max="600" required value={f.installments} onChange={(e) => setMonths(e.target.value)} />
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">Set the last EMI date or the number of months; the other fills in.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="l-emi">Monthly EMI</Label>
              <Input id="l-emi" disabled={locked} type="number" min="0" step="0.01" value={f.emi === "" ? (autoEmi ? String(autoEmi) : "") : f.emi} onChange={(e) => setF({ ...f, emi: e.target.value })} />
              {locked ? null : customEmi != null && Math.abs(customEmi - autoEmi) > 0.005 ? (
                <button type="button" className="cursor-pointer text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setF({ ...f, emi: "" })}>
                  Back to {Number(f.rate) > 0 ? "the calculated EMI" : "an equal split"} ({formatMoney(autoEmi, f.currency)})
                </button>
              ) : (
                <p className="text-[11px] text-muted-foreground">{Number(f.rate) > 0 ? "Calculated from the rate." : "Amount split equally."} Change it if your lender bills differently.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>EMIs paid from</Label>
              <Select value={f.accountId} onValueChange={(v) => setF({ ...f, accountId: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
                <SelectContent>{sameCur.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {rows.length > 0 && (
            <div className="space-y-0.5 rounded-lg bg-muted px-4 py-3 text-sm">
              <p>
                {rows.length} monthly EMIs of <span className="font-semibold tabular-nums">{formatMoney(emi, f.currency)}</span>
                {rows.length > 1 && Math.abs(lastEmi - emi) > 0.005 && <span className="text-muted-foreground"> (the last is {formatMoney(lastEmi, f.currency)}{Math.abs(lastEmi - emi) < 1 ? ", evening out the rounding" : ""})</span>}
                {" · "}<span className="text-muted-foreground">{Number(f.rate) > 0 ? `total interest ${formatMoney(Math.round(totalPaid - Number(f.principal)), f.currency)}` : `total ${formatMoney(Math.round(totalPaid), f.currency)}`}</span>
              </p>
              {!editing && pastDue > 0 && f.schedule && f.accountId && <p className="text-xs text-muted-foreground">{pastDue} of these {pastDue === 1 ? "falls" : "fall"} before today, so only {rows.length - pastDue} will be scheduled. Record earlier ones on the loan&apos;s page.</p>}
              {rows.length < months && <p className="text-xs text-warning">At this EMI the loan is paid off in {rows.length} months, not {months}.</p>}
              {customEmi != null && rows.length > 1 && lastEmi > emi * 1.5 && <p className="text-xs text-warning">This EMI leaves a large final payment.</p>}
            </div>
          )}
          {!editing && (
            <>
          <label className={cn("flex gap-2.5 rounded-lg border p-3", f.accountId ? "cursor-pointer border-border" : "border-border opacity-60")}>
            <input type="checkbox" disabled={!f.accountId} className="mt-0.5 accent-[var(--brass)]" checked={f.schedule && !!f.accountId} onChange={(e) => setF({ ...f, schedule: e.target.checked })} />
            <span>
              <span className="block text-sm">Track EMIs as scheduled payments</span>
              <span className="block text-xs text-muted-foreground">Each EMI from today on appears in its month&apos;s budget and in the list below. Past EMIs can be recorded on the loan page.</span>
            </span>
          </label>
          {f.schedule && f.accountId && (
            <label className="flex cursor-pointer items-center gap-2 pl-1 text-xs text-muted-foreground">
              <input type="checkbox" className="accent-[var(--brass)]" checked={!f.confirm} onChange={(e) => setF({ ...f, confirm: !e.target.checked })} />
              Book EMIs automatically on the due date (otherwise you confirm each)
            </label>
          )}
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !f.name.trim() || !(Number(f.principal) > 0) || !(Number(f.installments) > 0)}>{busy ? "Saving…" : editing ? "Save changes" : "Add loan"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
