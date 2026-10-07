import { addMonthsUTC as addMonths } from "@/lib/dates";
import { roundMoney } from "@/lib/validate";

/** Standard reducing-balance EMI: EMI = P × r × (1+r)^n / ((1+r)^n − 1),
 * where r is the monthly rate. Falls back to a plain equal split when the
 * rate is 0 (division by zero otherwise). */
export function computeEmi(principal: number, annualRatePercent: number, installments: number): number {
  if (installments <= 0) return 0;
  const monthlyRate = annualRatePercent / 12 / 100;
  if (monthlyRate === 0) return principal / installments;
  const factor = Math.pow(1 + monthlyRate, installments);
  return (principal * monthlyRate * factor) / (factor - 1);
}

export function computeLoanEndDate(startDate: Date, installments: number): Date {
  return addMonths(startDate, installments);
}

export interface AmortizationRow {
  n: number;
  dueDate: Date;
  emi: number;
  interest: number;
  principal: number;
  balanceAfter: number;
}

/** Full month-by-month reducing-balance schedule, penny-exact: the EMI and
 * each month's interest are rounded to 2 decimals (as a lender would bill
 * them), and the last row's EMI absorbs the remaining drift so the balance
 * lands exactly on 0. */
export function amortizationSchedule(
  principal: number,
  annualRatePercent: number,
  installments: number,
  startDate: Date
): AmortizationRow[] {
  if (!(principal > 0) || installments <= 0) return [];
  const monthlyRate = annualRatePercent / 12 / 100;
  const emi = roundMoney(computeEmi(principal, annualRatePercent, installments));

  const rows: AmortizationRow[] = [];
  let balance = roundMoney(principal);
  for (let n = 1; n <= installments; n++) {
    const interest = roundMoney(balance * monthlyRate);
    let principalComponent = roundMoney(emi - interest);
    let thisEmi = emi;
    if (n === installments || principalComponent >= balance) {
      // clear the remainder exactly
      principalComponent = balance;
      thisEmi = roundMoney(balance + interest);
    }
    balance = Math.max(0, roundMoney(balance - principalComponent));
    rows.push({
      n,
      dueDate: addMonths(startDate, n),
      emi: thisEmi,
      interest,
      principal: principalComponent,
      balanceAfter: balance,
    });
  }
  return rows;
}

export interface LoanProgress {
  paidCount: number;
  totalInstallments: number;
  principalPaid: number;
  interestPaid: number;
  totalPaid: number;
  outstandingPrincipal: number;
  percentPaid: number;
  /** Next scheduled row that hasn't been paid yet, if any. */
  nextDue: AmortizationRow | null;
}

/** Derives loan progress from the recorded payments against the schedule. */
export function loanProgress(
  schedule: AmortizationRow[],
  payments: { principalComponent: number; interestComponent: number; amount: number }[]
): LoanProgress {
  const totalInstallments = schedule.length;
  const originalPrincipal = schedule.length ? schedule[0].balanceAfter + schedule[0].principal : 0;

  const principalPaid = payments.reduce((s, p) => s + Number(p.principalComponent), 0);
  const interestPaid = payments.reduce((s, p) => s + Number(p.interestComponent), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const outstandingPrincipal = Math.max(0, originalPrincipal - principalPaid);

  const paidCount = payments.length;
  const nextDue = schedule[paidCount] ?? null;

  return {
    paidCount,
    totalInstallments,
    principalPaid,
    interestPaid,
    totalPaid,
    outstandingPrincipal,
    percentPaid: totalInstallments ? Math.min(100, Math.round((paidCount / totalInstallments) * 100)) : 0,
    nextDue,
  };
}
