-- Reversed EMI payments stay on record instead of being deleted.
ALTER TABLE "LoanPayment" ADD COLUMN "reversedAt" TIMESTAMP(3);
