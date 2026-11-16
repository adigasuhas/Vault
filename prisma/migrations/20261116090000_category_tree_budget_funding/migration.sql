-- Hierarchical categories and funded budgets.
--
-- 1. Category.parentId: an optional parent, one level deep (Groceries › Dairy).
--    Every existing category stays top-level, so nothing about existing
--    spending, budgets or reports changes until the user regroups them.
--    Category.isSystem marks VAULT's starter categories.
-- 2. BudgetSource / BudgetFunding: the money a month's budget draws on (an
--    income occurrence, or part of an account balance) and how much of each
--    line it pays for. Planning only: no ledger rows, no balance changes.
-- 3. BudgetCategoryAllocation.loanId / paymentScheduleId: optional links from
--    a budget line to the loan or scheduled payment it plans for.

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "BudgetCategoryAllocation" ADD COLUMN     "loanId" TEXT,
ADD COLUMN     "paymentScheduleId" TEXT;

-- CreateTable
CREATE TABLE "BudgetSource" (
    "id" TEXT NOT NULL,
    "budgetPlanId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "scheduledCreditId" TEXT,
    "occurrenceDate" TIMESTAMP(3),
    "accountId" TEXT,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetFunding" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetFunding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetSource_scheduledCreditId_idx" ON "BudgetSource"("scheduledCreditId");

-- CreateIndex
CREATE INDEX "BudgetSource_accountId_idx" ON "BudgetSource"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetSource_budgetPlanId_sourceKey_key" ON "BudgetSource"("budgetPlanId", "sourceKey");

-- CreateIndex
CREATE INDEX "BudgetFunding_sourceId_idx" ON "BudgetFunding"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetFunding_allocationId_sourceId_key" ON "BudgetFunding"("allocationId", "sourceId");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetCategoryAllocation" ADD CONSTRAINT "BudgetCategoryAllocation_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetCategoryAllocation" ADD CONSTRAINT "BudgetCategoryAllocation_paymentScheduleId_fkey" FOREIGN KEY ("paymentScheduleId") REFERENCES "ScheduledCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetSource" ADD CONSTRAINT "BudgetSource_budgetPlanId_fkey" FOREIGN KEY ("budgetPlanId") REFERENCES "BudgetPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetSource" ADD CONSTRAINT "BudgetSource_scheduledCreditId_fkey" FOREIGN KEY ("scheduledCreditId") REFERENCES "ScheduledCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetSource" ADD CONSTRAINT "BudgetSource_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetFunding" ADD CONSTRAINT "BudgetFunding_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "BudgetCategoryAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetFunding" ADD CONSTRAINT "BudgetFunding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "BudgetSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Planning amounts are positive; a receivable source names its occurrence.
ALTER TABLE "BudgetSource" ADD CONSTRAINT "BudgetSource_kind_check" CHECK ("kind" IN ('RECEIVABLE', 'ACCOUNT'));
ALTER TABLE "BudgetSource" ADD CONSTRAINT "BudgetSource_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "BudgetSource" ADD CONSTRAINT "BudgetSource_receivable_has_date" CHECK ("kind" <> 'RECEIVABLE' OR "occurrenceDate" IS NOT NULL);
ALTER TABLE "BudgetFunding" ADD CONSTRAINT "BudgetFunding_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Category" ADD CONSTRAINT "Category_not_own_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- The tree stays two levels deep, inside one user's categories, and loop-free.
CREATE OR REPLACE FUNCTION "vault_category_tree_check"() RETURNS trigger AS $$
DECLARE
    parent_user TEXT;
    parent_parent TEXT;
BEGIN
    IF NEW."parentId" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "userId", "parentId" INTO parent_user, parent_parent FROM "Category" WHERE "id" = NEW."parentId";
    IF NOT FOUND OR parent_user <> NEW."userId" THEN
        RAISE EXCEPTION 'Parent category not found.' USING ERRCODE = 'check_violation';
    END IF;
    IF parent_parent IS NOT NULL THEN
        RAISE EXCEPTION 'A subcategory can''t have subcategories of its own.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "Category" WHERE "parentId" = NEW."id") THEN
        RAISE EXCEPTION 'A category with subcategories can''t become a subcategory.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Category_tree_check" ON "Category";
CREATE TRIGGER "Category_tree_check"
    BEFORE INSERT OR UPDATE OF "parentId", "userId" ON "Category"
    FOR EACH ROW EXECUTE FUNCTION "vault_category_tree_check"();

-- VAULT's starter categories, as seeded until now.
UPDATE "Category" SET "isSystem" = true
WHERE "name" IN (
    'Rent & housing', 'Groceries', 'Eating out', 'Transport', 'Utilities & internet', 'Phone',
    'Books & learning', 'Travel', 'Education & fees', 'Health', 'Insurance', 'Subscriptions',
    'Personal care', 'Entertainment', 'Family support', 'Savings', 'Miscellaneous'
);
