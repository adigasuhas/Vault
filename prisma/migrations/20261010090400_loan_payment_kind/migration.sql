-- AlterTable
ALTER TABLE "LoanPayment" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'EMI';
-- Pay-offs recorded before this column existed.
UPDATE "LoanPayment" SET "kind" = 'PAYOFF' WHERE "note" = 'Paid off';
