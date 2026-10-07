-- CreateEnum
CREATE TYPE "CreditExecutionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SKIPPED');

-- AlterTable: due occurrences require manual confirmation by default going forward.
ALTER TABLE "ScheduledCredit" ADD COLUMN "requiresConfirmation" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "CreditExecution" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "CreditExecution" ADD COLUMN "status" "CreditExecutionStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill: every existing CreditExecution was created by the old
-- always-auto-post behavior, so it already moved money — mark it CONFIRMED
-- (not the new PENDING default) so it isn't mistaken for an unconfirmed
-- credit awaiting action.
UPDATE "CreditExecution" SET "status" = 'CONFIRMED', "confirmedAt" = "executedDate";

-- CreateIndex
CREATE INDEX "CreditExecution_status_idx" ON "CreditExecution"("status");
