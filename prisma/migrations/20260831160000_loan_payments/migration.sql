-- Phase 3, Cluster M — F20: make Loans a real amortising instrument by recording
-- actual EMI payments (with principal/interest split) that can post to the ledger.

CREATE TABLE "LoanPayment" (
  "id" TEXT NOT NULL,
  "loanId" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "principalComponent" DECIMAL(65,30) NOT NULL,
  "interestComponent" DECIMAL(65,30) NOT NULL,
  "paidOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoanPayment_amount_positive" CHECK ("amount" > 0)
);
CREATE INDEX "LoanPayment_loanId_idx" ON "LoanPayment"("loanId");
ALTER TABLE "LoanPayment"
  ADD CONSTRAINT "LoanPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" ADD COLUMN "loanPaymentId" TEXT;
CREATE UNIQUE INDEX "LedgerEntry_loanPaymentId_key" ON "LedgerEntry"("loanPaymentId");
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_loanPaymentId_fkey" FOREIGN KEY ("loanPaymentId") REFERENCES "LoanPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
