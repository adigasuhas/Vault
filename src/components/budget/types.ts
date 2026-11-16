import type { Occurrence } from "@/lib/schedules";

/** Shapes of /api/budget, as the Budget page reads them. */

export type SourceKind = "RECEIVABLE" | "ACCOUNT";
export type ReceivableState = "expected" | "due" | "overdue" | "received" | "failed" | "cancelled" | "gone";
export type SourceRef = { sourceId: string } | { receivable: { scheduleId: string; occurrenceDate: string } } | { accountId: string };

export interface LineFunding {
  sourceId: string;
  label: string;
  kind: SourceKind;
  amount: number;
  atRisk: boolean;
}

export interface Line {
  id: string | null;
  categoryId: string;
  categoryName: string;
  parentId: string | null;
  isRecurring: boolean;
  source: string;
  accountId: string | null;
  accountName: string | null;
  budgetAmount: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  scheduled: (Occurrence & { nativeAmount?: number; nativeCurrency?: string })[];
  scheduledTotal: number;
  funding: LineFunding[];
  funded: number;
  unfunded: number;
  loan: {
    id: string;
    name: string;
    currency: string;
    emi: number;
    repaid: number;
    payments: number;
    alsoBudgeted: { categoryId: string; name: string; amount: number } | null;
  } | null;
  paymentSchedule: { id: string; name: string; planned: number; paid: number; statuses: string[] } | null;
}

export interface Group {
  categoryId: string;
  name: string;
  lineId: string | null;
  own: number | null;
  breakdown: number;
  total: number;
  unassigned: number;
  over: number;
  spent: number;
  remaining: number;
  funded: number;
  unfunded: number;
  children: string[];
}

export interface Source {
  id: string;
  kind: SourceKind;
  label: string;
  amount: number;
  state: ReceivableState | null;
  date: string | null;
  scheduleId: string | null;
  occurrenceDate: string | null;
  accountId: string | null;
  native: { amount: number; currency: string } | null;
  allocated: number;
  unallocated: number;
  short: number;
  note: string | null;
}

export interface FundingOption {
  ref: SourceRef;
  key: string;
  kind: SourceKind;
  label: string;
  detail: string;
  state: ReceivableState | null;
  room: number;
  inPlan: boolean;
}

export interface Budget {
  month: string;
  currency: string;
  hasPlan: boolean;
  isPast: boolean;
  totalIncome: number;
  expectedIncome: number;
  totalBudgeted: number;
  totalSpent: number;
  oneTimeExcluded: number;
  lines: Line[];
  unbudgeted: Line[];
  groups: Group[];
  spentByCategory: Record<string, number>;
  sources: Source[];
  available: { total: number; received: number; expected: number; fromAccounts: number; short: number } | null;
  fundingOptions: FundingOption[];
  totalFunded: number;
  linkOptions: {
    loans: { id: string; name: string; currency: string; emi: number }[];
    paymentSchedules: { id: string; name: string; amount: number; currency: string }[];
  };
}

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  path: string;
  depth: 0 | 1;
  color: string | null;
  isDefault: boolean;
}

export interface Account {
  id: string;
  name: string;
  currency: string;
  status: string;
  currentBalance: string;
}

export const sourceKey = (s: Pick<Source, "kind" | "scheduleId" | "occurrenceDate" | "accountId" | "id">) =>
  s.kind === "RECEIVABLE" ? (s.scheduleId && s.occurrenceDate ? `R:${s.scheduleId}:${s.occurrenceDate}` : `S:${s.id}`) : s.accountId ? `A:${s.accountId}` : `S:${s.id}`;

export const STATE_LABEL: Record<ReceivableState, { label: string; tone: "outline" | "warning" | "positive" | "negative" | "neutral" }> = {
  expected: { label: "Expected", tone: "outline" },
  due: { label: "Due", tone: "warning" },
  overdue: { label: "Overdue", tone: "warning" },
  received: { label: "Received", tone: "positive" },
  failed: { label: "Not booked", tone: "negative" },
  cancelled: { label: "Cancelled", tone: "negative" },
  gone: { label: "No longer scheduled", tone: "negative" },
};
