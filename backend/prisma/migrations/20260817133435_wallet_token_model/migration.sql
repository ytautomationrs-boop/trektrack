/*
  Warnings:

  - You are about to drop the column `stripePaymentIntentId` on the `ChallengeParticipant` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEntryType" ADD VALUE 'DEPOSIT';
ALTER TYPE "LedgerEntryType" ADD VALUE 'WITHDRAWAL';

-- AlterTable
ALTER TABLE "ChallengeParticipant" DROP COLUMN "stripePaymentIntentId";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "walletBalanceCents" INTEGER NOT NULL DEFAULT 0;
