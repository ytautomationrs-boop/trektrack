SET lock_timeout = '5s';
SET statement_timeout = '25s';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bio" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspendedReason" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_suspendedAt_idx" ON "User"("suspendedAt");
CREATE INDEX IF NOT EXISTS "User_bannedAt_idx" ON "User"("bannedAt");

DO $$
BEGIN
  CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Friendship" (
  "id" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "addresseeId" TEXT NOT NULL,
  "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Friendship_requesterId_addresseeId_key" ON "Friendship"("requesterId", "addresseeId");
CREATE INDEX IF NOT EXISTS "Friendship_requesterId_status_idx" ON "Friendship"("requesterId", "status");
CREATE INDEX IF NOT EXISTS "Friendship_addresseeId_status_idx" ON "Friendship"("addresseeId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Friendship_requesterId_fkey') THEN
    BEGIN
      ALTER TABLE "Friendship"
        ADD CONSTRAINT "Friendship_requesterId_fkey"
        FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Friendship_addresseeId_fkey') THEN
    BEGIN
      ALTER TABLE "Friendship"
        ADD CONSTRAINT "Friendship_addresseeId_fkey"
        FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DirectMessage" (
  "id" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DirectMessage_senderId_recipientId_createdAt_idx" ON "DirectMessage"("senderId", "recipientId", "createdAt");
CREATE INDEX IF NOT EXISTS "DirectMessage_recipientId_senderId_createdAt_idx" ON "DirectMessage"("recipientId", "senderId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessage_senderId_fkey') THEN
    BEGIN
      ALTER TABLE "DirectMessage"
        ADD CONSTRAINT "DirectMessage_senderId_fkey"
        FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessage_recipientId_fkey') THEN
    BEGIN
      ALTER TABLE "DirectMessage"
        ADD CONSTRAINT "DirectMessage_recipientId_fkey"
        FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  CREATE TYPE "SocialEventVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SocialEventStatus" AS ENUM ('UPCOMING', 'CANCELLED', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SocialEventParticipantStatus" AS ENUM ('JOINED', 'LEFT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SocialEvent" (
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
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SocialEventParticipant" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "SocialEventParticipantStatus" NOT NULL DEFAULT 'JOINED',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "SocialEventParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SocialEvent_inviteCode_key" ON "SocialEvent"("inviteCode");
CREATE INDEX IF NOT EXISTS "SocialEvent_status_startsAt_idx" ON "SocialEvent"("status", "startsAt");
CREATE INDEX IF NOT EXISTS "SocialEvent_hostUserId_startsAt_idx" ON "SocialEvent"("hostUserId", "startsAt");
CREATE INDEX IF NOT EXISTS "SocialEvent_visibility_startsAt_idx" ON "SocialEvent"("visibility", "startsAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SocialEventParticipant_eventId_userId_key" ON "SocialEventParticipant"("eventId", "userId");
CREATE INDEX IF NOT EXISTS "SocialEventParticipant_userId_status_idx" ON "SocialEventParticipant"("userId", "status");
CREATE INDEX IF NOT EXISTS "SocialEventParticipant_eventId_status_idx" ON "SocialEventParticipant"("eventId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialEvent_hostUserId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialEvent"
        ADD CONSTRAINT "SocialEvent_hostUserId_fkey"
        FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialEventParticipant_eventId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialEventParticipant"
        ADD CONSTRAINT "SocialEventParticipant_eventId_fkey"
        FOREIGN KEY ("eventId") REFERENCES "SocialEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialEventParticipant_userId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialEventParticipant"
        ADD CONSTRAINT "SocialEventParticipant_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
