-- AlterEnum
ALTER TYPE "EliminationScope" ADD VALUE 'WHOLE_GROUP';

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_externalRef_type_key" ON "LedgerEntry"("externalRef", "type");
