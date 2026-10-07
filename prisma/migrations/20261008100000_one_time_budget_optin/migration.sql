-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "countInBudget" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "countInBudget" BOOLEAN NOT NULL DEFAULT false;

