-- AlterEnum (its own migration: a new enum value can't be used in the same transaction)
ALTER TYPE "LedgerEntryType" ADD VALUE 'INVESTMENT_PURCHASE';
