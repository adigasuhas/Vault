-- CreateEnum
CREATE TYPE "NotebookStatus" AS ENUM ('OPEN', 'CONVERTED');

-- CreateTable
CREATE TABLE "NotebookEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "paidBy" TEXT NOT NULL DEFAULT 'ME',
    "person" TEXT,
    "notes" TEXT,
    "projectId" TEXT,
    "status" "NotebookStatus" NOT NULL DEFAULT 'OPEN',
    "convertedTo" TEXT,
    "convertedId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "sourceExpenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotebookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotebookEntry_sourceExpenseId_key" ON "NotebookEntry"("sourceExpenseId");
CREATE INDEX "NotebookEntry_userId_idx" ON "NotebookEntry"("userId");

-- AddForeignKey
ALTER TABLE "NotebookEntry" ADD CONSTRAINT "NotebookEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotebookEntry" ADD CONSTRAINT "NotebookEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ExpenseProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
