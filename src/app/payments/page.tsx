"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/context/SessionContext";
import { api, localToday } from "@/lib/client";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { computeEmi } from "@/lib/loans";
import { PageHeader, Section, EmptyState, SkeletonBlock } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { SchedulesBoard } from "@/components/schedules/SchedulesBoard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Landmark, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Equivalent } from "@/components/app/Money";

interface Loan {
  id: string;
  name: string;
  principal: string;
  interestRate: string;
  installments: number;
  emiAmount: string;
  currency: string;
  status: "ACTIVE" | "CLOSED";
  linkedAccount: { id: string; name: string } | null;
  schedule: { id: string; isActive: boolean; requiresConfirmation: boolean; nextExecutionDate: string } | null;
  progress: { paidCount: number; totalInstallments: number; outstandingPrincipal: number; percentPaid: number; nextDue: { dueDate: string; emi: number } | null };
}
interface Account { id: string; name: string; currency: string; status: string }

function LoanDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { user } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [f, setF] = useState({ name: "", principal: "", rate: "", installments: "", startDate: localToday(), currency: user?.baseCurrency ?? "INR", accountId: "", schedule: true, confirm: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) api<{ accounts: Account[] }>("/api/accounts").then((d) => setAccounts(d.accounts.filter((a) => a.status !== "CLOSED")));
  }, [open]);
  const emi = Number(f.principal) > 0 && Number(f.installments) > 0 ? computeEmi(Number(f.principal), Number(f.rate) || 0, Number(f.installments)) : 0;
  const sameCur = accounts.filter((a) => a.currency === f.currency);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/loans", {
        body: {
          name: f.name,
          principal: Number(f.principal),
          interestRate: Number(f.rate) || 0,
          installments: Number(f.installments),
          currency: f.currency,
          startDate: f.startDate,
          linkedAccountId: f.accountId || undefined,
          scheduleEmis: f.schedule && !!f.accountId,
          requiresConfirmation: f.confirm,
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
            <DialogTitle>Add a loan</DialogTitle>
            <DialogDescription>Education loan, a laptop on EMI, a personal loan. VAULT works out the EMI and the principal/interest split.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="l-name">Name</Label>
              <Input id="l-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="SBI education loan" />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={f.currency} onValueChange={(v) => setF({ ...f, currency: v, accountId: "" })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="l-p">Principal</Label>
              <Input id="l-p" type="number" min="0" required value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-r">Rate (% / yr)</Label>
              <Input id="l-r" type="number" min="0" step="0.01" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-n">Months</Label>
              <Input id="l-n" type="number" min="1" max="600" required value={f.installments} onChange={(e) => setF({ ...f, installments: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="l-s">Loan start</Label>
              <Input id="l-s" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">First EMI falls a month after.</p>
            </div>
            <div className="space-y-1.5">
              <Label>EMIs paid from</Label>
              <Select value={f.accountId} onValueChange={(v) => setF({ ...f, accountId: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
                <SelectContent>{sameCur.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {emi > 0 && (
            <div className="rounded-lg bg-muted px-4 py-3 text-sm">
              EMI <span className="font-semibold tabular-nums">{formatMoney(Math.round(emi), f.currency)}</span> × {f.installments} ·{" "}
              <span className="text-muted-foreground">total interest {formatMoney(Math.round(emi * Number(f.installments) - Number(f.principal)), f.currency)}</span>
            </div>
          )}
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !f.name.trim() || !(Number(f.principal) > 0) || !(Number(f.installments) > 0)}>{busy ? "Adding…" : "Add loan"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LoansSection({ onNew }: { onNew: () => void }) {
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const load = useCallback(() => api<{ loans: Loan[] }>("/api/loans").then((d) => setLoans(d.loans)).catch(() => setLoans([])), []);
  useEffect(() => {
    load();
  }, [load]);
  const active = (loans ?? []).filter((l) => l.status === "ACTIVE");
  const closed = (loans ?? []).filter((l) => l.status === "CLOSED");
  return (
    <Section title="Loans" description={loans && loans.length ? `${active.length} active${closed.length ? ` · ${closed.length} closed` : ""}` : undefined} actions={<Button size="sm" variant="outline" onClick={onNew}><Plus /> Add loan</Button>}>
      {loans === null ? (
        <SkeletonBlock className="h-32" />
      ) : loans.length === 0 ? (
        <EmptyState icon={<Landmark className="h-5 w-5" />} title="No loans">An education loan or anything on EMI goes here; its EMIs then show up in your budget.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {[...active, ...closed].map((l) => (
            <Link key={l.id} href={`/loans/${l.id}`} className={cn("lift block rounded-xl border border-border bg-card p-5 shadow-card", l.status === "CLOSED" && "opacity-70")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">{Number(l.interestRate)}% · {l.installments} months · EMI {formatMoney(Math.round(Number(l.emiAmount)), l.currency)}</p>
                </div>
                {l.status === "CLOSED" ? <StatusBadge tone="positive">Closed</StatusBadge> : l.schedule?.isActive ? <StatusBadge tone="info">Scheduled</StatusBadge> : <StatusBadge tone="warning">No schedule</StatusBadge>}
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="eyebrow">Outstanding</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(Math.round(l.progress.outstandingPrincipal), l.currency)}</p>
                  <Equivalent value={l.progress.outstandingPrincipal} currency={l.currency} className="text-xs" />
                </div>
                <p className="text-right text-xs text-muted-foreground">
                  {l.progress.paidCount}/{l.progress.totalInstallments} paid
                  {l.progress.nextDue && l.status === "ACTIVE" && <><br />next {formatDate(l.progress.nextDue.dueDate, { day: "numeric", month: "short" })}</>}
                </p>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-positive" style={{ width: `${l.progress.percentPaid}%` }} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}

export default function PaymentsPage() {
  const search = useSearchParams();
  const [loanOpen, setLoanOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-8">
      <SchedulesBoard
        key={key}
        direction="PAYMENT"
        openNew={search.get("new") === "1"}
        headerActions={(open) => (
          <PageHeader
            title="Loans & scheduled payments"
            description="Loans, rent and other regular bills. Each one shows up in the right month's budget, and you can skip or move a single payment without touching the rest."
            actions={
              <Button onClick={open}><Plus /> Schedule a payment</Button>
            }
          />
        )}
        extraTop={<LoansSection key={key} onNew={() => setLoanOpen(true)} />}
      />
      <LoanDialog open={loanOpen} onOpenChange={setLoanOpen} onDone={() => setKey((k) => k + 1)} />
    </div>
  );
}
