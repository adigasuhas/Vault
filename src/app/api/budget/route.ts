import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { setBudgetIncomeSchema } from "@/lib/schemas";
import { budgetForMonth, newPlanCurrency, switchBudgetCurrency } from "@/lib/budget";
import { monthKey } from "@/lib/dates";
import { userToday } from "@/lib/schedules";
import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

export const dynamic = "force-dynamic";

export const GET = authed(async (req, { userId }) => {
  const m = req.nextUrl.searchParams.get("month");
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : monthKey(await userToday(userId));
  return budgetForMonth(userId, month);
});

/** Sets the month's planned income. */
export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, setBudgetIncomeSchema);
  const month = input.month ?? monthKey(await userToday(userId));
  const plan = await db.budgetPlan.upsert({
    where: { userId_month: { userId, month } },
    update: { totalIncome: input.totalIncome ?? 0 },
    create: { userId, month, totalIncome: input.totalIncome ?? 0, currency: await newPlanCurrency(userId) },
  });
  return { plan };
});

const currencySchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), currency: z.enum(SUPPORTED_CURRENCIES.map((c) => c.code) as [string, ...string[]]) });

/** Switches the budget currency: every month's budget is converted at
 * today's rate, and new months use it too. */
export const PATCH = authed(async (req, { userId }) => {
  const input = await parseJson(req, currencySchema);
  const months = await switchBudgetCurrency(userId, input.currency);
  return { currency: input.currency, months };
});
