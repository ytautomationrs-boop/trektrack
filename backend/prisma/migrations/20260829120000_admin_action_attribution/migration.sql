-- AlterTable
ALTER TABLE "InviteCode" ADD COLUMN     "createdByUserId" TEXT;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "performedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "InviteCode_createdByUserId_idx" ON "InviteCode"("createdByUserId");

-- CreateIndex
CREATE INDEX "LedgerEntry_performedByUserId_idx" ON "LedgerEntry"("performedByUserId");

-- AddForeignKey
ALTER TABLE "InviteCode" ADD CONSTRAINT "InviteCode_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
