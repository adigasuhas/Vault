export function maskAccountNumber(accountNumber?: string | null) {
  if (!accountNumber) return "–";
  const last4 = accountNumber.slice(-4);
  return `•••• ${last4}`;
}

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  SAVINGS: "Savings",
  CURRENT: "Current",
  FIXED_DEPOSIT: "Fixed Deposit",
  CREDIT_CARD: "Credit Card",
  CASH_WALLET: "Cash Wallet",
  DIGITAL_WALLET: "Digital Wallet",
  LOAN: "Loan",
  PREPAID_CARD: "Prepaid Card",
  FOREX_CARD: "Forex Card",
};

/** Formats a date defensively — a single bad value (null from the API, a
 * corrupted/out-of-range timestamp, whatever) should never crash an entire
 * page just to render one row's date. */
export function formatDate(date: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (date == null) return "–";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "–";
  // Money dates are calendar dates stored at UTC midnight — render them in UTC
  // or a viewer west of Greenwich sees the previous day.
  return d.toLocaleDateString("en-IN", { timeZone: "UTC", ...(options ?? { day: "2-digit", month: "short", year: "numeric" }) });
}
