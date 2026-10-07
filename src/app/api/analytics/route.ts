import { authed } from "@/lib/api";
import { overview } from "@/lib/insights";
import { netWorthHistory, ensureTodaySnapshot } from "@/lib/networth";

export const dynamic = "force-dynamic";

/** `?months=3|6|12` (default 6). Every figure is derived from the ledger and
 * schedule projections — see src/lib/insights.ts. */
export const GET = authed(async (req, { userId }) => {
  const n = Number(req.nextUrl.searchParams.get("months"));
  const monthsBack = [3, 6, 12].includes(n) ? n : 6;
  ensureTodaySnapshot(userId).catch((e) => console.error("snapshot:", e));
  const o = await overview(userId, monthsBack);
  const netWorth = await netWorthHistory(userId, o.months);
  const totalIncome = o.flows.reduce((s, f) => s + f.income, 0);
  const totalExpenses = o.flows.reduce((s, f) => s + f.expenses, 0);
  const totalRegular = o.flows.reduce((s, f) => s + f.regular, 0);
  const totalOneTime = o.flows.reduce((s, f) => s + f.oneTime, 0);
  // Averages over complete months only — the current month is partial.
  const complete = o.flows.slice(0, -1);
  const avg = (k: "income" | "expenses") => (complete.length ? complete.reduce((s, f) => s + f[k], 0) / complete.length : 0);
  const p = o.portfolio;
  return {
    baseCurrency: o.baseCurrency,
    fxUnavailable: o.fx.missing,
    months: o.months,
    summary: {
      netWorth: o.netWorth,
      cash: o.position.cash,
      owed: o.position.owed,
      loans: o.position.loanDebt,
      investments: p.total,
      totalIncome,
      totalExpenses,
      totalRegular,
      totalOneTime,
      saved: totalIncome - totalExpenses,
      savingsRate: totalIncome > 0 ? Math.round(((totalIncome - totalExpenses) / totalIncome) * 1000) / 10 : null,
      avgIncome: avg("income"),
      avgExpenses: avg("expenses"),
    },
    flows: o.flows,
    categories: o.categories,
    oneTimeGroups: o.oneTimeGroups,
    incomeSources: o.sources,
    adherence: o.adherence,
    accounts: o.position.accounts,
    assetAllocation: [
      { name: "Cash & bank", value: Math.max(o.position.cash, 0) },
      { name: "Stocks", value: p.stocks },
      { name: "Mutual funds", value: p.funds },
      { name: "Fixed deposits", value: p.deposits },
      { name: "Other assets", value: p.other },
    ].filter((a) => a.value > 0),
    upcoming: {
      actionable: o.next.actionable,
      scheduled: o.next.scheduled,
    },
    runway: o.runway,
    netWorthHistory: netWorth,
  };
});
