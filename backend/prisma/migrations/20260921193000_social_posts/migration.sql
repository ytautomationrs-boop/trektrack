CREATE TABLE "SocialPost" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "raceEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SocialPost_authorId_createdAt_idx" ON "SocialPost"("authorId", "createdAt");
CREATE INDEX "SocialPost_createdAt_idx" ON "SocialPost"("createdAt");
CREATE INDEX "SocialPost_raceEntryId_idx" ON "SocialPost"("raceEntryId");

ALTER TABLE "SocialPost"
  ADD CONSTRAINT "SocialPost_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialPost"
  ADD CONSTRAINT "SocialPost_raceEntryId_fkey"
  FOREIGN KEY ("raceEntryId") REFERENCES "RaceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
