-- Mutual funds: individual purchases, like stock lots.
-- CreateTable
CREATE TABLE "MutualFundLot" (
    "id" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "units" DECIMAL(65,30) NOT NULL,
    "nav" DECIMAL(65,30) NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MutualFundLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MutualFundLot_holdingId_idx" ON "MutualFundLot"("holdingId");

-- AddForeignKey
ALTER TABLE "MutualFundLot" ADD CONSTRAINT "MutualFundLot_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "MutualFundHolding"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Each existing fund becomes one purchase at its average NAV.
INSERT INTO "MutualFundLot" (id, "holdingId", units, nav, "purchaseDate", "createdAt")
  SELECT gen_random_uuid()::text, id, units, "avgNav", "purchaseDate", "createdAt" FROM "MutualFundHolding";
ALTER TABLE "MutualFundLot"
  ADD CONSTRAINT "MutualFundLot_units_positive" CHECK (units > 0),
  ADD CONSTRAINT "MutualFundLot_nav_nonneg" CHECK (nav >= 0);
