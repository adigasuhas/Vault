-- Categories on individual stock purchases. Existing stock-level categories
-- are left as they are; no purchase is given a category it didn't have.
CREATE TABLE "StockLotCategoryLink" (
    "categoryId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLotCategoryLink_pkey" PRIMARY KEY ("categoryId","lotId")
);

CREATE INDEX "StockLotCategoryLink_lotId_idx" ON "StockLotCategoryLink"("lotId");

ALTER TABLE "StockLotCategoryLink" ADD CONSTRAINT "StockLotCategoryLink_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InvestmentCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
