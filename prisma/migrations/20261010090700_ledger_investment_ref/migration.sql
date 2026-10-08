-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "investmentRef" TEXT;

-- CreateIndex
CREATE INDEX "LedgerEntry_investmentRef_idx" ON "LedgerEntry"("investmentRef");
