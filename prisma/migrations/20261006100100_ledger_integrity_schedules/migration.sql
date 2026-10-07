-- Ledger integrity + unified income/payment schedules (Oct 2026).
-- Wrapped in one transaction so the data repair is all-or-nothing.
BEGIN;

-- CreateEnum
CREATE TYPE "ScheduleDirection" AS ENUM ('INCOME', 'PAYMENT');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closureNote" TEXT,
ADD COLUMN     "creditLimit" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "BudgetCategoryAllocation" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "defaultAccountId" TEXT,
ADD COLUMN     "defaultSince" TEXT;

-- AlterTable
ALTER TABLE "CreditExecution" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "occurrenceDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "reversalOfId" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LoanPayment" ADD COLUMN     "occurrenceId" TEXT;

-- AlterTable
ALTER TABLE "ScheduledCredit" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "direction" "ScheduleDirection" NOT NULL DEFAULT 'INCOME',
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'OTHER_INCOME',
ADD COLUMN     "loanId" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "toAmount" DECIMAL(65,30),
ADD COLUMN     "toCurrency" TEXT;

-- CreateTable
CREATE TABLE "ScheduleOverride" (
    "id" TEXT NOT NULL,
    "scheduledCreditId" TEXT NOT NULL,
    "occurrenceDate" TIMESTAMP(3) NOT NULL,
    "date" TIMESTAMP(3),
    "amount" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistoryCache" (
    "key" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistoryCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleOverride_scheduledCreditId_occurrenceDate_key" ON "ScheduleOverride"("scheduledCreditId", "occurrenceDate");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityId_idx" ON "AuditEvent"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditExecution_scheduledCreditId_occurrenceDate_key" ON "CreditExecution"("scheduledCreditId", "occurrenceDate");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_userId_idempotencyKey_key" ON "Expense"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_reversalOfId_key" ON "LedgerEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_date_idx" ON "LedgerEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_categoryId_idx" ON "LedgerEntry"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanPayment_occurrenceId_key" ON "LoanPayment"("occurrenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledCredit_loanId_key" ON "ScheduledCredit"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_userId_idempotencyKey_key" ON "Transfer"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledCredit" ADD CONSTRAINT "ScheduledCredit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledCredit" ADD CONSTRAINT "ScheduledCredit_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleOverride" ADD CONSTRAINT "ScheduleOverride_scheduledCreditId_fkey" FOREIGN KEY ("scheduledCreditId") REFERENCES "ScheduledCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetCategoryAllocation" ADD CONSTRAINT "BudgetCategoryAllocation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "CreditExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===================== Data repair =====================

-- Signed balance effect of a ledger row (mirrors signedAmount() in ledger.ts).
-- Inlined as CASE expressions below.

-- 0. Signed types: ADJUSTMENT, OPENING and REVERSAL carry a non-zero signed
--    amount; every other type a positive magnitude.
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_amount_valid";
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_amount_valid" CHECK (
    ("type" IN ('ADJUSTMENT', 'OPENING', 'REVERSAL') AND "amount" <> 0)
    OR ("type" NOT IN ('ADJUSTMENT', 'OPENING', 'REVERSAL') AND "amount" > 0)
  );
ALTER TABLE "Transfer"
  ADD CONSTRAINT "Transfer_toAmount_positive" CHECK ("toAmount" IS NULL OR "toAmount" > 0);

-- 1. Category on EXPENSE entries, so budgets/analytics read from the ledger.
UPDATE "LedgerEntry" l SET "categoryId" = e."categoryId"
  FROM "Expense" e WHERE l."expenseId" = e.id AND l."categoryId" IS NULL;
UPDATE "LedgerEntry" l SET "categoryId" = ln."categoryId"
  FROM "LoanPayment" p JOIN "Loan" ln ON ln.id = p."loanId"
  WHERE l."loanPaymentId" = p.id AND l."categoryId" IS NULL;

-- 2. Reversed transfers used to have their ledger rows deleted. Rebuild them
--    as the original pair + a REVERSAL pair, so the statement shows what
--    actually happened (net zero, balances unchanged).
CREATE TEMP TABLE _rt AS
  SELECT t.*, gen_random_uuid()::text AS out_id, gen_random_uuid()::text AS in_id
  FROM "Transfer" t
  WHERE t."reversedAt" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" l WHERE l."transferId" = t.id);
INSERT INTO "LedgerEntry" (id, "userId", "accountId", type, amount, currency, date, description, "transferId", "reversedAt", "createdAt")
  SELECT out_id, "userId", "fromAccountId", 'TRANSFER_OUT'::"LedgerEntryType", amount, currency, date, notes, id, "reversedAt", "createdAt" FROM _rt
  UNION ALL
  SELECT in_id, "userId", "toAccountId", 'TRANSFER_IN'::"LedgerEntryType", amount, currency, date, notes, id, "reversedAt", "createdAt" FROM _rt;
INSERT INTO "LedgerEntry" (id, "userId", "accountId", type, amount, currency, date, description, "transferId", "reversalOfId", "createdAt")
  SELECT gen_random_uuid()::text, "userId", "fromAccountId", 'REVERSAL'::"LedgerEntryType", amount, currency, greatest(date, date_trunc('day', "reversedAt")), 'Transfer reversed', id, out_id, "reversedAt" FROM _rt
  UNION ALL
  SELECT gen_random_uuid()::text, "userId", "toAccountId", 'REVERSAL'::"LedgerEntryType", -amount, currency, greatest(date, date_trunc('day', "reversedAt")), 'Transfer reversed', id, in_id, "reversedAt" FROM _rt;

-- 3. Same for scheduled credits that were confirmed then reversed.
CREATE TEMP TABLE _rc AS
  SELECT x.id AS ex_id, x.amount, x."executedDate", x."confirmedAt", x."reversedAt",
         s."userId", s."receivingAccountId", s.currency, s.name, gen_random_uuid()::text AS inc_id
  FROM "CreditExecution" x JOIN "ScheduledCredit" s ON s.id = x."scheduledCreditId"
  WHERE x.status = 'REVERSED'
    AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" l WHERE l."creditExecutionId" = x.id);
INSERT INTO "LedgerEntry" (id, "userId", "accountId", type, amount, currency, date, description, "creditExecutionId", "reversedAt", "createdAt")
  SELECT inc_id, "userId", "receivingAccountId", 'INCOME'::"LedgerEntryType", amount, currency, date_trunc('day', coalesce("confirmedAt", "executedDate")), name, ex_id, coalesce("reversedAt", now()), coalesce("confirmedAt", "executedDate") FROM _rc;
INSERT INTO "LedgerEntry" (id, "userId", "accountId", type, amount, currency, date, description, "reversalOfId", "createdAt")
  SELECT gen_random_uuid()::text, "userId", "receivingAccountId", 'REVERSAL'::"LedgerEntryType", -amount, currency, greatest(date_trunc('day', coalesce("confirmedAt", "executedDate")), date_trunc('day', coalesce("reversedAt", now()))), name || ' — reversed', inc_id, coalesce("reversedAt", now()) FROM _rc;

-- 4. Opening balance becomes a ledger entry. openingBalance was overwritten
--    by corrections (which also posted an ADJUSTMENT), so the true original
--    opening is whatever makes Σ entries equal the current balance.
INSERT INTO "LedgerEntry" (id, "userId", "accountId", type, amount, currency, date, description, "createdAt")
  SELECT gen_random_uuid()::text, a."userId", a.id, 'OPENING'::"LedgerEntryType", diff, a.currency,
         date_trunc('day', least(a."openingDate", coalesce(first_entry, a."openingDate"))),
         'Opening balance', a."createdAt"
  FROM (
    SELECT a.*,
      a."currentBalance" - coalesce((
        SELECT sum(CASE WHEN l.type IN ('EXPENSE', 'TRANSFER_OUT') THEN -l.amount ELSE l.amount END)
        FROM "LedgerEntry" l WHERE l."accountId" = a.id), 0) AS diff,
      (SELECT min(l.date) FROM "LedgerEntry" l WHERE l."accountId" = a.id) AS first_entry
    FROM "Account" a
  ) a
  WHERE diff <> 0;

-- 5. Recurring categories only apply from the month they were created.
UPDATE "Category" SET "defaultSince" = to_char("createdAt", 'YYYY-MM')
  WHERE "isDefault" AND "defaultSince" IS NULL;

COMMIT;
