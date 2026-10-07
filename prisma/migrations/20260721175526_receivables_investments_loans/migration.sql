-- ============================================================
-- Receivables: one-time frequency
-- ============================================================
ALTER TYPE "RecurrenceFrequency" ADD VALUE 'ONE_TIME';

-- ============================================================
-- Budget: category-level default amount, so a category that
-- auto-populates every month (e.g. a Loan EMI) can start each
-- new month already funded instead of at 0.
-- ============================================================
ALTER TABLE "Category" ADD COLUMN "defaultAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- ============================================================
-- Investments: stock purchase lots + previous-close for day change
-- ============================================================
ALTER TABLE "StockHolding" ADD COLUMN "previousClose" DECIMAL(65,30);

CREATE TABLE "StockPurchaseLot" (
    "id" TEXT NOT NULL,
    "stockHoldingId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockPurchaseLot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockPurchaseLot_stockHoldingId_idx" ON "StockPurchaseLot"("stockHoldingId");

ALTER TABLE "StockPurchaseLot" ADD CONSTRAINT "StockPurchaseLot_stockHoldingId_fkey" FOREIGN KEY ("stockHoldingId") REFERENCES "StockHolding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Merge any existing holdings that are really the same position bought in
-- multiple purchases (same user, ticker, exchange, currency) — quantity
-- sums, avgBuyPrice becomes the quantity-weighted average, and the earliest
-- purchaseDate is kept. Every original holding row (the kept one and every
-- merged one) becomes a StockPurchaseLot under the surviving row, so no
-- purchase history is lost.
CREATE TEMP TABLE "_stock_dupes" AS
SELECT h.id AS dup_id, keep.id AS keep_id
FROM "StockHolding" h
JOIN (
  SELECT DISTINCT ON ("userId", ticker, COALESCE(exchange, ''), currency) id, "userId", ticker, exchange, currency
  FROM "StockHolding"
  ORDER BY "userId", ticker, COALESCE(exchange, ''), currency, "createdAt" ASC, id ASC
) keep ON keep."userId" = h."userId"
  AND keep.ticker = h.ticker
  AND COALESCE(keep.exchange, '') = COALESCE(h.exchange, '')
  AND keep.currency = h.currency
WHERE h.id <> keep.id;

-- One lot per pre-existing holding row (dup or kept), all pointing at the
-- surviving holding.
INSERT INTO "StockPurchaseLot" ("id", "stockHoldingId", "quantity", "price", "purchaseDate", "createdAt")
SELECT gen_random_uuid(), COALESCE(d.keep_id, h.id), h.quantity, h."avgBuyPrice", h."purchaseDate", CURRENT_TIMESTAMP
FROM "StockHolding" h
LEFT JOIN "_stock_dupes" d ON d.dup_id = h.id;

-- Recompute the surviving holding's aggregate quantity/avgBuyPrice/earliest
-- purchaseDate from its lots (covers both merged and untouched holdings).
UPDATE "StockHolding" h
SET
  quantity = agg.total_qty,
  "avgBuyPrice" = agg.weighted_avg,
  "purchaseDate" = agg.earliest_date
FROM (
  SELECT "stockHoldingId", SUM(quantity) AS total_qty, SUM(quantity * price) / SUM(quantity) AS weighted_avg, MIN("purchaseDate") AS earliest_date
  FROM "StockPurchaseLot"
  GROUP BY "stockHoldingId"
) agg
WHERE h.id = agg."stockHoldingId";

DELETE FROM "StockHolding" WHERE id IN (SELECT dup_id FROM "_stock_dupes");

DROP TABLE "_stock_dupes";

-- ============================================================
-- Remove Goals, add Loans
-- ============================================================
DROP TABLE "Goal";
DROP TYPE "GoalStatus";

CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'CLOSED');

CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "principal" DECIMAL(65,30) NOT NULL,
    "interestRate" DECIMAL(65,30) NOT NULL,
    "installments" INTEGER NOT NULL,
    "emiAmount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "linkedAccountId" TEXT,
    "categoryId" TEXT,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Loan_userId_idx" ON "Loan"("userId");

ALTER TABLE "Loan" ADD CONSTRAINT "Loan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
