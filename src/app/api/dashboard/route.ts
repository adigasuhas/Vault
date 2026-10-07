import { authed } from "@/lib/api";
import { overview } from "@/lib/insights";
import { budgetForMonth } from "@/lib/budget";
import { monthKey } from "@/lib/dates";
import { runDueSchedules } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** The home screen: where you stand, what needs attention, what's next. */
export const GET = authed(async (_req, { userId }) => {
  await runDueSchedules(new Date(), userId);
  const o = await overview(userId, 6);
  const month = monthKey(o.today);
  const budget = await budgetForMonth(userId, month);
  const thisMonth = o.flows[o.flows.length - 1];
  const fx = o.fx;
  const conv = (amount: number, currency: string) => fx.convert(amount, currency);
  return {
    currency: o.baseCurrency,
    fxUnavailable: fx.missing,
    today: o.today,
    netWorth: o.netWorth,
    cash: o.position.cash,
    owed: o.position.owed,
    loans: o.position.loanDebt,
    investments: o.portfolio.total,
    thisMonth,
    trend: o.flows,
    accounts: o.position.accounts.filter((a) => a.status !== "ARCHIVED"),
    budget: {
      month,
      currency: budget.currency,
      budgeted: budget.totalBudgeted,
      spent: budget.totalSpent,
      lines: [...budget.lines, ...budget.unbudgeted]
        .sort((a, b) => b.spent - a.spent)
        .slice(0, 6)
        .map((l) => ({ name: l.categoryName, budgeted: l.budgetAmount, spent: l.spent })),
    },
    actionable: o.next.actionable.map((x) => ({ ...x, baseAmount: conv(x.amount, x.currency) })),
    upcoming: o.next.scheduled.slice(0, 8).map((x) => ({ ...x, baseAmount: conv(x.amount, x.currency) })),
    runway: {
      months: o.runway.runwayMonths,
      runsOutMonth: o.runway.runsOutMonth,
      monthlyNet: o.runway.monthlyNet,
    },
    topCategories: o.categories.slice(0, 5).map((c) => ({ name: c.name, thisMonth: c.byMonth[c.byMonth.length - 1] })),
  };
});
