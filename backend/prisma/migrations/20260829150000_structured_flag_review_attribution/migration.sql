-- AlterTable
ALTER TABLE "ChallengeAnomalyFlag" DROP COLUMN "reviewedBy",
ADD COLUMN     "reviewedByUserId" TEXT;

-- AlterTable
ALTER TABLE "RaceAnomalyFlag" DROP COLUMN "reviewedBy",
ADD COLUMN     "reviewedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "ChallengeAnomalyFlag_reviewedByUserId_idx" ON "ChallengeAnomalyFlag"("reviewedByUserId");

-- CreateIndex
CREATE INDEX "RaceAnomalyFlag_reviewedByUserId_idx" ON "RaceAnomalyFlag"("reviewedByUserId");

-- AddForeignKey
ALTER TABLE "RaceAnomalyFlag" ADD CONSTRAINT "RaceAnomalyFlag_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeAnomalyFlag" ADD CONSTRAINT "ChallengeAnomalyFlag_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
