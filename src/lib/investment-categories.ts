import { Prisma, type InvestmentKind } from "@prisma/client";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/validate";
import type { Tx } from "@/lib/ledger";

/**
 * Investment categories: the user's own groupings (industry, owner, strategy,
 * purpose…) across stocks, funds, deposits and other assets. An investment
 * can be in several. Categories only group — they never change an
 * investment's value, purchases, sales or ledger entries.
 */

export const CATEGORY_COLORS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const clean = (name: string) => name.trim().replace(/\s+/g, " ");

export async function listCategories(userId: string) {
  return db.investmentCategory.findMany({
    where: { userId },
    include: { links: { select: { kind: true, holdingId: true } }, lotLinks: { select: { lotId: true } } },
    orderBy: { name: "asc" },
  });
}

/** Creates a category, or returns the existing one with the same name (any
 * capitals) so the same grouping is never split in two. */
export async function findOrCreateCategory(client: Tx | typeof db, userId: string, name: string, color?: number) {
  const n = clean(name);
  if (!n) throw new ValidationError("Give the category a name.");
  if (n.length > 60) throw new ValidationError("Keep the name under 60 characters.");
  const existing = await client.investmentCategory.findFirst({ where: { userId, name: { equals: n, mode: "insensitive" } } });
  if (existing) return { category: existing, created: false };
  // Next colour in palette order, so categories don't all start the same.
  const count = await client.investmentCategory.count({ where: { userId } });
  const category = await client.investmentCategory.create({
    data: { userId, name: n, color: color ?? CATEGORY_COLORS[count % CATEGORY_COLORS.length] },
  });
  return { category, created: true };
}

export async function updateCategory(userId: string, id: string, input: { name?: string; color?: number }) {
  const cat = await db.investmentCategory.findFirst({ where: { id, userId } });
  if (!cat) throw new ValidationError("Category not found.");
  const data: Prisma.InvestmentCategoryUpdateInput = {};
  if (input.name !== undefined) {
    const n = clean(input.name);
    if (!n) throw new ValidationError("Give the category a name.");
    const clash = await db.investmentCategory.findFirst({ where: { userId, name: { equals: n, mode: "insensitive" }, NOT: { id } } });
    if (clash) throw new ValidationError(`You already have a category called "${clash.name}". Assign its investments there instead.`);
    data.name = n;
  }
  if (input.color !== undefined) data.color = input.color;
  return db.investmentCategory.update({ where: { id }, data });
}

/** Removes a category. Its investments stay exactly as they are; they just
 * stop being grouped under it. */
export async function deleteCategory(userId: string, id: string) {
  const cat = await db.investmentCategory.findFirst({ where: { id, userId }, include: { _count: { select: { links: true, lotLinks: true } } } });
  if (!cat) throw new ValidationError("Category not found.");
  await db.investmentCategory.delete({ where: { id } });
  return { name: cat.name, unlinked: cat._count.links + cat._count.lotLinks };
}

async function assertHolding(client: Tx | typeof db, userId: string, kind: InvestmentKind, holdingId: string) {
  const where = { id: holdingId, userId };
  const found =
    kind === "STOCK"
      ? await client.stockHolding.findFirst({ where, select: { id: true } })
      : kind === "MUTUAL_FUND"
        ? await client.mutualFundHolding.findFirst({ where, select: { id: true } })
        : kind === "FIXED_DEPOSIT"
          ? await client.fixedDeposit.findFirst({ where, select: { id: true } })
          : await client.otherAsset.findFirst({ where, select: { id: true } });
  if (!found) throw new ValidationError("Investment not found.");
}

export type HoldingCategoriesInput = { kind: InvestmentKind; holdingId: string; categoryIds?: string[]; newNames?: string[]; mode?: "replace" | "add" };

/** Sets an investment's categories: existing ones by id, plus new ones by
 * name (created, or matched to an existing name). `add` keeps the ones it
 * already has. */
export async function setHoldingCategories(userId: string, input: HoldingCategoriesInput) {
  return db.$transaction((tx: Tx) => applyHoldingCategories(tx, userId, input));
}

/** setHoldingCategories inside a transaction the caller already has (a stock
 * edit saves its categories with the rest of the change, or not at all). */
export async function applyHoldingCategories(tx: Tx, userId: string, input: HoldingCategoriesInput) {
  await assertHolding(tx, userId, input.kind, input.holdingId);
  const ids = await resolveCategories(tx, userId, input);
  if ((input.mode ?? "replace") === "replace") {
    await tx.investmentCategoryLink.deleteMany({
      where: { kind: input.kind, holdingId: input.holdingId, category: { userId }, ...(ids.size ? { categoryId: { notIn: [...ids] } } : {}) },
    });
  }
  for (const categoryId of ids) {
    await tx.investmentCategoryLink.upsert({
      where: { categoryId_kind_holdingId: { categoryId, kind: input.kind, holdingId: input.holdingId } },
      update: {},
      create: { categoryId, kind: input.kind, holdingId: input.holdingId },
    });
  }
  return tx.investmentCategoryLink.findMany({ where: { kind: input.kind, holdingId: input.holdingId, category: { userId } }, select: { categoryId: true } });
}

/** The categories for the ids and new names given (created, or matched to an
 * existing name), all checked to be the user's. */
async function resolveCategories(tx: Tx, userId: string, input: { categoryIds?: string[]; newNames?: string[] }) {
  const ids = new Set(input.categoryIds ?? []);
  if (ids.size) {
    const owned = await tx.investmentCategory.count({ where: { userId, id: { in: [...ids] } } });
    if (owned !== ids.size) throw new ValidationError("One of those categories doesn't exist.");
  }
  for (const name of input.newNames ?? []) {
    if (!clean(name)) continue;
    const { category } = await findOrCreateCategory(tx, userId, name);
    ids.add(category.id);
  }
  return ids;
}

/** Sets one stock purchase's own categories (a client, say). Only that
 * purchase changes; the stock's other purchases and its stock-wide
 * categories are left as they are. */
export async function applyLotCategories(tx: Tx, userId: string, lotId: string, input: { categoryIds?: string[]; newNames?: string[]; mode?: "replace" | "add" }) {
  const lot = await tx.stockPurchaseLot.findFirst({ where: { id: lotId, stockHolding: { userId } }, select: { id: true } });
  if (!lot) throw new ValidationError("Purchase not found.");
  const ids = await resolveCategories(tx, userId, input);
  if ((input.mode ?? "replace") === "replace") {
    await tx.stockLotCategoryLink.deleteMany({ where: { lotId, category: { userId }, ...(ids.size ? { categoryId: { notIn: [...ids] } } : {}) } });
  }
  for (const categoryId of ids) {
    await tx.stockLotCategoryLink.upsert({ where: { categoryId_lotId: { categoryId, lotId } }, update: {}, create: { categoryId, lotId } });
  }
  return tx.stockLotCategoryLink.findMany({ where: { lotId, category: { userId } }, select: { categoryId: true } });
}

/** Purchases deleted outright (entered by mistake) leave no categories. */
export async function unlinkLots(client: Tx | typeof db, userId: string, lotIds: string[]) {
  if (lotIds.length) await client.stockLotCategoryLink.deleteMany({ where: { lotId: { in: lotIds }, category: { userId } } });
}

/** An investment deleted outright (added by mistake) leaves no categories
 * behind. A fully *sold* one keeps them — undoing the sale brings it back. */
export async function unlinkHolding(client: Tx | typeof db, userId: string, kind: InvestmentKind, holdingId: string) {
  await client.investmentCategoryLink.deleteMany({ where: { kind, holdingId, category: { userId } } });
}
