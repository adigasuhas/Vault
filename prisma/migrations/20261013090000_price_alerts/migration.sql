-- Price targets / stop-losses on stocks, and the notifications they raise.
-- CreateEnum
CREATE TYPE "PriceAlertKind" AS ENUM ('TARGET', 'STOP_LOSS');

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "notifyPriceAlerts" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "StockPriceAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stockHoldingId" TEXT NOT NULL,
    "categoryId" TEXT,
    "lotId" TEXT,
    "targetPrice" DECIMAL(65,30),
    "stopLossPrice" DECIMAL(65,30),
    "targetArmed" BOOLEAN NOT NULL DEFAULT true,
    "stopArmed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockPriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAlertEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertId" TEXT,
    "stockHoldingId" TEXT,
    "kind" "PriceAlertKind" NOT NULL,
    "ticker" TEXT NOT NULL,
    "exchange" TEXT,
    "scopeLabel" TEXT,
    "threshold" DECIMAL(65,30) NOT NULL,
    "observedPrice" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "priceAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "PriceAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockPriceAlert_userId_idx" ON "StockPriceAlert"("userId");

-- CreateIndex
CREATE INDEX "StockPriceAlert_stockHoldingId_idx" ON "StockPriceAlert"("stockHoldingId");

-- CreateIndex
CREATE INDEX "PriceAlertEvent_userId_createdAt_idx" ON "PriceAlertEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockPriceAlert" ADD CONSTRAINT "StockPriceAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPriceAlert" ADD CONSTRAINT "StockPriceAlert_stockHoldingId_fkey" FOREIGN KEY ("stockHoldingId") REFERENCES "StockHolding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPriceAlert" ADD CONSTRAINT "StockPriceAlert_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InvestmentCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlertEvent" ADD CONSTRAINT "PriceAlertEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlertEvent" ADD CONSTRAINT "PriceAlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "StockPriceAlert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
