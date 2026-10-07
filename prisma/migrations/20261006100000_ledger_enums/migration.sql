-- New enum values live in their own migration: Postgres can't use a value
-- added in the same transaction.
ALTER TYPE "AccountType" ADD VALUE 'PREPAID_CARD';
ALTER TYPE "AccountType" ADD VALUE 'FOREX_CARD';
ALTER TYPE "CreditExecutionStatus" ADD VALUE 'FAILED';
ALTER TYPE "LedgerEntryType" ADD VALUE 'OPENING';
ALTER TYPE "LedgerEntryType" ADD VALUE 'REVERSAL';
