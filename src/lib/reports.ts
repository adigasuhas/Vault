import { db } from "@/lib/db";
import { createFxConverter } from "@/lib/fx";
import { ledgerFlows, budgetAdherence } from "@/lib/insights";
import { loadOccurrences } from "@/lib/schedules";
import { signedAmount } from "@/lib/ledger";
import { isoDate, monthLabel, monthRange, monthsBetween } from "@/lib/dates";
import { ValidationError } from "@/lib/validate";

/**
 * Every report is built here as plain tabular data from the ledger (and
 * schedules for the recurring report). The Reports page previews it, and the
 * CSV and PDF exports render the very same object — so a download can never
 * disagree with what was on screen.
 */

export type ColumnKind = "text" | "date" | "money" | "pct" | "number" | "status";
export interface ReportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
}
export interface Report {
  type: ReportType;
  title: string;
  subtitle: string;
  currency: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
  summary: { label: string; value: number | string; kind: ColumnKind }[];
  notes?: string[];
}

export const REPORT_TYPES = [
  "summary",
  "categories",
  "one_time",
  "statement",
  "budget",
  "savings",
  "recurring",
  "cashflow",
  "ledger",
  "activity",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportParams {
  from: string; // YYYY-MM
  to: string; // YYYY-MM
  accountId?: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  EXPENSE: "Expense",
  INCOME: "Income",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  ADJUSTMENT: "Adjustment",
  OPENING: "Opening balance",
  REVERSAL: "Reversal",
  INVESTMENT_SALE: "Investment sale",
};

export async function buildReport(userId: string, type: ReportType, p: ReportParams): Promise<Report> {
  if (p.from > p.to) throw new ValidationError("The start month is after the end month.");
  const months = monthsBetween(p.from, p.to);
  // Month-by-month aggregations are capped at 5 years. A single account's
  // statement is a plain list of entries, so it may span the account's whole
  // life (the account page links to "since opening").
  if (type !== "statement" && months.length > 60) throw new ValidationError("Pick a range of at most 5 years.");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } });
  const currency = user.baseCurrency;
  const fx = await createFxConverter(userId, currency);
  const start = monthRange(p.from).start;
  const end = monthRange(p.to).end;
  const period = p.from === p.to ? monthLabel(p.from) : `${monthLabel(p.from, "short")} – ${monthLabel(p.to, "short")}`;
  const base = { type, currency, subtitle: period };

  switch (type) {
    case "summary": {
      const { flows } = await ledgerFlows(userId, months, fx);
      const income = flows.reduce((s, f) => s + f.income, 0);
      const expenses = flows.reduce((s, f) => s + f.expenses, 0);
      const regular = flows.reduce((s, f) => s + f.regular, 0);
      const oneTime = flows.reduce((s, f) => s + f.oneTime, 0);
      return {
        ...base,
        title: "Income & expense summary",
        columns: [
          { key: "month", label: "Month", kind: "text" },
          { key: "income", label: "Income", kind: "money" },
          { key: "regular", label: "Monthly spending", kind: "money" },
          { key: "oneTime", label: "One-time", kind: "money" },
          { key: "expenses", label: "Total spent", kind: "money" },
          { key: "net", label: "Net", kind: "money" },
          { key: "rate", label: "Savings rate", kind: "pct" },
        ],
        rows: flows.map((f) => ({ month: monthLabel(f.month, "short"), income: f.income, regular: f.regular, oneTime: f.oneTime, expenses: f.expenses, net: f.net, rate: f.savingsRate })),
        totals: { month: "Total", income, regular, oneTime, expenses, net: income - expenses, rate: income > 0 ? Math.round(((income - expenses) / income) * 1000) / 10 : null },
        summary: [
          { label: "Income", value: income, kind: "money" },
          { label: "Monthly spending", value: regular, kind: "money" },
          { label: "One-time", value: oneTime, kind: "money" },
          { label: "Net saved", value: income - expenses, kind: "money" },
        ],
        notes: ["Transfers between your own accounts are neither income nor spending. Reversed entries are excluded. Total spent = monthly spending + one-time purchases."],
      };
    }

    case "categories": {
      const { categories } = await ledgerFlows(userId, months, fx);
      const counts = await db.ledgerEntry.groupBy({
        by: ["categoryId"],
        where: { userId, type: "EXPENSE", reversedAt: null, oneTime: false, date: { gte: start, lt: end } },
        _count: { _all: true },
      });
      const countBy = new Map(counts.map((c) => [c.categoryId ?? "_none", c._count._all]));
      const total = categories.reduce((s, c) => s + c.total, 0);
      return {
        ...base,
        title: "Monthly spending by category",
        notes: ["One-time purchases are left out here so a big one-off doesn't skew your averages. See the One-time purchases report for those."],
        columns: [
          { key: "category", label: "Category", kind: "text" },
          { key: "count", label: "Entries", kind: "number" },
          { key: "avg", label: "Monthly average", kind: "money" },
          { key: "share", label: "Share", kind: "pct" },
          { key: "total", label: "Total", kind: "money" },
        ],
        rows: categories.map((c) => ({
          category: c.name,
          count: countBy.get(c.id) ?? 0,
          avg: c.total / months.length,
          share: total > 0 ? Math.round((c.total / total) * 1000) / 10 : 0,
          total: c.total,
        })),
        totals: { category: "Total", count: [...countBy.values()].reduce((a, b) => a + b, 0), avg: total / months.length, share: 100, total },
        summary: [
          { label: "Total spent", value: total, kind: "money" },
          { label: "Categories", value: categories.length, kind: "number" },
          { label: "Largest", value: categories[0]?.name ?? "–", kind: "text" },
        ],
      };
    }

    case "one_time": {
      const items = await db.expense.findMany({
        where: { userId, oneTime: true, voidedAt: null, date: { gte: start, lt: end } },
        include: { account: { select: { name: true } }, category: { select: { name: true } }, project: { select: { name: true } } },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      });
      const rows = items.map((e) => ({
        date: isoDate(e.date),
        group: e.project?.name ?? "",
        description: e.description ?? "",
        category: e.category.name,
        account: e.account?.name ?? "Not specified",
        native: `${e.currency} ${Number(e.amount).toFixed(2)}`,
        budget: e.countInBudget ? "Counted" : "Not counted",
        amount: fx.convert(Number(e.amount), e.currency),
      }));
      const total = rows.reduce((s, r) => s + r.amount, 0);
      const groups = new Set(items.map((e) => e.project?.name).filter(Boolean));
      return {
        ...base,
        title: "One-time purchases",
        columns: [
          { key: "date", label: "Date", kind: "date" },
          { key: "group", label: "Group", kind: "text" },
          { key: "description", label: "What", kind: "text" },
          { key: "category", label: "Category", kind: "text" },
          { key: "account", label: "Paid from", kind: "text" },
          { key: "native", label: "Paid", kind: "text" },
          { key: "budget", label: "Budget", kind: "text" },
          { key: "amount", label: "Amount", kind: "money" },
        ],
        rows,
        totals: { date: "Total", amount: total },
        summary: [
          { label: "Total", value: total, kind: "money" },
          { label: "Purchases", value: rows.length, kind: "number" },
          { label: "Groups", value: groups.size, kind: "number" },
        ],
        notes: ["One-off purchases logged under Expenses → One-time. They reduce your balances like any expense but stay off monthly budgets unless you chose to count them."],
      };
    }

    case "statement": {
      if (!p.accountId) throw new ValidationError("Choose an account for the statement.");
      const account = await db.account.findFirst({ where: { id: p.accountId, userId } });
      if (!account) throw new ValidationError("Account not found.");
      const entries = await db.ledgerEntry.findMany({
        where: { accountId: account.id, date: { lt: end } },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        include: { category: { select: { name: true } }, transfer: { select: { fromAccountId: true, fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } } } },
      });
      // Running totals in integer cents so long histories can't drift.
      let balanceCents = 0;
      let openingCents = 0;
      let inflowCents = 0;
      let outflowCents = 0;
      const rows: Report["rows"] = [];
      for (const e of entries) {
        const v = signedAmount(e.type, Number(e.amount));
        const c = Math.round(v * 100);
        if (e.date < start) {
          balanceCents += c;
          openingCents = balanceCents;
          continue;
        }
        balanceCents += c;
        if (c >= 0) inflowCents += c;
        else outflowCents -= c;
        const balance = balanceCents / 100;
        const counterparty = e.transfer ? (e.transfer.fromAccountId === account.id ? `to ${e.transfer.toAccount.name}` : `from ${e.transfer.fromAccount.name}`) : null;
        rows.push({
          date: isoDate(e.date),
          description: [e.description || e.category?.name || TYPE_LABEL[e.type], counterparty].filter(Boolean).join(" · "),
          type: TYPE_LABEL[e.type] + (e.reversedAt ? " (reversed)" : ""),
          in: v > 0 ? v : null,
          out: v < 0 ? -v : null,
          balance,
        });
      }
      return {
        ...base,
        currency: account.currency,
        title: `Statement: ${account.name}`,
        columns: [
          { key: "date", label: "Date", kind: "date" },
          { key: "description", label: "Description", kind: "text" },
          { key: "type", label: "Type", kind: "text" },
          { key: "in", label: "In", kind: "money" },
          { key: "out", label: "Out", kind: "money" },
          { key: "balance", label: "Balance", kind: "money" },
        ],
        rows,
        summary: [
          { label: "Opening", value: openingCents / 100, kind: "money" },
          { label: "Money in", value: inflowCents / 100, kind: "money" },
          { label: "Money out", value: outflowCents / 100, kind: "money" },
          { label: "Closing", value: balanceCents / 100, kind: "money" },
        ],
        notes: ["Reversed entries are shown together with the reversal that cancelled them."],
      };
    }

    case "budget": {
      const adherence = await budgetAdherence(userId, months, fx);
      const rows: Report["rows"] = [];
      let budgeted = 0;
      let spent = 0;
      for (const m of adherence) {
        if (!m.hasPlan) {
          rows.push({ month: monthLabel(m.month, "short"), category: "No budget set", budgeted: null, spent: null, variance: null, used: null });
          continue;
        }
        for (const l of m.lines) {
          budgeted += l.budgeted;
          spent += l.spent;
          rows.push({
            month: monthLabel(m.month, "short"),
            category: l.name,
            budgeted: l.budgeted,
            spent: l.spent,
            variance: l.budgeted - l.spent,
            used: l.budgeted > 0 ? Math.round((l.spent / l.budgeted) * 1000) / 10 : null,
          });
        }
      }
      return {
        ...base,
        title: "Budget vs actual",
        columns: [
          { key: "month", label: "Month", kind: "text" },
          { key: "category", label: "Category", kind: "text" },
          { key: "budgeted", label: "Budgeted", kind: "money" },
          { key: "spent", label: "Spent", kind: "money" },
          { key: "variance", label: "Left / over", kind: "money" },
          { key: "used", label: "Used", kind: "pct" },
        ],
        rows,
        totals: { month: "Total", category: "", budgeted, spent, variance: budgeted - spent, used: budgeted > 0 ? Math.round((spent / budgeted) * 1000) / 10 : null },
        summary: [
          { label: "Budgeted", value: budgeted, kind: "money" },
          { label: "Spent in budgeted categories", value: spent, kind: "money" },
          { label: "Lines over budget", value: adherence.reduce((s, m) => s + m.overCount, 0), kind: "number" },
        ],
      };
    }

    case "savings": {
      const { flows } = await ledgerFlows(userId, months, fx);
      let cumulative = 0;
      const rows = flows.map((f) => {
        cumulative += f.net;
        return { month: monthLabel(f.month, "short"), income: f.income, expenses: f.expenses, saved: f.net, rate: f.savingsRate, cumulative };
      });
      const income = flows.reduce((s, f) => s + f.income, 0);
      const rated = flows.filter((f) => f.savingsRate != null);
      return {
        ...base,
        title: "Savings",
        columns: [
          { key: "month", label: "Month", kind: "text" },
          { key: "income", label: "Income", kind: "money" },
          { key: "expenses", label: "Expenses", kind: "money" },
          { key: "saved", label: "Saved", kind: "money" },
          { key: "rate", label: "Rate", kind: "pct" },
          { key: "cumulative", label: "Cumulative", kind: "money" },
        ],
        rows,
        summary: [
          { label: "Saved in period", value: cumulative, kind: "money" },
          { label: "Overall rate", value: income > 0 ? Math.round((cumulative / income) * 1000) / 10 : 0, kind: "pct" },
          { label: "Months saving", value: `${rated.filter((f) => f.net > 0).length} of ${flows.length}`, kind: "text" },
        ],
      };
    }

    case "recurring": {
      const occ = await loadOccurrences(userId, start, new Date(end.getTime() - 86_400_000));
      const schedules = await db.scheduledCredit.findMany({ where: { userId }, select: { id: true, receivingAccount: { select: { name: true } } } });
      const acct = new Map(schedules.map((s) => [s.id, s.receivingAccount?.name ?? "Not set"]));
      const label: Record<string, string> = { SCHEDULED: "Scheduled", PENDING: "Awaiting confirmation", CONFIRMED: "Booked", SKIPPED: "Skipped", FAILED: "Failed", REVERSED: "Reversed" };
      const booked = (d: "INCOME" | "PAYMENT") => occ.filter((o) => o.direction === d && o.status === "CONFIRMED").reduce((s, o) => s + fx.convert(o.amount, o.currency), 0);
      return {
        ...base,
        title: "Recurring income & payments",
        columns: [
          { key: "date", label: "Date", kind: "date" },
          { key: "name", label: "Schedule", kind: "text" },
          { key: "direction", label: "Direction", kind: "text" },
          { key: "account", label: "Account", kind: "text" },
          { key: "status", label: "Status", kind: "status" },
          { key: "amount", label: "Amount", kind: "money" },
        ],
        rows: occ.map((o) => ({
          date: o.date,
          name: o.scheduleName + (o.overridden ? " (moved)" : ""),
          direction: o.direction === "INCOME" ? "Income" : "Payment",
          account: acct.get(o.scheduleId) ?? "",
          status: label[o.status],
          amount: o.direction === "INCOME" ? fx.convert(o.amount, o.currency) : -fx.convert(o.amount, o.currency),
        })),
        summary: [
          { label: "Received", value: booked("INCOME"), kind: "money" },
          { label: "Paid", value: booked("PAYMENT"), kind: "money" },
          { label: "Skipped / failed", value: occ.filter((o) => o.status === "SKIPPED" || o.status === "FAILED").length, kind: "number" },
        ],
      };
    }

    case "cashflow": {
      const entries = await db.ledgerEntry.findMany({
        // Purchases logged without an account move no cash.
        where: { userId, accountId: { not: null }, date: { lt: end } },
        select: { type: true, amount: true, currency: true, date: true, transferId: true },
        orderBy: { date: "asc" },
      });
      const byMonth = new Map(months.map((m) => [m, { inflow: 0, outflow: 0, internal: 0 }]));
      let cash = 0;
      let openingCash = 0;
      for (const e of entries) {
        const v = fx.convert(signedAmount(e.type, Number(e.amount)), e.currency);
        cash += v;
        if (e.date < start) {
          openingCash = cash;
          continue;
        }
        const b = byMonth.get(isoDate(e.date).slice(0, 7));
        if (!b) continue;
        if (e.transferId) b.internal += v; // moves between own accounts (≈0, FX aside)
        else if (v >= 0) b.inflow += v;
        else b.outflow -= v;
      }
      let running = openingCash;
      const rows = months.map((m) => {
        const b = byMonth.get(m)!;
        const opening = running;
        running = opening + b.inflow - b.outflow + b.internal;
        return { month: monthLabel(m, "short"), opening, inflow: b.inflow, outflow: b.outflow, net: b.inflow - b.outflow, closing: running };
      });
      return {
        ...base,
        title: "Cash-flow history",
        columns: [
          { key: "month", label: "Month", kind: "text" },
          { key: "opening", label: "Opening cash", kind: "money" },
          { key: "inflow", label: "Inflow", kind: "money" },
          { key: "outflow", label: "Outflow", kind: "money" },
          { key: "net", label: "Net", kind: "money" },
          { key: "closing", label: "Closing cash", kind: "money" },
        ],
        rows,
        summary: [
          { label: "Opening cash", value: openingCash, kind: "money" },
          { label: "Closing cash", value: running, kind: "money" },
          { label: "Change", value: running - openingCash, kind: "money" },
        ],
        notes: ["Cash is the sum of all your account balances, including closed accounts up to their closure. Opening balances and adjustments count as inflow/outflow in the month they were posted."],
      };
    }

    case "ledger": {
      const entries = await db.ledgerEntry.findMany({
        where: { userId, date: { gte: start, lt: end }, ...(p.accountId ? { accountId: p.accountId } : {}) },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        include: { account: { select: { name: true } }, category: { select: { name: true } } },
      });
      return {
        ...base,
        title: "Ledger export",
        columns: [
          { key: "date", label: "Date", kind: "date" },
          { key: "account", label: "Account", kind: "text" },
          { key: "type", label: "Type", kind: "text" },
          { key: "category", label: "Category", kind: "text" },
          { key: "description", label: "Description", kind: "text" },
          { key: "kind", label: "Spending", kind: "text" },
          { key: "currency", label: "Currency", kind: "text" },
          { key: "amount", label: "Amount", kind: "money" },
          { key: "state", label: "State", kind: "status" },
          { key: "id", label: "Entry ID", kind: "text" },
        ],
        rows: entries.map((e) => ({
          date: isoDate(e.date),
          account: e.account?.name ?? "No account",
          type: TYPE_LABEL[e.type],
          category: e.category?.name ?? "",
          description: e.description ?? "",
          kind: e.type === "EXPENSE" || (e.type === "REVERSAL" && e.categoryId) ? (e.oneTime ? "One-time" : "Monthly") : "",
          currency: e.currency,
          amount: signedAmount(e.type, Number(e.amount)),
          state: e.reversedAt ? "Reversed" : e.type === "REVERSAL" ? "Reversal" : "Posted",
          id: e.id,
        })),
        summary: [
          { label: "Entries", value: entries.length, kind: "number" },
          { label: "Reversed", value: entries.filter((e) => e.reversedAt).length, kind: "number" },
        ],
        notes: ["Amounts are signed in each account's own currency. Nothing is ever deleted from the ledger: reversals appear as separate entries."],
      };
    }

    case "activity": {
      const events = await db.auditEvent.findMany({
        where: { userId, createdAt: { gte: start, lt: end } },
        orderBy: { createdAt: "desc" },
        take: 2000,
      });
      return {
        ...base,
        title: "Activity log",
        columns: [
          { key: "when", label: "When", kind: "date" },
          { key: "action", label: "Action", kind: "text" },
          { key: "summary", label: "What happened", kind: "text" },
        ],
        rows: events.map((e) => ({ when: e.createdAt.toISOString().slice(0, 16).replace("T", " "), action: e.action, summary: e.summary })),
        summary: [{ label: "Events", value: events.length, kind: "number" }],
        notes: ["Closures, reversals, removed expenses, skipped payments and schedule or budget changes are all logged here."],
      };
    }
  }
}

export function reportToCsv(r: Report): string {
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [r.columns.map((c) => esc(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(row[c.key])).join(","));
  if (r.totals) lines.push(r.columns.map((c) => esc(r.totals![c.key])).join(","));
  return "﻿" + lines.join("\n") + "\n";
}
