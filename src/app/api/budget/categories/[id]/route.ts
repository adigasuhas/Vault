import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authed, notFound } from "@/lib/api";
import { parseJson, ValidationError } from "@/lib/validate";
import { patchCategorySchema } from "@/lib/schemas";
import { audit, type Tx } from "@/lib/ledger";
import { monthKey } from "@/lib/dates";
import { userToday } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** Rename, or turn "repeats every month" on/off. Turning it on applies from
 * the current month (never retroactively); turning it off leaves past and
 * current months alone and stops future ones. */
export const PATCH = authed<{ id: string }>(async (req, { userId, params }) => {
  const existing = await db.category.findFirst({ where: { id: params.id, userId } });
  if (!existing) return notFound("Category not found.");
  const input = await parseJson(req, patchCategorySchema);
  const current = monthKey(await userToday(userId));
  try {
    return await db.$transaction(async (tx: Tx) => {
      const category = await tx.category.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isDefault !== undefined
            ? { isDefault: input.isDefault, ...(input.isDefault && !existing.isDefault ? { defaultSince: current } : {}) }
            : {}),
        },
      });
      if (input.isDefault === false && existing.isDefault) {
        await tx.budgetCategoryAllocation.deleteMany({
          where: { categoryId: existing.id, source: "RECURRING", budgetPlan: { userId, month: { gt: current } } },
        });
      }
      if (input.isDefault === true && !existing.isDefault) {
        const plans = await tx.budgetPlan.findMany({ where: { userId, month: { gte: current } } });
        for (const p of plans) {
          await tx.budgetCategoryAllocation.upsert({
            where: { budgetPlanId_categoryId: { budgetPlanId: p.id, categoryId: existing.id } },
            update: {},
            create: { budgetPlanId: p.id, categoryId: existing.id, budgetAmount: existing.defaultAmount, accountId: existing.defaultAccountId, sortOrder: existing.sortOrder, source: "RECURRING" },
          });
        }
      }
      await audit(tx, userId, "category", existing.id, "category.update", `Category ${existing.name} updated`, {
        name: input.name ?? null,
        recurring: input.isDefault ?? null,
      });
      return { category };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ValidationError("You already have a category with this name.");
    }
    throw err;
  }
});

/** Deletes a category only if nothing ever referenced it — spending history
 * and schedules keep their category forever. */
export const DELETE = authed<{ id: string }>(async (_req, { userId, params }) => {
  const existing = await db.category.findFirst({ where: { id: params.id, userId } });
  if (!existing) return notFound("Category not found.");
  const [entries, expenses, schedules, loans] = await Promise.all([
    db.ledgerEntry.count({ where: { categoryId: existing.id } }),
    db.expense.count({ where: { categoryId: existing.id } }),
    db.scheduledCredit.count({ where: { categoryId: existing.id } }),
    db.loan.count({ where: { categoryId: existing.id } }),
  ]);
  if (entries || expenses || schedules || loans) {
    throw new ValidationError(
      `${existing.name} has spending history or scheduled payments, so it can't be deleted. Remove it from the month's budget instead.`
    );
  }
  await db.$transaction([
    db.budgetCategoryAllocation.deleteMany({ where: { categoryId: existing.id } }),
    db.category.delete({ where: { id: existing.id } }),
  ]);
  return { ok: true };
});
