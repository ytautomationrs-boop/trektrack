CREATE TYPE "SocialEventVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "SocialEventStatus" AS ENUM ('UPCOMING', 'CANCELLED', 'COMPLETED');
CREATE TYPE "SocialEventParticipantStatus" AS ENUM ('JOINED', 'LEFT');

CREATE TABLE "SocialEvent" (
  "id" TEXT NOT NULL,
  "hostUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sportKey" TEXT NOT NULL,
  "sportName" TEXT NOT NULL,
  "description" TEXT,
  "location" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "maxPlayers" INTEGER NOT NULL,
  "visibility" "SocialEventVisibility" NOT NULL DEFAULT 'PUBLIC',
  "inviteCode" TEXT,
  "status" "SocialEventStatus" NOT NULL DEFAULT 'UPCOMING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SocialEventParticipant" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "SocialEventParticipantStatus" NOT NULL DEFAULT 'JOINED',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "SocialEventParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialEvent_inviteCode_key" ON "SocialEvent"("inviteCode");
CREATE INDEX "SocialEvent_status_startsAt_idx" ON "SocialEvent"("status", "startsAt");
CREATE INDEX "SocialEvent_hostUserId_startsAt_idx" ON "SocialEvent"("hostUserId", "startsAt");
CREATE INDEX "SocialEvent_visibility_startsAt_idx" ON "SocialEvent"("visibility", "startsAt");
CREATE UNIQUE INDEX "SocialEventParticipant_eventId_userId_key" ON "SocialEventParticipant"("eventId", "userId");
CREATE INDEX "SocialEventParticipant_userId_status_idx" ON "SocialEventParticipant"("userId", "status");
CREATE INDEX "SocialEventParticipant_eventId_status_idx" ON "SocialEventParticipant"("eventId", "status");

ALTER TABLE "SocialEvent"
  ADD CONSTRAINT "SocialEvent_hostUserId_fkey"
  FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialEventParticipant"
  ADD CONSTRAINT "SocialEventParticipant_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "SocialEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialEventParticipant"
  ADD CONSTRAINT "SocialEventParticipant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
