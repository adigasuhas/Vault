import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { roundMoney, ValidationError } from "@/lib/validate";
import { ensureDefaultCategories } from "@/lib/defaults";
import { loadOccurrences, syncScheduledBudgets, userToday, type Occurrence } from "@/lib/schedules";
import { monthKey, monthRange } from "@/lib/dates";
import { createFxConverter, type FxConverter } from "@/lib/fx";
import { audit, SPEND_EXPENSE, spendOf, type Tx } from "@/lib/ledger";
import { budgetGroups, groupSpent, planTotal, rootOf } from "@/lib/budget-tree";
import { fundingView } from "@/lib/budget-funding";

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
 *
 * Categories nest one level (Groceries › Dairy). A parent's line is the
 * envelope for its whole group; subcategory lines break it down. The group
 * counts once in the totals (see budget-tree), and spending anywhere in it
 * counts against the parent's line.
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

export interface LineFunding {
  sourceId: string;
  label: string;
  kind: "RECEIVABLE" | "ACCOUNT";
  amount: number;
  /** The source no longer fully covers what the plan counts on. */
  atRisk: boolean;
}

export interface BudgetLine {
  id: string | null; // null = spending with no budget this month
  categoryId: string;
  categoryName: string;
  /** The parent category, for a subcategory. */
  parentId: string | null;
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
  /** Where the money for this line comes from. */
  funding: LineFunding[];
  funded: number;
  /** Planned but not yet backed by a source (0 when fully funded). */
  unfunded: number;
  /** Optional: the loan this line plans a repayment towards. */
  loan: {
    id: string;
    name: string;
    currency: string;
    emi: number;
    repaid: number;
    payments: number;
    /** The loan's own EMI category, when this month budgets it outside this
     * line's group: the repayment would be planned twice. */
    alsoBudgeted: { categoryId: string; name: string; amount: number } | null;
  } | null;
  /** Optional: the scheduled payment this line covers. */
  paymentSchedule: { id: string; name: string; planned: number; paid: number; statuses: string[] } | null;
}

/** A top-level category with a budget of its own or in its subcategories. */
export interface BudgetGroupView {
  categoryId: string;
  name: string;
  /** The parent's own line (the envelope), if it has one. */
  lineId: string | null;
  own: number | null;
  breakdown: number;
  /** What the group counts for in the plan's totals. */
  total: number;
  unassigned: number;
  over: number;
  spent: number;
  remaining: number;
  funded: number;
  unfunded: number;
  /** Subcategories shown under it: budgeted ones, then any with spending. */
  children: string[];
}

export async function budgetForMonth(userId: string, month: string) {
  const plan = await ensureMonthPlan(userId, month);
  const { start, end } = monthRange(month);
  const last = new Date(end.getTime() - 86_400_000);

  const [allocations, spendRows, categories, accounts, payments, income] = await Promise.all([
    plan
      ? db.budgetCategoryAllocation.findMany({
          where: { budgetPlanId: plan.id },
          include: {
            category: true,
            account: { select: { id: true, name: true } },
            loan: { select: { id: true, name: true, currency: true, emiAmount: true, categoryId: true } },
            paymentSchedule: { select: { id: true, name: true } },
          },
          orderBy: { sortOrder: "asc" },
        })
      : Promise.resolve([]),
    db.ledgerEntry.findMany({
      // Spending, plus investment purchases paid from an account under a budget
      // category (they count toward that line, though they aren't spending).
      where: { userId, reversedAt: null, date: { gte: start, lt: end }, OR: [{ type: "EXPENSE" }, { type: "INVESTMENT_PURCHASE", categoryId: { not: null } }] },
      select: { categoryId: true, amount: true, currency: true, oneTime: true, countInBudget: true, expense: SPEND_EXPENSE },
    }),
    db.category.findMany({ where: { userId }, select: { id: true, name: true, isDefault: true, parentId: true } }),
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
    const { amount, currency } = spendOf(r);
    if (r.oneTime && !r.countInBudget) {
      oneTimeExcluded += toPlan(amount, currency);
      continue;
    }
    const k = r.categoryId ?? "_none";
    spend.set(k, (spend.get(k) ?? 0) + toPlan(amount, currency));
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

  // Parent and subcategory lines form groups, each counted once.
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  const groups = budgetGroups(allocations.map((a) => ({ categoryId: a.categoryId, amount: Number(a.budgetAmount) })), categories);
  const groupOf = new Map(groups.map((g) => [g.rootId, g]));
  const funding = await fundingView(userId, plan);

  // Repayments recorded towards linked loans this month (actual, not planned).
  const loanIds = [...new Set(allocations.map((a) => a.loanId).filter((x): x is string => !!x))];
  const loanPayments = loanIds.length
    ? await db.loanPayment.findMany({ where: { loanId: { in: loanIds }, reversedAt: null, paidOn: { gte: start, lt: end } }, select: { loanId: true, amount: true } })
    : [];

  const lines: BudgetLine[] = allocations.map((a) => {
    // A parent's line is its group's envelope, so all the group's spending counts against it.
    const group = groupOf.get(a.categoryId);
    const spent = group ? groupSpent(group, spend) : (spend.get(a.categoryId) ?? 0);
    const budgetAmount = Number(a.budgetAmount);
    const scheduled = scheduledBy.get(a.categoryId) ?? [];
    const lineFunding = funding?.lineFunding.get(a.id) ?? [];
    const funded = roundMoney(lineFunding.reduce((t, f) => t + f.amount, 0));
    const paid = loanPayments.filter((p) => p.loanId === a.loanId);
    const schedOcc = a.paymentScheduleId ? payments.filter((o) => o.scheduleId === a.paymentScheduleId && o.status !== "SKIPPED") : [];
    return {
      id: a.id,
      categoryId: a.categoryId,
      categoryName: a.category.name,
      parentId: a.category.parentId,
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
      funding: lineFunding,
      funded,
      unfunded: roundMoney(Math.max((group ? group.total : budgetAmount) - funded, 0)),
      loan: a.loan
        ? {
            id: a.loan.id,
            name: a.loan.name,
            currency: a.loan.currency,
            emi: toPlan(Number(a.loan.emiAmount), a.loan.currency),
            repaid: toPlan(paid.reduce((t, p) => t + Number(p.amount), 0), a.loan.currency),
            payments: paid.length,
            alsoBudgeted: (() => {
              const own = a.loan.categoryId ? allocations.find((x) => x.categoryId === a.loan!.categoryId) : undefined;
              if (!own || rootOf(own.categoryId, parentOf) === rootOf(a.categoryId, parentOf)) return null;
              return { categoryId: own.categoryId, name: own.category.name, amount: Number(own.budgetAmount) };
            })(),
          }
        : null,
      paymentSchedule: a.paymentSchedule
        ? {
            id: a.paymentSchedule.id,
            name: a.paymentSchedule.name,
            planned: schedOcc.reduce((t, o) => t + toPlan(o.amount, o.currency), 0),
            paid: schedOcc.filter((o) => o.status === "CONFIRMED").reduce((t, o) => t + toPlan(o.amount, o.currency), 0),
            statuses: schedOcc.map((o) => o.status),
          }
        : null,
    };
  });

  // Spending (or scheduled payments) with no budget this month: not on a
  // line of its own and not inside a budgeted parent's group.
  const budgeted = new Set(lines.map((l) => l.categoryId));
  const covered = (id: string) => budgeted.has(id) || groupOf.has(rootOf(id, parentOf));
  const unbudgetedIds = new Set<string>();
  for (const [id, v] of spend) if (v > 0 && id !== "_none" && !covered(id)) unbudgetedIds.add(id);
  for (const id of scheduledBy.keys()) if (!covered(id)) unbudgetedIds.add(id);
  const unbudgeted: BudgetLine[] = [...unbudgetedIds].map((id) => {
    const scheduled = scheduledBy.get(id) ?? [];
    const spent = spend.get(id) ?? 0;
    return {
      id: null,
      categoryId: id,
      categoryName: catName.get(id)?.name ?? "Uncategorised",
      parentId: catName.get(id)?.parentId ?? null,
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
      funding: [],
      funded: 0,
      unfunded: 0,
      loan: null,
      paymentSchedule: null,
    };
  });

  const groupViews: BudgetGroupView[] = groups.map((g) => {
    const spent = groupSpent(g, spend);
    const inGroup = lines.filter((l) => g.members.includes(l.categoryId));
    const funded = roundMoney(inGroup.reduce((t, l) => t + l.funded, 0));
    const spentChildren = g.members.filter((id) => id !== g.rootId && !g.budgetedChildren.includes(id) && (spend.get(id) ?? 0) > 0);
    return {
      categoryId: g.rootId,
      name: catName.get(g.rootId)?.name ?? "Uncategorised",
      lineId: lines.find((l) => l.categoryId === g.rootId)?.id ?? null,
      own: g.own,
      breakdown: g.breakdown,
      total: g.total,
      unassigned: g.unassigned,
      over: g.over,
      spent,
      remaining: g.total - spent,
      funded,
      unfunded: roundMoney(Math.max(g.total - funded, 0)),
      children: [...g.budgetedChildren, ...spentChildren],
    };
  });
  // Each group once: a parent's envelope and its breakdown are never added together.
  const totalBudgeted = planTotal(groups);
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
    groups: groupViews,
    /** Spending per category this month (plan currency), for subcategory rows. */
    spentByCategory: Object.fromEntries([...spend.entries()].map(([k, v]) => [k, roundMoney(v)])),
    /** The money this month draws on (null for a past month with no plan). */
    sources: funding?.sources ?? [],
    available: funding?.available ?? null,
    fundingOptions: funding?.options ?? [],
    totalFunded: roundMoney(groupViews.reduce((t, g) => t + Math.min(g.funded, g.total), 0)),
    /** What a line can optionally plan for (links never pay or change them). */
    linkOptions: {
      loans: (await db.loan.findMany({ where: { userId, status: "ACTIVE" }, select: { id: true, name: true, currency: true, emiAmount: true }, orderBy: { name: "asc" } })).map((l) => ({
        id: l.id,
        name: l.name,
        currency: l.currency,
        emi: Number(l.emiAmount),
      })),
      paymentSchedules: (await db.scheduledCredit.findMany({ where: { userId, direction: "PAYMENT", isActive: true }, select: { id: true, name: true, amount: true, currency: true }, orderBy: { name: "asc" } })).map((p) => ({
        id: p.id,
        name: p.name,
        amount: Number(p.amount),
        currency: p.currency,
      })),
    },
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
        // The month's money sources and the funding they give convert too.
        for (const src of await tx.budgetSource.findMany({ where: { budgetPlanId: plan.id }, include: { funding: true } })) {
          let given = 0;
          for (const f of src.funding) {
            const next = Math.max(round(Number(f.amount) * r), 0.01);
            given += next;
            await tx.budgetFunding.update({ where: { id: f.id }, data: { amount: next } });
          }
          await tx.budgetSource.update({ where: { id: src.id }, data: { amount: Math.max(round(Number(src.amount) * r), round(given), 0.01) } });
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
