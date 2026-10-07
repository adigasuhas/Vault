"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client";
import { formatMoney } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { PageHeader, Section, EmptyState, SkeletonBlock } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { SchedulesBoard } from "@/components/schedules/SchedulesBoard";
import { Button } from "@/components/ui/button";
import { Landmark, Plus } from "lucide-react";
import { LoanDialog } from "@/components/loans/LoanDialog";
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
