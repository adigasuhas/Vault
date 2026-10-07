import { db } from "@/lib/db";
import { createAccount } from "@/lib/ledger";

/** Starter categories for an ordinary month: housing and food first, then
 * the costs generic lists tend to miss (fees, learning, family). Users rename
 * or extend them freely. */
export const DEFAULT_CATEGORIES = [
  "Rent & housing",
  "Groceries",
  "Eating out",
  "Transport",
  "Utilities & internet",
  "Phone",
  "Books & learning",
  "Travel",
  "Education & fees",
  "Health",
  "Insurance",
  "Subscriptions",
  "Personal care",
  "Entertainment",
  "Family support",
  "Savings",
  "Miscellaneous",
];

/** Seeds a starter list of category names for a user the first time they're
 * needed, so the category picker isn't empty on day one. These start
 * unmarked (`isDefault: false`) — they won't be auto-added to any month's
 * budget until the user explicitly picks them and/or marks them default.
 *
 * The `count > 0` check is a fast path, not a lock — two requests can both
 * see zero categories and both reach the insert (this happens routinely,
 * since the Budget page fires /api/budget and /api/categories in parallel
 * on first load). `skipDuplicates` relies on the (userId, name) unique
 * constraint to make that race harmless instead of seeding every category
 * twice. */
export async function ensureDefaultCategories(userId: string) {
  const count = await db.category.count({ where: { userId } });
  if (count > 0) return;

  await db.category.createMany({
    data: DEFAULT_CATEGORIES.map((name, index) => ({
      userId,
      name,
      sortOrder: index,
      isDefault: false,
    })),
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
