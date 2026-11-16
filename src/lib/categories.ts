import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/validate";
import { audit, type Tx } from "@/lib/ledger";
import { STARTER_GROUPS } from "@/lib/defaults";

/**
 * Category management: a two-level tree (parent › subcategory) that only
 * organises. Renaming, moving or reordering never touches what a category
 * holds: expenses, ledger entries, schedules, loans and budget lines keep
 * their category id, amounts and dates. The database enforces the tree's
 * shape (see the Category_tree_check trigger); these functions check first
 * so the user gets a plain-language reason.
 */

/** Serialises category writes per user, so two concurrent moves can't build
 * a loop or a third level between the trigger's checks. */
async function lockCategories(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"categories:" + userId}))`;
}

async function nextSortOrder(tx: Tx, userId: string, parentId: string | null) {
  const max = await tx.category.aggregate({ where: { userId, parentId }, _max: { sortOrder: true } });
  return (max._max.sortOrder ?? -1) + 1;
}

/** `parentId` must be one of the user's top-level categories, and `id` (when
 * moving an existing category) mustn't be it or have subcategories. */
async function assertParent(tx: Tx, userId: string, parentId: string, id?: string) {
  if (id && parentId === id) throw new ValidationError("A category can't be its own parent.");
  const parent = await tx.category.findFirst({ where: { id: parentId, userId }, select: { name: true, parentId: true } });
  if (!parent) throw new ValidationError("Parent category not found.");
  if (parent.parentId) throw new ValidationError(`${parent.name} is a subcategory. Subcategories can't have their own.`);
  if (id && (await tx.category.count({ where: { parentId: id } }))) {
    throw new ValidationError("This category has subcategories, so it can't become one. Move or delete its subcategories first.");
  }
}

function uniqueName(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ValidationError("You already have a category with this name.");
  throw err;
}

/** Creates a category inside the caller's transaction (e.g. a budget line
 * that names a new subcategory). */
export async function createCategoryTx(tx: Tx, userId: string, input: { name: string; parentId?: string | null; color?: string | null }) {
  await lockCategories(tx, userId);
  const parentId = input.parentId ?? null;
  if (parentId) await assertParent(tx, userId, parentId);
  const dup = await tx.category.findFirst({ where: { userId, name: { equals: input.name, mode: "insensitive" } }, select: { name: true } });
  if (dup) throw new ValidationError(`You already have a category called "${dup.name}". Pick it from the list.`);
  const category = await tx.category.create({
    data: { userId, name: input.name, parentId, color: input.color ?? null, sortOrder: await nextSortOrder(tx, userId, parentId) },
  });
  await audit(tx, userId, "category", category.id, "category.create", `Category ${category.name} created`, { parentId });
  return category;
}

export async function createCategory(userId: string, input: { name: string; parentId?: string | null; color?: string | null }) {
  try {
    return await db.$transaction((tx: Tx) => createCategoryTx(tx, userId, input));
  } catch (err) {
    uniqueName(err);
  }
}

/** Name, colour and position in the tree. Moving keeps everything the
 * category holds; it lands at the end of its new siblings. */
export async function updateCategory(tx: Tx, userId: string, id: string, input: { name?: string; parentId?: string | null; color?: string | null }) {
  await lockCategories(tx, userId);
  const existing = await tx.category.findFirst({ where: { id, userId } });
  if (!existing) throw new ValidationError("Category not found.");
  const moving = input.parentId !== undefined && input.parentId !== existing.parentId;
  if (moving && input.parentId) await assertParent(tx, userId, input.parentId, id);
  try {
    const category = await tx.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(moving ? { parentId: input.parentId, sortOrder: await nextSortOrder(tx, userId, input.parentId ?? null) } : {}),
      },
    });
    if (moving || input.name !== undefined) {
      await audit(tx, userId, "category", id, moving ? "category.move" : "category.rename", moving ? `Category ${existing.name} moved` : `Category ${existing.name} renamed to ${input.name}`, {
        from: moving ? existing.parentId : existing.name,
        to: moving ? (input.parentId ?? null) : input.name,
      });
    }
    return category;
  } catch (err) {
    uniqueName(err);
  }
}

/** Puts one set of siblings in the given order. */
export async function reorderCategories(userId: string, parentId: string | null, order: string[]) {
  return db.$transaction(async (tx: Tx) => {
    await lockCategories(tx, userId);
    const siblings = await tx.category.findMany({ where: { userId, parentId }, select: { id: true } });
    const ids = new Set(siblings.map((s) => s.id));
    if (order.length !== ids.size || new Set(order).size !== order.length || order.some((id) => !ids.has(id))) {
      throw new ValidationError("The categories changed while you were reordering. Refresh and try again.");
    }
    for (const [i, id] of order.entries()) await tx.category.update({ where: { id }, data: { sortOrder: i } });
    return { ok: true };
  });
}

export interface CategoryUsage {
  expenses: number;
  ledgerEntries: number;
  schedules: number;
  loans: { id: string; name: string }[];
  budgetLines: number;
  fundedBudgetLines: number;
  subcategories: { id: string; name: string }[];
  recurring: boolean;
}

/** Everything that refers to a category: what deleting it would affect. */
export async function categoryUsage(userId: string, id: string): Promise<CategoryUsage> {
  const cat = await db.category.findFirst({ where: { id, userId }, select: { isDefault: true } });
  if (!cat) throw new ValidationError("Category not found.");
  const [expenses, ledgerEntries, schedules, loans, budgetLines, fundedBudgetLines, subcategories] = await Promise.all([
    db.expense.count({ where: { userId, categoryId: id } }),
    db.ledgerEntry.count({ where: { userId, categoryId: id } }),
    db.scheduledCredit.count({ where: { userId, categoryId: id } }),
    db.loan.findMany({ where: { userId, categoryId: id }, select: { id: true, name: true } }),
    db.budgetCategoryAllocation.count({ where: { categoryId: id } }),
    db.budgetCategoryAllocation.count({ where: { categoryId: id, funding: { some: {} } } }),
    db.category.findMany({ where: { userId, parentId: id }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return { expenses, ledgerEntries, schedules, loans, budgetLines, fundedBudgetLines, subcategories, recurring: cat.isDefault };
}

/**
 * Deletes a category. Its subcategories move up to the top level. Anything
 * that refers to it is either moved to `reassignTo` (expenses, ledger
 * entries, scheduled payments and budget lines: their amounts and dates are
 * untouched, only the category changes) or, for budget lines alone, dropped
 * from their budgets with `dropBudgets`. History is never deleted: a
 * category with transactions can only go once they have somewhere to go. A
 * loan's own category goes with the loan.
 */
export async function deleteCategory(userId: string, id: string, opts: { reassignTo?: string; dropBudgets?: boolean }) {
  return db.$transaction(
    async (tx: Tx) => {
      await lockCategories(tx, userId);
      const cat = await tx.category.findFirst({ where: { id, userId } });
      if (!cat) throw new ValidationError("Category not found.");
      const loan = await tx.loan.findFirst({ where: { userId, categoryId: id }, select: { name: true } });
      if (loan) throw new ValidationError(`${cat.name} belongs to the loan ${loan.name}, which books its EMIs here. It goes away when the loan is deleted.`);

      const [expenses, entries, schedules, lines] = await Promise.all([
        tx.expense.count({ where: { userId, categoryId: id } }),
        tx.ledgerEntry.count({ where: { userId, categoryId: id } }),
        tx.scheduledCredit.count({ where: { userId, categoryId: id } }),
        tx.budgetCategoryAllocation.findMany({ where: { categoryId: id }, include: { funding: true } }),
      ]);
      const history = expenses + entries + schedules;
      const target = opts.reassignTo ? await tx.category.findFirst({ where: { id: opts.reassignTo, userId } }) : null;
      if (opts.reassignTo && (!target || target.id === id)) throw new ValidationError("Choose another category to move things to.");
      if (history && !target) {
        throw new ValidationError(`${cat.name} has ${history} transaction${history === 1 ? "" : "s"} or scheduled payment${history === 1 ? "" : "s"}. Choose a category to move them to.`);
      }
      if (lines.length && !target && !opts.dropBudgets) {
        throw new ValidationError(`${cat.name} is in ${lines.length} month${lines.length === 1 ? "'s" : "s'"} budget. Move those lines to another category, or remove them from the budgets.`);
      }

      // Subcategories move up to the top level, after the existing ones.
      const subs = await tx.category.findMany({ where: { parentId: id }, orderBy: { sortOrder: "asc" } });
      let order = await nextSortOrder(tx, userId, null);
      for (const s of subs) await tx.category.update({ where: { id: s.id }, data: { parentId: null, sortOrder: order++ } });

      if (target) {
        await tx.expense.updateMany({ where: { userId, categoryId: id }, data: { categoryId: target.id } });
        await tx.ledgerEntry.updateMany({ where: { userId, categoryId: id }, data: { categoryId: target.id } });
        await tx.scheduledCredit.updateMany({ where: { userId, categoryId: id }, data: { categoryId: target.id } });
        for (const line of lines) {
          const into = await tx.budgetCategoryAllocation.findUnique({
            where: { budgetPlanId_categoryId: { budgetPlanId: line.budgetPlanId, categoryId: target.id } },
            include: { funding: true },
          });
          if (!into) {
            await tx.budgetCategoryAllocation.update({ where: { id: line.id }, data: { categoryId: target.id } });
            continue;
          }
          // The month already budgets the target: the two lines become one,
          // with both amounts and all their funding.
          const merged = Number(into.budgetAmount) + Number(line.budgetAmount);
          await tx.budgetAdjustment.create({ data: { budgetCategoryAllocationId: into.id, oldAmount: into.budgetAmount, newAmount: merged, note: `Merged in ${cat.name} (deleted)` } });
          await tx.budgetCategoryAllocation.update({
            where: { id: into.id },
            data: { budgetAmount: merged, source: "MANUAL", loanId: into.loanId ?? line.loanId, paymentScheduleId: into.paymentScheduleId ?? line.paymentScheduleId },
          });
          for (const f of line.funding) {
            const same = into.funding.find((x) => x.sourceId === f.sourceId);
            if (same) await tx.budgetFunding.update({ where: { id: same.id }, data: { amount: Number(same.amount) + Number(f.amount) } });
            else await tx.budgetFunding.update({ where: { id: f.id }, data: { allocationId: into.id } });
          }
          await tx.budgetCategoryAllocation.delete({ where: { id: line.id } });
        }
        // A repeating budget keeps repeating, under its new category.
        if (cat.isDefault && !target.isDefault) {
          await tx.category.update({
            where: { id: target.id },
            data: { isDefault: true, defaultAmount: cat.defaultAmount, defaultCurrency: cat.defaultCurrency, defaultAccountId: target.defaultAccountId ?? cat.defaultAccountId, defaultSince: cat.defaultSince },
          });
        }
      } else if (lines.length) {
        await tx.budgetCategoryAllocation.deleteMany({ where: { categoryId: id } });
      }

      await tx.category.delete({ where: { id } });
      await audit(tx, userId, "category", id, "category.delete", `Category ${cat.name} deleted`, {
        movedTo: target?.name ?? null,
        expenses,
        ledgerEntries: entries,
        schedules,
        budgetLines: lines.length,
        droppedBudgetLines: target ? 0 : lines.length,
        subcategoriesMovedUp: subs.map((s) => s.name),
      });
      return { movedTo: target?.name ?? null, subcategoriesMovedUp: subs.length };
    },
    { timeout: 30_000 }
  );
}

/** Groups the starter categories the way new accounts get them. Only
 * starters that are still top-level with no subcategories of their own move;
 * anything the user has already organised stays where it is. Groups that
 * already exist (by name) are reused. */
export async function groupStarterCategories(userId: string) {
  return db.$transaction(async (tx: Tx) => {
    await lockCategories(tx, userId);
    const cats = await tx.category.findMany({ where: { userId }, select: { id: true, name: true, parentId: true, isSystem: true } });
    const withChildren = new Set(cats.map((c) => c.parentId).filter(Boolean));
    let moved = 0;
    let created = 0;
    for (const g of STARTER_GROUPS) {
      const members = cats.filter((c) => g.children.includes(c.name) && c.isSystem && !c.parentId && !withChildren.has(c.id));
      if (!members.length) continue;
      let parent = cats.find((c) => c.name.toLowerCase() === g.name.toLowerCase());
      if (parent?.parentId) continue; // that name is taken by a subcategory: leave these alone
      if (!parent) {
        const p = await tx.category.create({ data: { userId, name: g.name, isSystem: true, sortOrder: await nextSortOrder(tx, userId, null) } });
        parent = { id: p.id, name: p.name, parentId: null, isSystem: true };
        created++;
      }
      let order = await nextSortOrder(tx, userId, parent.id);
      for (const m of members.sort((a, b) => g.children.indexOf(a.name) - g.children.indexOf(b.name))) {
        await tx.category.update({ where: { id: m.id }, data: { parentId: parent.id, sortOrder: order++ } });
        moved++;
      }
    }
    if (moved) await audit(tx, userId, "category", userId, "category.group_starters", `Grouped ${moved} starter categories`, { groupsCreated: created });
    return { moved, created };
  });
}
