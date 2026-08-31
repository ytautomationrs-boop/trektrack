-- CreateEnum
CREATE TYPE "DepositIntentStatus" AS ENUM ('PENDING', 'COMPLETED', 'ABANDONED', 'FAILED');

-- CreateTable
CREATE TABLE "DepositIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'zar',
    "status" "DepositIntentStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepositIntent_reference_key" ON "DepositIntent"("reference");

-- CreateIndex
CREATE INDEX "DepositIntent_status_createdAt_idx" ON "DepositIntent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DepositIntent_userId_idx" ON "DepositIntent"("userId");

-- AddForeignKey
ALTER TABLE "DepositIntent" ADD CONSTRAINT "DepositIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
