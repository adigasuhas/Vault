import { db } from "@/lib/db";
import { authed } from "@/lib/api";
import { ensureDefaultCategories } from "@/lib/defaults";
import { parseJson } from "@/lib/validate";
import { createCategorySchema } from "@/lib/schemas";
import { createCategory } from "@/lib/categories";
import { orderTree } from "@/lib/budget-tree";

export const dynamic = "force-dynamic";

/** Every category in tree order: each parent followed by its subcategories
 * (`depth` 1), so pickers can show the hierarchy as it is. */
export const GET = authed(async (_req, { userId }) => {
  await ensureDefaultCategories(userId);
  const rows = await db.category.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      parentId: true,
      color: true,
      sortOrder: true,
      isSystem: true,
      isDefault: true,
      defaultAmount: true,
      defaultAccountId: true,
      defaultSince: true,
      loans: { select: { id: true, name: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const categories = orderTree(rows).map(({ loans, ...c }) => ({
    ...c,
    parentName: c.parentId ? (byId.get(c.parentId)?.name ?? null) : null,
    /** "Groceries › Dairy" for a subcategory, the name otherwise. */
    path: c.parentId && byId.get(c.parentId) ? `${byId.get(c.parentId)!.name} › ${c.name}` : c.name,
    /** The loan whose EMIs book here, if this is a loan's own category. */
    loan: loans[0] ?? null,
  }));
  return { categories };
});

/** Creates a category (optionally as a subcategory) without budgeting it,
 * e.g. from the expense form. Asking for a name that exists at the top level
 * returns that category, so quick-adds never create a duplicate. */
export const POST = authed(async (req, { userId }) => {
  const input = await parseJson(req, createCategorySchema);
  if (!input.parentId) {
    const dup = await db.category.findFirst({ where: { userId, name: { equals: input.name, mode: "insensitive" } } });
    if (dup) return { category: dup };
  }
  const category = await createCategory(userId, input);
  return Response.json({ category }, { status: 201 });
});
