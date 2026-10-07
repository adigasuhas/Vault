-- Secret-question recovery + one-time (non-budgeted) expenses.
-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "oneTime" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "oneTime" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "recoveryFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recoveryLockedUntil" TIMESTAMP(3),
ADD COLUMN     "securityAnswerHash" TEXT,
ADD COLUMN     "securityQuestion" TEXT;

-- CreateTable
CREATE TABLE "ExpenseProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseProject_userId_idx" ON "ExpenseProject"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseProject_userId_name_key" ON "ExpenseProject"("userId", "name");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ExpenseProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseProject" ADD CONSTRAINT "ExpenseProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

