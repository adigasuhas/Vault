-- Lets a confirmed (already-credited) scheduled-credit occurrence be
-- reversed — undoes the ledger entry and account balance change, and
-- records when it happened separately from the original confirmation.
ALTER TYPE "CreditExecutionStatus" ADD VALUE 'REVERSED';

ALTER TABLE "CreditExecution" ADD COLUMN "reversedAt" TIMESTAMP(3);
