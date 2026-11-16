import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { deleteAllocationSchema, patchAllocationSchema } from "@/lib/schemas";
import { audit, type Tx } from "@/lib/ledger";
import { applyLineFunding, assertFundingFits, assertLineLinks, prepareFunding } from "@/lib/budget-funding";

export const dynamic = "force-dynamic";

/** Edits a budget line. scope MONTH changes only this month; FORWARD changes
 * this month and every later one (and the recurring default). Every amount
 * change is kept as a BudgetAdjustment. A hand-edited line stops being
 * auto-sized from scheduled payments. Funding and the loan / scheduled
 * payment links belong to this month's line only, and are saved in the
 * same transaction as the amount. */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const allocation = await db.budgetCategoryAllocation.findFirst({
    where: { id: params.id, budgetPlan: { userId } },
    include: { budgetPlan: true, category: true },
  });
  if (!allocation) return notFound();
  const input = await parseJson(req, patchAllocationSchema);
  if (input.accountId) {
    const acct = await db.account.findFirst({ where: { id: input.accountId, userId, status: { not: "CLOSED" } } });
    if (!acct) throw new ValidationError("Choose an open account or card.");
  }
  await assertLineLinks(userId, input);
  const prep = input.funding ? await prepareFunding(userId, allocation.budgetPlanId, input.funding) : null;

  return db.$transaction(async (tx: Tx) => {
    const targets =
      input.scope === "FORWARD"
        ? await tx.budgetCategoryAllocation.findMany({
            where: { categoryId: allocation.categoryId, budgetPlan: { userId, month: { gte: allocation.budgetPlan.month } } },
          })
        : [allocation];
    for (const a of targets) {
      const data: { budgetAmount?: number; accountId?: string | null; source?: string } = {};
      if (input.budgetAmount !== undefined && Number(a.budgetAmount) !== input.budgetAmount) {
        // Funding sent with this edit is checked against the new amount below.
        if (!(input.funding && a.id === allocation.id)) await assertFundingFits(tx, a.id, input.budgetAmount, allocation.category.name, allocation.budgetPlan.currency);
        data.budgetAmount = input.budgetAmount;
        data.source = "MANUAL";
        await tx.budgetAdjustment.create({
          data: { budgetCategoryAllocationId: a.id, oldAmount: a.budgetAmount, newAmount: input.budgetAmount, note: input.note },
        });
      }
      if (input.accountId !== undefined) data.accountId = input.accountId;
      if (Object.keys(data).length) await tx.budgetCategoryAllocation.update({ where: { id: a.id }, data });
    }
    if (input.scope === "FORWARD" && allocation.category.isDefault) {
      await tx.category.update({
        where: { id: allocation.categoryId },
        data: {
          ...(input.budgetAmount !== undefined ? { defaultAmount: input.budgetAmount, defaultCurrency: allocation.budgetPlan.currency } : {}),
          ...(input.accountId !== undefined ? { defaultAccountId: input.accountId } : {}),
        },
      });
    }
    if (input.loanId !== undefined || input.paymentScheduleId !== undefined) {
      await tx.budgetCategoryAllocation.update({
        where: { id: allocation.id },
        data: {
          ...(input.loanId !== undefined ? { loanId: input.loanId } : {}),
          ...(input.paymentScheduleId !== undefined ? { paymentScheduleId: input.paymentScheduleId } : {}),
        },
      });
    }
    if (prep && input.funding) await applyLineFunding(tx, userId, prep, allocation.id, input.funding);
    await audit(tx, userId, "budget", allocation.id, "budget.update", `Budget for ${allocation.category.name} changed (${input.scope === "FORWARD" ? `from ${allocation.budgetPlan.month} on` : allocation.budgetPlan.month})`, {
      from: Number(allocation.budgetAmount),
      to: input.budgetAmount ?? null,
      accountId: input.accountId ?? null,
      loanId: input.loanId ?? null,
      paymentScheduleId: input.paymentScheduleId ?? null,
    });
    return { updated: targets.length };
  }, { timeout: 30_000 });
});

/** Removes a line from this month (MONTH) or from this month on, ending the
 * recurrence (FORWARD). Spending in the category is untouched — it just shows
 * as unbudgeted. */
export const DELETE = authed<{ id: string }>(async (req, { userId, params }) => {
  const allocation = await db.budgetCategoryAllocation.findFirst({
    where: { id: params.id, budgetPlan: { userId } },
    include: { budgetPlan: true, category: true },
  });
  if (!allocation) return notFound();
  const { scope } = await parseJson(req, deleteAllocationSchema).catch(() => ({ scope: "MONTH" as const }));
  return db.$transaction(async (tx: Tx) => {
    if (scope === "FORWARD") {
      await tx.budgetCategoryAllocation.deleteMany({
        where: { categoryId: allocation.categoryId, budgetPlan: { userId, month: { gte: allocation.budgetPlan.month } } },
      });
      if (allocation.category.isDefault) {
        await tx.category.update({ where: { id: allocation.categoryId }, data: { isDefault: false, defaultAmount: 0 } });
      }
    } else {
      await tx.budgetCategoryAllocation.delete({ where: { id: allocation.id } });
    }
    await audit(tx, userId, "budget", allocation.id, "budget.remove", `Removed ${allocation.category.name} from the budget (${scope === "FORWARD" ? `from ${allocation.budgetPlan.month} on` : allocation.budgetPlan.month})`);
    return { ok: true };
  });
});
