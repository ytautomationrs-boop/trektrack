/*
  Warnings:

  - You are about to drop the column `stripeObjectId` on the `LedgerEntry` table. All the data in the column will be lost.
  - You are about to drop the column `stripeObjectType` on the `LedgerEntry` table. All the data in the column will be lost.
  - You are about to drop the column `stripeObjectId` on the `Payout` table. All the data in the column will be lost.
  - You are about to drop the column `stripeCustomerId` on the `User` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "User_stripeCustomerId_key";

-- AlterTable
ALTER TABLE "LedgerEntry" DROP COLUMN "stripeObjectId",
DROP COLUMN "stripeObjectType",
ADD COLUMN     "externalProvider" TEXT,
ADD COLUMN     "externalRef" TEXT;

-- AlterTable
ALTER TABLE "Payout" DROP COLUMN "stripeObjectId",
ADD COLUMN     "externalRef" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "stripeCustomerId";
