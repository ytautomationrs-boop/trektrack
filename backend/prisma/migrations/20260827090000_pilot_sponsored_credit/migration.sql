-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEntryType" ADD VALUE 'SPONSORED_CREDIT';
ALTER TYPE "LedgerEntryType" ADD VALUE 'SPONSORED_CREDIT_EXPENSE';

-- AlterEnum
ALTER TYPE "WithdrawalMethod" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "manualAccountName" TEXT,
ADD COLUMN     "manualAccountNumber" TEXT,
ADD COLUMN     "manualBankName" TEXT,
ADD COLUMN     "manualReference" TEXT,
ADD COLUMN     "resolvedByUserId" TEXT;
