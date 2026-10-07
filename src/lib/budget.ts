import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { roundMoney, ValidationError } from "@/lib/validate";
import { ensureDefaultCategories } from "@/lib/defaults";
import { loadOccurrences, syncScheduledBudgets, userToday, type Occurrence } from "@/lib/schedules";
import { monthKey, monthRange } from "@/lib/dates";
import { createFxConverter, type FxConverter } from "@/lib/fx";
import { audit, type Tx } from "@/lib/ledger";

/**
 * Budgets are per month. A month's plan holds the allocations that apply to
 * *that* month only:
 *  - categories added for the month (source MANUAL),
 *  - recurring categories (Category.isDefault), but only from the month they
 *    became recurring (`defaultSince`) — never back-filled into the past,
 *  - categories sized from scheduled payments due that month (SCHEDULE).
 *
 * Plans for the current and future months are materialised on first view.
 * Past months are read-only history: viewing one never creates a plan or
 * adds allocations, so a budget made in October doesn't appear in March.
 *
 * Spending always comes from the ledger (EXPENSE entries that haven't been
 * reversed), so expenses, scheduled payments and EMIs all count.
 */

export async function ensureMonthPlan(userId: string, month: string) {
  const today = await userToday(userId);
  const current = monthKey(today);
  if (month < current) {
    return db.budgetPlan.findUnique({ where: { userId_month: { userId, month } } });
  }
  await ensureDefaultCategories(userId);
  const owner = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } });
  const fxOutside = await createFxConverter(userId, owner.baseCurrency);
  try {
    return await createOrSyncPlan(userId, month, fxOutside);
  } catch (err) {
    // Two requests opening a new month at once: the other one created it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return db.budgetPlan.findUniqueOrThrow({ where: { userId_month: { userId, month } } });
    }
    throw err;
  }
}

async function createOrSyncPlan(userId: string, month: string, fxOutside: FxConverter) {
  return db.$transaction(async (tx: Tx) => {
    const existing = await tx.budgetPlan.findUnique({ where: { userId_month: { userId, month } } });
    if (existing) {
      await syncScheduledBudgets(tx, userId);
      return existing;
    }
    // Recurring lines are stamped in once, when the month's plan is created.
    // After that the month is the user's to edit: removing a recurring line
    // from one month doesn't bring it back on the next visit.
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true, budgetCurrency: true } });
    const currency = user.budgetCurrency ?? user.baseCurrency;
    const plan = await tx.budgetPlan.create({ data: { userId, month, currency } });
    const recurring = await tx.category.findMany({
      where: { userId, isDefault: true, OR: [{ defaultSince: null }, { defaultSince: { lte: month } }] },
      orderBy: { sortOrder: "asc" },
    });
    if (recurring.length) {
      const fx = fxOutside;
      await tx.budgetCategoryAllocation.createMany({
        data: recurring.map((c) => ({
          budgetPlanId: plan.id,
          categoryId: c.id,
          budgetAmount: roundMoney(convertOr(fx, Number(c.defaultAmount), c.defaultCurrency ?? currency, currency)),
          accountId: c.defaultAccountId,
          sortOrder: c.sortOrder,
          source: "RECURRING",
        })),
        skipDuplicates: true,
      });
    }
    await syncScheduledBudgets(tx, userId);
    return plan;
  });
}

export interface BudgetLine {
  id: string | null; // null = spending with no budget this month
  categoryId: string;
  categoryName: string;
  isRecurring: boolean;
  source: string;
  accountId: string | null;
  accountName: string | null;
  budgetAmount: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  /** Scheduled payments falling in this month for the category. */
  scheduled: Occurrence[];
  scheduledTotal: number;
}

export async function budgetForMonth(userId: string, month: string) {
  const plan = await ensureMonthPlan(userId, month);
  const { start, end } = monthRange(month);
  const last = new Date(end.getTime() - 86_400_000);

  const [allocations, spendRows, categories, accounts, payments, income] = await Promise.all([
    plan
      ? db.budgetCategoryAllocation.findMany({
          where: { budgetPlanId: plan.id },
          include: { category: true, account: { select: { id: true, name: true } } },
          orderBy: { sortOrder: "asc" },
        })
      : Promise.resolve([]),
    db.ledgerEntry.findMany({
      where: { userId, type: "EXPENSE", reversedAt: null, date: { gte: start, lt: end } },
      select: { categoryId: true, amount: true, currency: true, oneTime: true, countInBudget: true },
    }),
    db.category.findMany({ where: { userId }, select: { id: true, name: true, isDefault: true } }),
    db.account.findMany({ where: { userId }, select: { id: true, name: true } }),
    loadOccurrences(userId, start, last, { direction: "PAYMENT" }),
    loadOccurrences(userId, start, last, { direction: "INCOME" }),
  ]);

  // Everything on a month's budget is shown in that plan's currency;
  // spending in other currencies (a forex card, an INR account) converts at
  // today's rate for display only.
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true, budgetCurrency: true } });
  const planCurrency = plan?.currency ?? user.budgetCurrency ?? user.baseCurrency;
  const fx = await createFxConverter(userId, user.baseCurrency);
  const unconverted = new Set<string>();
  const toPlan = (amount: number, from: string) => {
    const v = fx.convertTo(amount, from, planCurrency);
    if (v == null) unconverted.add(from);
    return v ?? amount;
  };
  const spend = new Map<string, number>();
  // One-time purchases stay off the budget unless opted in; their total is
  // reported separately so the page can say what was left out.
  let oneTimeExcluded = 0;
  for (const r of spendRows) {
    if (r.oneTime && !r.countInBudget) {
      oneTimeExcluded += toPlan(Number(r.amount), r.currency);
      continue;
    }
    const k = r.categoryId ?? "_none";
    spend.set(k, (spend.get(k) ?? 0) + toPlan(Number(r.amount), r.currency));
  }
  const conv = (o: Occurrence) => ({ ...o, nativeAmount: o.amount, nativeCurrency: o.currency, amount: toPlan(o.amount, o.currency), currency: planCurrency });
  const catName = new Map(categories.map((c) => [c.id, c]));
  const acctName = new Map(accounts.map((a) => [a.id, a.name]));
  const scheduledBy = new Map<string, Occurrence[]>();
  for (const p0 of payments) {
    const p = conv(p0);
    if (!p.categoryId || p.status === "SKIPPED" || p.status === "REVERSED") continue;
    scheduledBy.set(p.categoryId, [...(scheduledBy.get(p.categoryId) ?? []), p]);
  }

  const lines: BudgetLine[] = allocations.map((a) => {
    const spent = spend.get(a.categoryId) ?? 0;
    const budgetAmount = Number(a.budgetAmount);
    const scheduled = scheduledBy.get(a.categoryId) ?? [];
    return {
      id: a.id,
      categoryId: a.categoryId,
      categoryName: a.category.name,
      isRecurring: a.category.isDefault,
      source: a.source,
      accountId: a.accountId,
      accountName: a.account?.name ?? null,
      budgetAmount,
      spent,
      remaining: budgetAmount - spent,
      percentUsed: budgetAmount > 0 ? Math.round((spent / budgetAmount) * 100) : spent > 0 ? 100 : 0,
      scheduled,
      scheduledTotal: scheduled.reduce((s, o) => s + o.amount, 0),
    };
  });

  // Spending (or scheduled payments) in categories with no budget this month.
  const budgeted = new Set(lines.map((l) => l.categoryId));
  const unbudgetedIds = new Set<string>();
  for (const [id, v] of spend) if (v > 0 && id !== "_none" && !budgeted.has(id)) unbudgetedIds.add(id);
  for (const id of scheduledBy.keys()) if (!budgeted.has(id)) unbudgetedIds.add(id);
  const unbudgeted: BudgetLine[] = [...unbudgetedIds].map((id) => {
    const scheduled = scheduledBy.get(id) ?? [];
    const spent = spend.get(id) ?? 0;
    return {
      id: null,
      categoryId: id,
      categoryName: catName.get(id)?.name ?? "Uncategorised",
      isRecurring: !!catName.get(id)?.isDefault,
      source: "NONE",
      accountId: null,
      accountName: null,
      budgetAmount: 0,
      spent,
      remaining: -spent,
      percentUsed: spent > 0 ? 100 : 0,
      scheduled,
      scheduledTotal: scheduled.reduce((s, o) => s + o.amount, 0),
    };
  });

  const totalBudgeted = lines.reduce((s, l) => s + l.budgetAmount, 0);
  const totalSpent = [...spend.values()].reduce((s, v) => s + v, 0);
  const expectedIncome = income.filter((o) => o.status !== "SKIPPED" && o.status !== "REVERSED").reduce((s, o) => s + conv(o).amount, 0);
  void acctName;

  return {
    month,
    currency: planCurrency,
    unconverted: [...unconverted],
    hasPlan: !!plan,
    isPast: month < monthKey(await userToday(userId)),
    totalIncome: plan ? Number(plan.totalIncome) : 0,
    expectedIncome,
    totalBudgeted,
    totalSpent,
    oneTimeExcluded,
    lines,
    unbudgeted,
  };
}

export { roundMoney };

/** fx.convertTo with a same-amount fallback when no rate exists. */
export function convertOr(fx: FxConverter, amount: number, from: string, to: string) {
  return fx.convertTo(amount, from, to) ?? amount;
}

/** The currency a newly created month's budget uses. */
export async function newPlanCurrency(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true, budgetCurrency: true } });
  return u.budgetCurrency ?? u.baseCurrency;
}

/** Plans every month's budget in `currency`: converts each month's planned
 * income and lines at today's rate (each line change kept as an adjustment)
 * and makes it the currency for months created later. Actual spending isn't
 * touched. Returns how many months were converted. */
export async function switchBudgetCurrency(userId: string, currency: string) {
  const [user, plans] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } }),
    db.budgetPlan.findMany({ where: { userId, currency: { not: currency } }, include: { allocations: true } }),
  ]);
  if (plans.length === 0) {
    await db.user.update({ where: { id: userId }, data: { budgetCurrency: currency } });
    return 0;
  }
  const fx = await createFxConverter(userId, user.baseCurrency);
  const rates = new Map<string, number>();
  for (const from of new Set(plans.map((p) => p.currency))) {
    const r = fx.rate(from, currency);
    if (r == null) throw new ValidationError(`No exchange rate between ${from} and ${currency} yet. Try again shortly.`);
    rates.set(from, r);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  await db.$transaction(
    async (tx: Tx) => {
      for (const plan of plans) {
        const r = rates.get(plan.currency)!;
        for (const a of plan.allocations) {
          const next = round(Number(a.budgetAmount) * r);
          await tx.budgetCategoryAllocation.update({ where: { id: a.id }, data: { budgetAmount: next } });
          await tx.budgetAdjustment.create({ data: { budgetCategoryAllocationId: a.id, oldAmount: a.budgetAmount, newAmount: next, note: `Converted ${plan.currency} → ${currency} at ${r.toFixed(4)}` } });
        }
        await tx.budgetPlan.update({ where: { id: plan.id }, data: { currency, totalIncome: round(Number(plan.totalIncome) * r) } });
      }
      await tx.user.update({ where: { id: userId }, data: { budgetCurrency: currency } });
      await audit(tx, userId, "budget", userId, "budget.currency", `Budgets switched to ${currency}`, { months: plans.map((p) => p.month), rates: Object.fromEntries(rates) });
    },
    { timeout: 60_000 }
  );
  return plans.length;
}
