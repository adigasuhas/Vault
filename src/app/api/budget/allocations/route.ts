import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { addAllocationSchema } from "@/lib/schemas";
import { audit, type Tx } from "@/lib/ledger";
import { ensureMonthPlan, newPlanCurrency } from "@/lib/budget";

export const dynamic = "force-dynamic";

/** One workflow for adding a budget line: category (existing or new), the
 * account/card it's paid from, amount, and whether it repeats every month
 * from this month onward. */
export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, addAllocationSchema);
  if (input.accountId) {
    const acct = await db.account.findFirst({ where: { id: input.accountId, userId, status: { not: "CLOSED" } } });
    if (!acct) throw new ValidationError("Choose an open account or card.");
  }
  await ensureMonthPlan(userId, input.month);
  const currency = await newPlanCurrency(userId);

  try {
    return await db.$transaction(async (tx: Tx) => {
      let category = input.categoryId ? await tx.category.findFirst({ where: { id: input.categoryId, userId } }) : null;
      if (input.categoryId && !category) throw new ValidationError("Category not found.");
      if (!category && input.newCategoryName) {
        const dup = await tx.category.findFirst({ where: { userId, name: { equals: input.newCategoryName, mode: "insensitive" } } });
        if (dup) throw new ValidationError(`You already have a category called "${dup.name}". Pick it from the list.`);
        const max = await tx.category.aggregate({ where: { userId }, _max: { sortOrder: true } });
        category = await tx.category.create({
          data: { userId, name: input.newCategoryName, sortOrder: (max._max.sortOrder ?? -1) + 1 },
        });
      }
      if (!category) throw new ValidationError("Choose a category.");

      const plan = await tx.budgetPlan.upsert({
        where: { userId_month: { userId, month: input.month } },
        update: {},
        create: { userId, month: input.month, currency },
      });
      const existing = await tx.budgetCategoryAllocation.findUnique({
        where: { budgetPlanId_categoryId: { budgetPlanId: plan.id, categoryId: category.id } },
      });
      if (existing) throw new ValidationError(`${category.name} is already in this month's budget. Edit it instead.`);
      const max = await tx.budgetCategoryAllocation.aggregate({ where: { budgetPlanId: plan.id }, _max: { sortOrder: true } });
      const allocation = await tx.budgetCategoryAllocation.create({
        data: {
          budgetPlanId: plan.id,
          categoryId: category.id,
          budgetAmount: input.budgetAmount,
          accountId: input.accountId ?? null,
          source: "MANUAL",
          sortOrder: (max._max.sortOrder ?? -1) + 1,
        },
      });
      if (input.recurring) {
        await tx.category.update({
          where: { id: category.id },
          data: {
            isDefault: true,
            defaultAmount: input.budgetAmount,
            defaultAccountId: input.accountId ?? null,
            defaultSince: input.month,
            defaultCurrency: plan.currency,
          },
        });
        // Later months that already have a plan get the line too.
        const later = await tx.budgetPlan.findMany({ where: { userId, month: { gt: input.month } } });
        for (const p of later) {
          await tx.budgetCategoryAllocation.upsert({
            where: { budgetPlanId_categoryId: { budgetPlanId: p.id, categoryId: category.id } },
            update: {},
            create: {
              budgetPlanId: p.id,
              categoryId: category.id,
              budgetAmount: input.budgetAmount,
              accountId: input.accountId ?? null,
              source: "RECURRING",
              sortOrder: category.sortOrder,
            },
          });
        }
      } else if (!category.defaultAccountId && input.accountId) {
        await tx.category.update({ where: { id: category.id }, data: { defaultAccountId: input.accountId } });
      }
      await audit(tx, userId, "budget", allocation.id, "budget.add", `Budgeted ${category.name} for ${input.month}`, {
        amount: input.budgetAmount,
        recurring: input.recurring,
      });
      return Response.json({ allocation, category }, { status: 201 });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ValidationError("That category already exists.");
    }
    throw err;
  }
});
