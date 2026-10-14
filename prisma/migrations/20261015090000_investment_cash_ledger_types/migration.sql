-- Account entries for moving money to and from investment cash. On their own
-- migration: Postgres can't use an enum value in the transaction that adds it.
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'TO_INVESTMENT_CASH';
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'FROM_INVESTMENT_CASH';
