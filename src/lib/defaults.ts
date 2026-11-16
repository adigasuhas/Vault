import { db } from "@/lib/db";
import { createAccount } from "@/lib/ledger";
import { DEFAULT_CATEGORIES, STARTER_GROUPS } from "@/lib/category-starters";

export { DEFAULT_CATEGORIES, STARTER_GROUPS };

/** Seeds the starter categories, grouped, for a user the first time they're
 * needed, so the category picker isn't empty on day one. They start
 * unmarked (`isDefault: false`): none is added to a month's budget until
 * the user picks it or makes it repeat.
 *
 * The `count > 0` check is a fast path, not a lock: two requests can both
 * see zero categories and both reach the insert (this happens routinely,
 * since the Budget page fires /api/budget and /api/categories in parallel
 * on first load). `skipDuplicates` relies on the (userId, name) unique
 * constraint to make that race harmless instead of seeding twice. */
export async function ensureDefaultCategories(userId: string) {
  const count = await db.category.count({ where: { userId } });
  if (count > 0) return;

  const grouped = new Set(STARTER_GROUPS.flatMap((g) => g.children));
  const tops = [...STARTER_GROUPS.map((g) => g.name), ...DEFAULT_CATEGORIES.filter((n) => !grouped.has(n))];
  // Groups first, in the order above, then the ungrouped starters in theirs.
  await db.category.createMany({
    data: tops.map((name, index) => ({ userId, name, sortOrder: index, isDefault: false, isSystem: true })),
    skipDuplicates: true,
  });
  const parents = await db.category.findMany({ where: { userId, name: { in: STARTER_GROUPS.map((g) => g.name) } }, select: { id: true, name: true } });
  const parentId = new Map(parents.map((p) => [p.name, p.id]));
  await db.category.createMany({
    data: STARTER_GROUPS.flatMap((g) => g.children.map((name, index) => ({ userId, name, sortOrder: index, isDefault: false, isSystem: true, parentId: parentId.get(g.name) ?? null }))),
    skipDuplicates: true,
  });
}

/** Seeds a demo savings account + settings row for the Developer Mode account. */
export async function ensureDevDemoData(userId: string, baseCurrency: string) {
  await ensureDefaultCategories(userId);

  const accountCount = await db.account.count({ where: { userId } });
  if (accountCount === 0) {
    await createAccount(userId, {
      name: "Primary Savings",
      bankName: "Demo Bank",
      currency: baseCurrency,
      accountType: "SAVINGS",
      openingBalance: 50000,
      notes: "Demo account seeded for Developer Mode.",
    });
  }

  await db.setting.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}
