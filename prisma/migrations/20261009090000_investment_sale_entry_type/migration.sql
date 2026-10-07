-- Own migration: Postgres can't use an enum value in the transaction that adds it.
ALTER TYPE "LedgerEntryType" ADD VALUE 'INVESTMENT_SALE';
