import { addMonthsUTC as addMonths } from "@/lib/dates";
import { roundMoney, ValidationError } from "@/lib/validate";

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

/** Date of the last EMI. A loan's start date is its first EMI's due date. */
export function computeLoanEndDate(startDate: Date, installments: number): Date {
  return addMonths(startDate, Math.max(0, installments - 1));
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
 * lands exactly on 0.
 *
 * `emiOverride` replaces the computed EMI (the user set their own). A larger
 * EMI clears the loan early — the schedule then has fewer rows than
 * `installments`; a smaller one leaves a bigger final installment. */
export function amortizationSchedule(
  principal: number,
  annualRatePercent: number,
  installments: number,
  startDate: Date,
  emiOverride?: number
): AmortizationRow[] {
  if (!(principal > 0) || installments <= 0) return [];
  const monthlyRate = annualRatePercent / 12 / 100;
  const emi = roundMoney(emiOverride && emiOverride > 0 ? emiOverride : computeEmi(principal, annualRatePercent, installments));

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
      dueDate: addMonths(startDate, n - 1),
      emi: thisEmi,
      interest,
      principal: principalComponent,
      balanceAfter: balance,
    });
    if (balance === 0) break;
  }
  return rows;
}

/** A stored loan's schedule, using the EMI it was created with (which may be
 * the user's own figure rather than the computed one). */
export function loanAmortization(loan: { principal: unknown; interestRate: unknown; installments: number; startDate: Date; emiAmount: unknown }) {
  return amortizationSchedule(Number(loan.principal), Number(loan.interestRate), loan.installments, loan.startDate, Number(loan.emiAmount));
}

/** Whole months from `start` to `end`. A loan with its first EMI on `start`
 * and its last on `end` has monthsBetween + 1 EMIs. */
export function monthsBetween(start: Date, end: Date): number {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
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

/** Validated loan terms: the EMI (the user's own, or computed — an equal
 * split at 0%), the number of installments it actually takes, and the date of
 * the last one. */
export function resolveLoanTerms(input: { principal: number; interestRate: number; installments: number; startDate: Date; emiAmount?: number | null }) {
  const emiAmount = roundMoney(input.emiAmount ?? computeEmi(input.principal, input.interestRate, input.installments));
  const firstInterest = roundMoney((input.principal * input.interestRate) / 1200);
  if (emiAmount <= firstInterest) throw new ValidationError("The EMI has to be more than the month's interest, or the loan never gets paid down.");
  // A larger EMI clears the loan in fewer months than asked for.
  const installments = amortizationSchedule(input.principal, input.interestRate, input.installments, input.startDate, emiAmount).length;
  return { emiAmount, installments, endDate: computeLoanEndDate(input.startDate, installments) };
}
