-- AlterTable
ALTER TABLE "CreditExecution" ADD COLUMN     "bookedAmount" DECIMAL(65,30),
ADD COLUMN     "bookedCurrency" TEXT;
