-- Phase 3, Cluster L — F9: persist a daily net-worth snapshot so the trend is
-- real instead of today's value repeated across every past month.
CREATE TABLE "NetWorthSnapshot" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "cash" DECIMAL(65,30) NOT NULL,
  "investments" DECIMAL(65,30) NOT NULL,
  "netWorth" DECIMAL(65,30) NOT NULL,
  "baseCurrency" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NetWorthSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NetWorthSnapshot_userId_date_key" ON "NetWorthSnapshot"("userId", "date");
CREATE INDEX "NetWorthSnapshot_userId_date_idx" ON "NetWorthSnapshot"("userId", "date");
ALTER TABLE "NetWorthSnapshot"
  ADD CONSTRAINT "NetWorthSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
