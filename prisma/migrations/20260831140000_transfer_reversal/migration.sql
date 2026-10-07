-- Phase 2, Cluster H — F8: allow a transfer to be reversed instead of being permanent.
ALTER TABLE "Transfer" ADD COLUMN "reversedAt" TIMESTAMP(3);
