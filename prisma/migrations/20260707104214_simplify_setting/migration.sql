/*
  Warnings:

  - You are about to drop the column `baseCurrency` on the `Setting` table. All the data in the column will be lost.
  - You are about to drop the column `exchangeRateMode` on the `Setting` table. All the data in the column will be lost.
  - You are about to drop the column `timezone` on the `Setting` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Setting" DROP COLUMN "baseCurrency",
DROP COLUMN "exchangeRateMode",
DROP COLUMN "timezone";
