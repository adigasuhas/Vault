-- CreateTable
CREATE TABLE "InvestmentCategory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentCategoryLink" (
    "categoryId" TEXT NOT NULL,
    "kind" "InvestmentKind" NOT NULL,
    "holdingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentCategoryLink_pkey" PRIMARY KEY ("categoryId","kind","holdingId")
);

-- CreateIndex
CREATE INDEX "InvestmentCategory_userId_idx" ON "InvestmentCategory"("userId");
CREATE UNIQUE INDEX "InvestmentCategory_userId_name_key" ON "InvestmentCategory"("userId", "name");
-- Names are unique per user regardless of capitals ("banking" = "Banking").
CREATE UNIQUE INDEX "InvestmentCategory_userId_lower_name_key" ON "InvestmentCategory"("userId", LOWER("name"));
CREATE INDEX "InvestmentCategoryLink_kind_holdingId_idx" ON "InvestmentCategoryLink"("kind", "holdingId");

-- AddForeignKey
ALTER TABLE "InvestmentCategory" ADD CONSTRAINT "InvestmentCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvestmentCategoryLink" ADD CONSTRAINT "InvestmentCategoryLink_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InvestmentCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
