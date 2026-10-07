-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "accountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LedgerEntry" ALTER COLUMN "accountId" DROP NOT NULL;

