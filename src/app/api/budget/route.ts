import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson } from "@/lib/validate";
import { setBudgetIncomeSchema } from "@/lib/schemas";
import { budgetForMonth, newPlanCurrency } from "@/lib/budget";
import { monthKey } from "@/lib/dates";
import { userToday } from "@/lib/schedules";
import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { createFxConverter } from "@/lib/fx";
import { ValidationError } from "@/lib/validate";
import { audit, type Tx } from "@/lib/ledger";

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

const currencySchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), currency: z.enum(SUPPORTED_CURRENCIES.map((c) => c.code) as [string, ...string[]]) });

/** Switches one month's budget to another currency, converting its income
 * and every line at today's rate. Each change is kept as an adjustment. */
export const PATCH = authed(async (req, { userId }) => {
  const input = await parseJson(req, currencySchema);
  const plan = await db.budgetPlan.findUnique({ where: { userId_month: { userId, month: input.month } }, include: { allocations: true } });
  if (!plan) throw new ValidationError("There's no budget for that month yet.");
  if (plan.currency === input.currency) return { plan };
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } });
  const fx = await createFxConverter(userId, user.baseCurrency);
  const r = fx.rate(plan.currency, input.currency);
  if (r == null) throw new ValidationError(`No exchange rate between ${plan.currency} and ${input.currency} yet. Try again shortly.`);
  const round = (n: number) => Math.round(n * 100) / 100;
  return db.$transaction(async (tx: Tx) => {
    for (const a of plan.allocations) {
      const next = round(Number(a.budgetAmount) * r);
      await tx.budgetCategoryAllocation.update({ where: { id: a.id }, data: { budgetAmount: next } });
      await tx.budgetAdjustment.create({ data: { budgetCategoryAllocationId: a.id, oldAmount: a.budgetAmount, newAmount: next, note: `Converted ${plan.currency} → ${input.currency} at ${r.toFixed(4)}` } });
    }
    const updated = await tx.budgetPlan.update({ where: { id: plan.id }, data: { currency: input.currency, totalIncome: round(Number(plan.totalIncome) * r) } });
    await audit(tx, userId, "budget", plan.id, "budget.currency", `Budget for ${input.month} switched to ${input.currency}`, { from: plan.currency, rate: r });
    return { plan: updated };
  });
});
