import { db } from "@/lib/db";
import { createFxConverter, type FxConverter } from "@/lib/fx";
import { computePortfolioValue } from "@/lib/portfolio";
import { loadOccurrences, userToday, type Occurrence } from "@/lib/schedules";
import { addDaysUTC, isoDate, lastNMonths, monthKey, monthRange, shiftMonth } from "@/lib/dates";
import { isLiabilityAccount } from "@/lib/ledger";
import { loanLiabilities } from "@/lib/loan-balance";

/**
 * Everything Analytics, the Dashboard and Reports show is derived here from
 * two sources only: the ledger (what happened) and schedule projections (what
 * is committed to happen). Reversed entries and their REVERSAL rows cancel
 * out and are excluded from income/spend; transfers, opening balances and
 * adjustments move cash but are neither income nor spending.
 */

export interface MonthFlow {
  month: string;
  income: number;
  /** All spending: regular + oneTime. */
  expenses: number;
  /** Day-to-day and scheduled spending. */
  regular: number;
  /** One-time purchases (logged under Expenses → One-time). */
  oneTime: number;
  net: number;
  savingsRate: number | null;
}

/** Ledger filter: spending a monthly budget counts. One-time purchases are
 * left out unless the user opted that one in. */
export const COUNTS_IN_BUDGET = { OR: [{ oneTime: false }, { countInBudget: true }] };

export async function ledgerFlows(userId: string, months: string[], fx: FxConverter) {
  const { start } = monthRange(months[0]);
  const { end } = monthRange(months[months.length - 1]);
  const entries = await db.ledgerEntry.findMany({
    where: { userId, type: { in: ["INCOME", "EXPENSE"] }, reversedAt: null, date: { gte: start, lt: end } },
    select: {
      type: true,
      amount: true,
      currency: true,
      date: true,
      description: true,
      categoryId: true,
      oneTime: true,
      expense: { select: { project: { select: { id: true, name: true } } } },
      category: { select: { name: true } },
      creditExecution: { select: { scheduledCredit: { select: { name: true, kind: true } } } },
    },
  });

  const byMonth = new Map(months.map((m) => [m, { income: 0, expenses: 0, oneTime: 0 }]));
  const oneTimeByGroup = new Map<string, { name: string; total: number; count: number }>();
  const byCategory = new Map<string, { name: string; total: number; months: Map<string, number> }>();
  const incomeBySource = new Map<string, number>();
  for (const e of entries) {
    const m = monthKey(e.date);
    const bucket = byMonth.get(m);
    if (!bucket) continue;
    const v = fx.convert(Number(e.amount), e.currency);
    if (e.type === "INCOME") {
      bucket.income += v;
      const src = e.creditExecution?.scheduledCredit.name ?? e.description ?? "Other income";
      incomeBySource.set(src, (incomeBySource.get(src) ?? 0) + v);
    } else if (e.oneTime) {
      // One-offs count toward total spending but stay out of the
      // per-category picture of regular spending.
      bucket.expenses += v;
      bucket.oneTime += v;
      const p = e.expense?.project;
      const g = oneTimeByGroup.get(p?.id ?? "_none") ?? { name: p?.name ?? "Not in a group", total: 0, count: 0 };
      g.total += v;
      g.count++;
      oneTimeByGroup.set(p?.id ?? "_none", g);
    } else {
      bucket.expenses += v;
      const key = e.categoryId ?? "_none";
      const c = byCategory.get(key) ?? { name: e.category?.name ?? "Uncategorised", total: 0, months: new Map() };
      c.total += v;
      c.months.set(m, (c.months.get(m) ?? 0) + v);
      byCategory.set(key, c);
    }
  }
  const flows: MonthFlow[] = months.map((m) => {
    const b = byMonth.get(m)!;
    const net = b.income - b.expenses;
    return { month: m, income: b.income, expenses: b.expenses, regular: b.expenses - b.oneTime, oneTime: b.oneTime, net, savingsRate: b.income > 0 ? Math.round((net / b.income) * 1000) / 10 : null };
  });
  const categories = [...byCategory.entries()]
    .map(([id, c]) => ({ id, name: c.name, total: c.total, byMonth: months.map((m) => c.months.get(m) ?? 0) }))
    .sort((a, b) => b.total - a.total);
  const sources = [...incomeBySource.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const oneTimeGroups = [...oneTimeByGroup.entries()].map(([id, g]) => ({ id, ...g })).sort((a, b) => b.total - a.total);
  return { flows, categories, sources, oneTimeGroups };
}

/** Liquid cash = balances of every open account (cards count negative when
 * they carry a balance owed). `owed` = card balances owed + outstanding loan
 * principal; `loanDebt` is the loan part, which isn't in `cash` (a loan is not
 * an account) and so must be subtracted separately for net worth. */
export async function cashPosition(userId: string, fx: FxConverter) {
  const [accounts, loanDebt] = await Promise.all([
    db.account.findMany({ where: { userId, status: { not: "CLOSED" } }, orderBy: { createdAt: "asc" } }),
    loanLiabilities(userId, fx),
  ]);
  const rows = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.accountType,
    status: a.status,
    currency: a.currency,
    balance: Number(a.currentBalance),
    base: fx.convert(Number(a.currentBalance), a.currency),
    liability: isLiabilityAccount(a.accountType),
  }));
  const cash = rows.reduce((s, r) => s + r.base, 0);
  const cardOwed = rows.filter((r) => r.liability && r.base < 0).reduce((s, r) => s - r.base, 0);
  return { accounts: rows, cash, owed: cardOwed + loanDebt.total, loanDebt: loanDebt.total, loans: loanDebt.loans };
}

export interface RunwayResult {
  currentCash: number;
  monthlyIncome: number; // average over the next 12 months of scheduled income
  monthlyCommitted: number; // average scheduled payments
  monthlyDiscretionary: number; // average recent non-scheduled spending
  monthlyNet: number; // income − committed − discretionary
  runwayMonths: number | null; // null = cash never runs out in the horizon / cash-flow positive
  runsOutMonth: string | null;
  basis: "recent-average" | "budget" | "none";
  projection: { month: string; cash: number; stress: number; income: number; outflow: number }[];
}

/**
 * Funding runway — "does my funding cover me". Projects cash month by month
 * using the actual schedule (real dates and amounts, so a quarterly stipend
 * lands in the months it really arrives), plus average discretionary
 * spending from the last three complete months (or this month's budget when
 * there's no history). A stress line assumes income arrives 25% short.
 */
export async function computeRunway(userId: string, fx: FxConverter, cash: number): Promise<RunwayResult> {
  const today = await userToday(userId);
  const current = monthKey(today);
  const recent = [1, 2, 3].map((b) => shiftMonth(current, -b));
  const { start: recentStart } = monthRange(recent[2]);
  const { start: currentStart } = monthRange(current);

  const [spend, plan] = await Promise.all([
    db.ledgerEntry.findMany({
      // One-time purchases don't recur, so they don't shape the runway.
      where: { userId, type: "EXPENSE", reversedAt: null, oneTime: false, creditExecutionId: null, loanPaymentId: null, date: { gte: recentStart, lt: currentStart } },
      select: { amount: true, currency: true, date: true },
    }),
    db.budgetPlan.findUnique({ where: { userId_month: { userId, month: current } }, include: { allocations: { include: { category: { select: { schedules: { select: { id: true }, where: { direction: "PAYMENT", isActive: true } } } } } } } }),
  ]);
  const perMonth = new Map<string, number>();
  for (const e of spend) perMonth.set(monthKey(e.date), (perMonth.get(monthKey(e.date)) ?? 0) + fx.convert(Number(e.amount), e.currency));
  const observed = recent.map((m) => perMonth.get(m)).filter((v): v is number => v != null && v > 0);
  let discretionary = 0;
  let basis: RunwayResult["basis"] = "none";
  if (observed.length) {
    discretionary = observed.reduce((a, b) => a + b, 0) / observed.length;
    basis = "recent-average";
  } else if (plan?.allocations.length) {
    // Budget lines that aren't covered by a scheduled payment.
    discretionary = plan.allocations.filter((a) => a.category.schedules.length === 0).reduce((s, a) => s + Number(a.budgetAmount), 0);
    basis = "budget";
  }

  const horizon = 18;
  const months = Array.from({ length: horizon }, (_, i) => shiftMonth(current, i + 1));
  const occ = await loadOccurrences(userId, addDaysUTC(today, 1), monthRange(months[months.length - 1]).end);
  // Pending/failed items are still owed/expected — fold them into next month.
  const outstanding = await loadOccurrences(userId, addDaysUTC(today, -400), today);
  const inByMonth = new Map<string, number>();
  const outByMonth = new Map<string, number>();
  const add = (map: Map<string, number>, m: string, v: number) => map.set(m, (map.get(m) ?? 0) + v);
  for (const o of occ) {
    if (o.status === "SKIPPED" || o.status === "REVERSED" || o.status === "CONFIRMED") continue;
    const m = o.date.slice(0, 7) === current ? months[0] : o.date.slice(0, 7);
    add(o.direction === "INCOME" ? inByMonth : outByMonth, m, fx.convert(o.amount, o.currency));
  }
  for (const o of outstanding) {
    if (o.status !== "PENDING" && o.status !== "FAILED") continue;
    add(o.direction === "INCOME" ? inByMonth : outByMonth, months[0], fx.convert(o.amount, o.currency));
  }

  let running = cash;
  let stress = cash;
  let runsOutMonth: string | null = null;
  let runwayMonths: number | null = null;
  const projection: RunwayResult["projection"] = [];
  months.forEach((m, i) => {
    const income = inByMonth.get(m) ?? 0;
    const outflow = (outByMonth.get(m) ?? 0) + discretionary;
    const before = running;
    running += income - outflow;
    stress += income * 0.75 - outflow;
    projection.push({ month: m, cash: running, stress, income, outflow });
    if (running < 0 && runsOutMonth == null) {
      runsOutMonth = m;
      const drop = before - running;
      runwayMonths = i + (drop > 0 ? Math.max(0, before) / drop : 0);
    }
  });
  const sum = (map: Map<string, number>) => months.slice(0, 12).reduce((s, m) => s + (map.get(m) ?? 0), 0) / 12;
  const monthlyIncome = sum(inByMonth);
  const monthlyCommitted = sum(outByMonth);
  const monthlyNet = monthlyIncome - monthlyCommitted - discretionary;
  if (runwayMonths == null && monthlyNet < 0 && cash > 0) runwayMonths = cash / -monthlyNet;

  return {
    currentCash: cash,
    monthlyIncome,
    monthlyCommitted,
    monthlyDiscretionary: discretionary,
    monthlyNet,
    runwayMonths,
    runsOutMonth,
    basis,
    projection,
  };
}

/** Budget adherence per month: what was planned vs spent, from plans that
 * exist (months with no plan are reported as such, not as zero budgets). */
export async function budgetAdherence(userId: string, months: string[], fx: FxConverter) {
  const plans = await db.budgetPlan.findMany({
    where: { userId, month: { in: months } },
    include: { allocations: { include: { category: { select: { name: true } } } } },
  });
  const { start } = monthRange(months[0]);
  const { end } = monthRange(months[months.length - 1]);
  const spend = await db.ledgerEntry.findMany({
    where: { userId, type: "EXPENSE", reversedAt: null, date: { gte: start, lt: end }, ...COUNTS_IN_BUDGET },
    select: { amount: true, currency: true, date: true, categoryId: true },
  });
  const spentBy = new Map<string, number>();
  for (const e of spend) {
    const k = `${monthKey(e.date)}|${e.categoryId}`;
    spentBy.set(k, (spentBy.get(k) ?? 0) + fx.convert(Number(e.amount), e.currency));
  }
  return months.map((m) => {
    const plan = plans.find((p) => p.month === m);
    if (!plan) return { month: m, hasPlan: false, budgeted: 0, spentInBudget: 0, overCount: 0, lines: [] as { name: string; budgeted: number; spent: number }[] };
    const lines = plan.allocations.map((a) => ({
      name: a.category.name,
      // Plans can be in any currency; adherence is reported in primary.
      budgeted: fx.convert(Number(a.budgetAmount), plan.currency),
      spent: spentBy.get(`${m}|${a.categoryId}`) ?? 0,
    }));
    return {
      month: m,
      hasPlan: true,
      budgeted: lines.reduce((s, l) => s + l.budgeted, 0),
      spentInBudget: lines.reduce((s, l) => s + l.spent, 0),
      overCount: lines.filter((l) => l.budgeted > 0 && l.spent > l.budgeted).length,
      lines: lines.sort((a, b) => b.budgeted - a.budgeted),
    };
  });
}

export async function upcoming(userId: string, days: number) {
  const today = await userToday(userId);
  const occ = await loadOccurrences(userId, addDaysUTC(today, -400), addDaysUTC(today, days));
  const actionable = occ.filter((o) => o.status === "PENDING" || o.status === "FAILED");
  const scheduled = occ.filter((o) => o.status === "SCHEDULED" && o.date > isoDate(today));
  return { today, actionable, scheduled };
}

export async function overview(userId: string, monthsBack: number) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } });
  const fx = await createFxConverter(userId, user.baseCurrency);
  const today = await userToday(userId);
  const months = lastNMonths(monthsBack, monthKey(today));
  const [flowData, position, portfolio, adherence, next] = await Promise.all([
    ledgerFlows(userId, months, fx),
    cashPosition(userId, fx),
    computePortfolioValue(userId, user.baseCurrency, fx),
    budgetAdherence(userId, months, fx),
    upcoming(userId, 60),
  ]);
  const runway = await computeRunway(userId, fx, position.cash);
  // Cash already nets card debt; loans are subtracted here.
  const netWorth = position.cash + portfolio.total - position.loanDebt;
  return { baseCurrency: user.baseCurrency, fx, today, months, ...flowData, position, portfolio, netWorth, adherence, next, runway };
}

export type { Occurrence };
