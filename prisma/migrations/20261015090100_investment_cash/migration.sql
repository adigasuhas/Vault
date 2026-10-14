-- Investment cash: a balance (per currency) of money realised from sales or
-- added from an account, waiting to be reinvested or withdrawn. Kept as an
-- append-only list of entries, like the account ledger.
--
-- Existing data: proceeds a sale "kept for reinvestment" (no account) move
-- into investment cash, and every reinvestment recorded against a sale becomes
-- a purchase paid from it. Each sale's remaining proceeds (net - credited -
-- reinvested) therefore equal its contribution to the new balance, so no money
-- appears or disappears. Undone sales are left alone: their proceeds were
-- already taken back. The old JSON stays in place for history.
BEGIN;

CREATE TYPE "SaleProceeds" AS ENUM ('ACCOUNT', 'INVESTMENT_CASH', 'TRACKING');
CREATE TYPE "InvestmentCashEntryType" AS ENUM ('SALE_PROCEEDS', 'PURCHASE', 'FROM_ACCOUNT', 'TO_ACCOUNT', 'REVERSAL');

ALTER TABLE "InvestmentSale" ADD COLUMN "proceeds" "SaleProceeds" NOT NULL DEFAULT 'ACCOUNT';

CREATE TABLE "InvestmentCashEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "type" "InvestmentCashEntryType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "saleId" TEXT,
    "investmentRef" TEXT,
    "ledgerEntryId" TEXT,
    "reversalOfId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentCashEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RequestKey" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestKey_pkey" PRIMARY KEY ("userId","key")
);

CREATE UNIQUE INDEX "InvestmentCashEntry_ledgerEntryId_key" ON "InvestmentCashEntry"("ledgerEntryId");
CREATE UNIQUE INDEX "InvestmentCashEntry_reversalOfId_key" ON "InvestmentCashEntry"("reversalOfId");
CREATE INDEX "InvestmentCashEntry_userId_currency_idx" ON "InvestmentCashEntry"("userId", "currency");
CREATE INDEX "InvestmentCashEntry_investmentRef_idx" ON "InvestmentCashEntry"("investmentRef");
CREATE INDEX "InvestmentCashEntry_saleId_idx" ON "InvestmentCashEntry"("saleId");

ALTER TABLE "InvestmentCashEntry" ADD CONSTRAINT "InvestmentCashEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvestmentCashEntry" ADD CONSTRAINT "InvestmentCashEntry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "InvestmentSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvestmentCashEntry" ADD CONSTRAINT "InvestmentCashEntry_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvestmentCashEntry" ADD CONSTRAINT "InvestmentCashEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "InvestmentCashEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sales whose proceeds never reached an account.
UPDATE "InvestmentSale" SET "proceeds" = 'INVESTMENT_CASH' WHERE "accountId" IS NULL;

-- Their net proceeds arrive in investment cash on the sale day.
INSERT INTO "InvestmentCashEntry" ("id", "userId", "currency", "type", "amount", "date", "description", "saleId")
SELECT gen_random_uuid()::text, s."userId", s."currency", 'SALE_PROCEEDS', s."netProceeds", s."soldOn", 'Proceeds of the ' || s."name" || ' sale', s."id"
FROM "InvestmentSale" s
WHERE s."reversedAt" IS NULL AND s."accountId" IS NULL;

-- Kept, partly reinvested, and the rest later moved to an account: only the
-- reinvested part passed through investment cash.
INSERT INTO "InvestmentCashEntry" ("id", "userId", "currency", "type", "amount", "date", "description", "saleId")
SELECT gen_random_uuid()::text, s."userId", s."currency", 'SALE_PROCEEDS',
       (SELECT COALESCE(SUM((r->>'amount')::numeric), 0) FROM jsonb_array_elements(s."reinvestments") r),
       s."soldOn", 'Proceeds of the ' || s."name" || ' sale (reinvested part)', s."id"
FROM "InvestmentSale" s
WHERE s."reversedAt" IS NULL AND s."accountId" IS NOT NULL
  AND jsonb_typeof(s."reinvestments") = 'array' AND jsonb_array_length(s."reinvestments") > 0;

-- Every recorded reinvestment is a purchase paid from investment cash. `ref`
-- ties it to the purchase when there is one (deleting it gives the money back).
INSERT INTO "InvestmentCashEntry" ("id", "userId", "currency", "type", "amount", "date", "description", "investmentRef")
SELECT gen_random_uuid()::text, s."userId", s."currency", 'PURCHASE', (r->>'amount')::numeric,
       COALESCE(((r->>'date')::timestamptz AT TIME ZONE 'UTC'), s."soldOn"),
       'Reinvested in ' || COALESCE(r->>'into', 'another investment'), NULLIF(r->>'ref', '')
FROM "InvestmentSale" s
CROSS JOIN LATERAL jsonb_array_elements(s."reinvestments") r
WHERE s."reversedAt" IS NULL AND jsonb_typeof(s."reinvestments") = 'array';

-- Same rule as the account ledger: reversals are signed, everything else is a
-- positive magnitude.
ALTER TABLE "InvestmentCashEntry"
  ADD CONSTRAINT "InvestmentCashEntry_amount_valid" CHECK (
    ("type" = 'REVERSAL' AND "amount" <> 0)
    OR ("type" <> 'REVERSAL' AND "amount" > 0)
  );

COMMIT;
