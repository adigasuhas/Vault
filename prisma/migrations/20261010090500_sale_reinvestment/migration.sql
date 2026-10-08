-- Sales can keep their proceeds for reinvestment instead of crediting an account.
ALTER TABLE "InvestmentSale" ALTER COLUMN "accountId" DROP NOT NULL,
ALTER COLUMN "creditedAmount" DROP NOT NULL,
ADD COLUMN     "creditedNet" DECIMAL(65,30),
ADD COLUMN     "reinvestments" JSONB NOT NULL DEFAULT '[]';

-- Every earlier sale credited all of its net proceeds to its account.
UPDATE "InvestmentSale" SET "creditedNet" = "netProceeds" WHERE "accountId" IS NOT NULL;
