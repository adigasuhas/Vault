-- Sales recorded once per form session; a cache for company research.
-- AlterTable
ALTER TABLE "InvestmentSale" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateTable
CREATE TABLE "ResearchCache" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentSale_userId_idempotencyKey_key" ON "InvestmentSale"("userId", "idempotencyKey");
