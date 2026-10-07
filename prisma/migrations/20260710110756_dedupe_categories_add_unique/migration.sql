-- Merges duplicate (userId, name) categories created by a check-then-insert
-- race in ensureDefaultCategories (two concurrent requests both saw zero
-- categories and both seeded the starter set), then adds a unique
-- constraint so the race can no longer produce duplicates going forward.

-- Map each duplicate row to the one row per (userId, name) we keep (the
-- oldest by createdAt, ties broken by id).
CREATE TEMP TABLE "_category_dupes" AS
SELECT c.id AS dup_id, keep.id AS keep_id
FROM "Category" c
JOIN (
  SELECT DISTINCT ON ("userId", name) id, "userId", name
  FROM "Category"
  ORDER BY "userId", name, "createdAt" ASC, id ASC
) keep ON keep."userId" = c."userId" AND keep.name = c.name
WHERE c.id <> keep.id;

-- Drop duplicate-category allocations that would collide with the kept
-- category's allocation in the same budget plan (the (budgetPlanId,
-- categoryId) unique constraint would otherwise block the repoint below).
DELETE FROM "BudgetCategoryAllocation" bca
USING "_category_dupes" d
WHERE bca."categoryId" = d.dup_id
  AND EXISTS (
    SELECT 1 FROM "BudgetCategoryAllocation" bca2
    WHERE bca2."categoryId" = d.keep_id AND bca2."budgetPlanId" = bca."budgetPlanId"
  );

-- Repoint remaining allocations, and any expenses, from the duplicate to
-- the kept category.
UPDATE "BudgetCategoryAllocation" bca
SET "categoryId" = d.keep_id
FROM "_category_dupes" d
WHERE bca."categoryId" = d.dup_id;

UPDATE "Expense" e
SET "categoryId" = d.keep_id
FROM "_category_dupes" d
WHERE e."categoryId" = d.dup_id;

DELETE FROM "Category" c
USING "_category_dupes" d
WHERE c.id = d.dup_id;

DROP TABLE "_category_dupes";

-- AddUniqueConstraint
ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_name_key" UNIQUE ("userId", "name");
