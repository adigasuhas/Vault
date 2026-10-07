-- Realised sales of investments (stocks, fund units, deposits, other assets).
-- Proceeds reach an account through an INVESTMENT_SALE ledger entry.
BEGIN;

CREATE TYPE "InvestmentKind" AS ENUM ('STOCK', 'MUTUAL_FUND', 'FIXED_DEPOSIT', 'OTHER');

CREATE TABLE "InvestmentSale" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "InvestmentKind" NOT NULL,
    "holdingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT,
    "currency" TEXT NOT NULL,
    "quantity" DECIMAL(65,30),
    "price" DECIMAL(65,30),
    "grossProceeds" DECIMAL(65,30) NOT NULL,
    "charges" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "netProceeds" DECIMAL(65,30) NOT NULL,
    "costBasis" DECIMAL(65,30) NOT NULL,
    "realizedPnl" DECIMAL(65,30) NOT NULL,
    "firstBoughtOn" TIMESTAMP(3) NOT NULL,
    "soldOn" TIMESTAMP(3) NOT NULL,
    "closedPosition" BOOLEAN NOT NULL,
    "accountId" TEXT NOT NULL,
    "creditedAmount" DECIMAL(65,30) NOT NULL,
    "lots" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentSale_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InvestmentSale_amounts_valid" CHECK (
      "grossProceeds" > 0 AND "charges" >= 0 AND "netProceeds" > 0
      AND "costBasis" >= 0 AND "creditedAmount" > 0
      AND ("quantity" IS NULL OR "quantity" > 0)
      AND ("price" IS NULL OR "price" >= 0)
    )
);

CREATE INDEX "InvestmentSale_userId_soldOn_idx" ON "InvestmentSale"("userId", "soldOn");

ALTER TABLE "InvestmentSale" ADD CONSTRAINT "InvestmentSale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvestmentSale" ADD CONSTRAINT "InvestmentSale_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" ADD COLUMN "investmentSaleId" TEXT;
CREATE UNIQUE INDEX "LedgerEntry_investmentSaleId_key" ON "LedgerEntry"("investmentSaleId");
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_investmentSaleId_fkey" FOREIGN KEY ("investmentSaleId") REFERENCES "InvestmentSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
