-- Primary/secondary currency + per-plan budget currency.
-- AlterTable
ALTER TABLE "BudgetPlan" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "defaultCurrency" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "budgetCurrency" TEXT,
ADD COLUMN     "secondaryCurrency" TEXT;


-- Existing plans were implicitly in the owner's base currency.
UPDATE "BudgetPlan" p SET currency = u."baseCurrency" FROM "User" u WHERE u.id = p."userId";
UPDATE "Category" c SET "defaultCurrency" = u."baseCurrency" FROM "User" u WHERE u.id = c."userId" AND c."defaultCurrency" IS NULL;
