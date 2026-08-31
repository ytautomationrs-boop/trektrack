-- CreateEnum
CREATE TYPE "WithdrawalMethod" AS ENUM ('PAYSTACK', 'PAYPAL');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "WithdrawalMethod" NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "paystackBankCode" TEXT,
    "paystackAccountNumber" TEXT,
    "paystackAccountName" TEXT,
    "paystackRecipientCode" TEXT,
    "paystackTransferCode" TEXT,
    "paypalEmail" TEXT,
    "paypalPayoutBatchId" TEXT,
    "paypalPayoutItemId" TEXT,
    "failureReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_ledgerEntryId_key" ON "Withdrawal"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "Withdrawal_status_idx" ON "Withdrawal"("status");

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
