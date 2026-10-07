"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, localToday } from "@/lib/client";
import { formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { PageHeader, Panel, Section, Stat, SkeletonBlock, ErrorState, EmptyState } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmAction } from "@/components/ConfirmAction";
import { ArrowLeft, Pencil } from "lucide-react";
import { LoanDialog } from "@/components/loans/LoanDialog";
import { cn } from "@/lib/utils";
import { Equivalent } from "@/components/app/Money";

interface AmortRow { n: number; dueDate: string; emi: number; interest: number; principal: number; balanceAfter: number }
interface Detail {
  loan: {
    id: string;
    name: string;
    principal: string;
    interestRate: string;
    installments: number;
    emiAmount: string;
    currency: string;
    startDate: string;
    endDate: string;
    status: "ACTIVE" | "CLOSED";
    linkedAccount: { id: string; name: string; currency: string } | null;
    category: { id: string; name: string } | null;
    schedule: { id: string; isActive: boolean; requiresConfirmation: boolean; receivingAccountId: string } | null;
    payments: { id: string; amount: string; principalComponent: string; interestComponent: string; paidOn: string; note: string | null; reversedAt: string | null; occurrenceId: string | null }[];
  };
  schedule: AmortRow[];
  progress: { paidCount: number; totalInstallments: number; principalPaid: number; interestPaid: number; totalPaid: number; outstandingPrincipal: number; percentPaid: number; nextDue: AmortRow | null };
  totalInterest: number;
  termsLocked: boolean;
}
interface Account { id: string; name: string; currency: string; status: string }

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [pay, setPay] = useState({ amount: "", date: localToday(), accountId: "", note: "" });
  const [schedAccount, setSchedAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [payoffOpen, setPayoffOpen] = useState(false);
  const [payoff, setPayoff] = useState({ amount: "", date: localToday(), accountId: "" });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, a] = await Promise.all([api<Detail>(`/api/loans/${id}`), api<{ accounts: Account[] }>("/api/accounts")]);
      setData(d);
      setAccounts(a.accounts.filter((x) => x.status !== "CLOSED" && x.currency === d.loan.currency));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <div className="space-y-4"><SkeletonBlock className="h-16 w-80" /><SkeletonBlock className="h-64" /></div>;
  const { loan, progress } = data;
  const c = loan.currency;

  async function recordPayment() {
    setBusy(true);
    try {
      await api(`/api/loans/${id}/payments`, { body: { amount: Number(pay.amount), paidOn: pay.date, fromAccountId: pay.accountId || undefined, note: pay.note || undefined } });
      toast.success("Payment recorded.");
      setPayOpen(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function setupSchedule() {
    setBusy(true);
    try {
      await api(`/api/loans/${id}/schedule`, { body: { accountId: schedAccount, requiresConfirmation: true } });
      toast.success("EMI schedule set up. Upcoming EMIs now appear in your budget.");
      setSchedOpen(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function setStatus(status: "ACTIVE" | "CLOSED") {
    try {
      await api(`/api/loans/${id}`, { method: "PATCH", body: { status } });
      toast.success(status === "CLOSED" ? "Loan closed. Its EMI schedule has ended." : "Loan re-opened.");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function payOff() {
    setBusy(true);
    try {
      await api(`/api/loans/${id}/payoff`, { body: { accountId: payoff.accountId, date: payoff.date, amount: Number(payoff.amount) } });
      toast.success("Loan paid off and closed. Its EMI schedule has ended.");
      setPayoffOpen(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    try {
      await api(`/api/loans/${id}`, { method: "DELETE" });
      toast.success("Loan deleted.");
      router.push("/payments");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const rows = showAll ? data.schedule : data.schedule.slice(Math.max(0, progress.paidCount - 2), progress.paidCount + 10);
  const hasHistory = loan.payments.length > 0;

  return (
    <div className="space-y-8">
      <Link href="/payments" className="settle inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Loans & payments</Link>
      <PageHeader
        eyebrow={`${Number(loan.interestRate)}% a year · ${loan.installments} monthly EMIs · from ${formatDate(loan.startDate, { month: "short", year: "numeric" })}`}
        title={loan.name}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>
            {loan.status === "ACTIVE" && !loan.schedule && <Button variant="outline" onClick={() => { setSchedAccount(loan.linkedAccount?.id ?? accounts[0]?.id ?? ""); setSchedOpen(true); }}>Set up EMI schedule</Button>}
            {loan.status === "ACTIVE" && <Button variant="outline" onClick={() => { setPay({ amount: String(Math.round((progress.nextDue?.emi ?? Number(loan.emiAmount)) * 100) / 100), date: localToday(), accountId: loan.linkedAccount?.id ?? "", note: "" }); setPayOpen(true); }}>Record a payment</Button>}
            {loan.status === "ACTIVE" ? (
              <Button variant="ghost" onClick={() => { setPayoff({ amount: String(Math.round(progress.outstandingPrincipal * 100) / 100), date: localToday(), accountId: loan.linkedAccount?.id ?? "" }); setPayoffOpen(true); }}>Pay off & close</Button>
            ) : (
              progress.outstandingPrincipal > 0.004 && <Button variant="ghost" onClick={() => setStatus("ACTIVE")}>Re-open</Button>
            )}
            {!hasHistory && (
              <ConfirmAction
                title="Delete this loan?"
                description={<p>No payments are recorded yet, so it can be removed completely. Handy for a loan added by mistake.</p>}
                confirmLabel="Delete loan"
                onConfirm={remove}
                trigger={<Button variant="ghost" className="text-negative hover:text-negative">Delete</Button>}
              />
            )}
          </>
        }
      />

      <Panel className="settle overflow-hidden p-0">
        <div className="grid gap-px bg-border sm:grid-cols-4">
          <div className="bg-card p-5"><Stat label="Outstanding" value={formatMoney(Math.round(progress.outstandingPrincipal), c)} hint={<Equivalent value={progress.outstandingPrincipal} currency={c} />} /></div>
          <div className="bg-card p-5"><Stat label="EMI" value={formatMoney(Math.round(Number(loan.emiAmount)), c)} hint={loan.schedule?.isActive ? "Scheduled" : loan.status === "CLOSED" ? "Loan closed" : "Not scheduled"} /></div>
          <div className="bg-card p-5"><Stat label="Paid so far" value={formatMoney(Math.round(progress.totalPaid), c)} hint={`${formatMoney(Math.round(progress.interestPaid), c)} of it interest`} /></div>
          <div className="bg-card p-5"><Stat label="Progress" value={`${progress.paidCount} / ${progress.totalInstallments}`} hint={progress.nextDue && loan.status === "ACTIVE" ? `Next ${formatDate(progress.nextDue.dueDate)}` : undefined} /></div>
        </div>
        <div className="h-1 bg-muted"><div className="h-full bg-positive transition-[width] duration-700" style={{ width: `${progress.percentPaid}%` }} /></div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Section title="Amortisation" description={`Total interest over the loan: ${formatMoney(Math.round(data.totalInterest), c)}`} actions={<Button size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? "Show around today" : "Show all"}</Button>}>
          <Panel padded={false} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                <th className="px-4 py-2.5 text-left font-medium">#</th><th className="px-3 py-2.5 text-left font-medium">Due</th><th className="px-3 py-2.5 text-right font-medium">EMI</th><th className="px-3 py-2.5 text-right font-medium">Interest</th><th className="px-3 py-2.5 text-right font-medium">Principal</th><th className="px-4 py-2.5 text-right font-medium">Balance</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.n} className={cn("border-b border-border/60 last:border-0 tabular-nums", r.n <= progress.paidCount && "text-muted-foreground", r.n === progress.paidCount + 1 && loan.status === "ACTIVE" && "bg-brass-soft/50")}>
                    <td className="px-4 py-2">{r.n}</td>
                    <td className="px-3 py-2 font-mono text-xs">{formatDate(r.dueDate)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(Math.round(r.emi), c)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(Math.round(r.interest), c)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(Math.round(r.principal), c)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(Math.round(r.balanceAfter), c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </Section>

        <Section title="Payments" description={loan.schedule ? "EMIs booked from the schedule appear here too." : undefined}>
          <Panel padded={false}>
            {loan.payments.length === 0 ? (
              <div className="p-5"><EmptyState title="No payments recorded">{loan.schedule ? "Confirm each EMI from Loans & payments when it comes due." : "Record past EMIs here, or set up the EMI schedule."}</EmptyState></div>
            ) : (
              <ul className="divide-y divide-border">
                {[...loan.payments].reverse().map((p) => (
                  <li key={p.id} className={cn("flex items-center gap-3 px-5 py-3", p.reversedAt && "opacity-60")}>
                    <span className="w-24 font-mono text-xs text-muted-foreground">{formatDate(p.paidOn)}</span>
                    <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                      {formatMoney(Math.round(Number(p.principalComponent)), c)} principal · {formatMoney(Math.round(Number(p.interestComponent)), c)} interest
                      {p.note && ` · ${p.note}`}
                    </div>
                    {p.reversedAt && <StatusBadge tone="neutral">Reversed</StatusBadge>}
                    {p.occurrenceId && !p.reversedAt && <StatusBadge tone="outline" dot={false}>Scheduled</StatusBadge>}
                    <span className={cn("text-sm font-medium tabular-nums", p.reversedAt && "line-through")}>{formatMoney(Number(p.amount), c)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Section>
      </div>

      <Dialog open={payOpen} onOpenChange={(o) => !busy && setPayOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record a loan payment</DialogTitle>
            <DialogDescription>For an EMI paid before the schedule existed, or a prepayment. Paid from an account, it&apos;s booked to the ledger under {loan.category?.name ?? "the loan"}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="p-amt">Amount</Label><Input id="p-amt" type="number" min="0" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="p-date">Paid on</Label><Input id="p-date" type="date" max={localToday()} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Paid from</Label>
              <Select value={pay.accountId || "__none__"} onValueChange={(v) => setPay({ ...pay, accountId: v === "__none__" ? "" : v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not from a tracked account</SelectItem>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="p-note">Note</Label><Input id="p-note" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="Optional" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={recordPayment} disabled={busy || !(Number(pay.amount) > 0)}>{busy ? "Saving…" : "Record payment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={schedOpen} onOpenChange={(o) => !busy && setSchedOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set up the EMI schedule</DialogTitle>
            <DialogDescription>Remaining EMIs from today on become scheduled payments: they appear in each month&apos;s budget and wait for you to confirm.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Paid from</Label>
            <Select value={schedAccount} onValueChange={setSchedAccount}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSchedOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={setupSchedule} disabled={busy || !schedAccount}>Set up</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={payoffOpen} onOpenChange={(o) => !busy && setPayoffOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pay off {loan.name}</DialogTitle>
            <DialogDescription>
              Pays what&apos;s still owed in one payment and closes the loan. {formatMoney(Math.round(progress.outstandingPrincipal * 100) / 100, c)} of principal is outstanding; add any final interest or foreclosure charges on top. EMIs still waiting are marked skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="po-amt">Amount ({c})</Label>
                <Input id="po-amt" type="number" min={progress.outstandingPrincipal} step="0.01" value={payoff.amount} onChange={(e) => setPayoff({ ...payoff, amount: e.target.value })} className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-date">Paid on</Label>
                <Input id="po-date" type="date" max={localToday()} value={payoff.date} onChange={(e) => setPayoff({ ...payoff, date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Paid from</Label>
              <Select value={payoff.accountId} onValueChange={(v) => setPayoff({ ...payoff, accountId: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose account" /></SelectTrigger>
                <SelectContent>{accounts.filter((a) => a.currency === c).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayoffOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={payOff} disabled={busy || !payoff.accountId || !(Number(payoff.amount) + 0.004 >= progress.outstandingPrincipal)}>{busy ? "Paying…" : "Pay off & close"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <LoanDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onDone={load}
        editing={{ ...loan, linkedAccountId: loan.linkedAccount?.id ?? null, termsLocked: data.termsLocked }}
      />
    </div>
  );
}
