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

CREATE TABLE IF NOT EXISTS "SocialPost" (
  "id" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "raceEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SocialPost" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

CREATE INDEX IF NOT EXISTS "SocialPost_authorId_createdAt_idx" ON "SocialPost"("authorId", "createdAt");
CREATE INDEX IF NOT EXISTS "SocialPost_createdAt_idx" ON "SocialPost"("createdAt");
CREATE INDEX IF NOT EXISTS "SocialPost_raceEntryId_idx" ON "SocialPost"("raceEntryId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialPost_authorId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialPost"
        ADD CONSTRAINT "SocialPost_authorId_fkey"
        FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialPost_raceEntryId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialPost"
        ADD CONSTRAINT "SocialPost_raceEntryId_fkey"
        FOREIGN KEY ("raceEntryId") REFERENCES "RaceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "SocialPostLike" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialPostLike_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SocialPostComment" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialPostComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SocialPostShare" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipientId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialPostShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SocialPostLike_postId_userId_key" ON "SocialPostLike"("postId", "userId");
CREATE INDEX IF NOT EXISTS "SocialPostLike_userId_createdAt_idx" ON "SocialPostLike"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "SocialPostComment_postId_createdAt_idx" ON "SocialPostComment"("postId", "createdAt");
CREATE INDEX IF NOT EXISTS "SocialPostComment_userId_createdAt_idx" ON "SocialPostComment"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "SocialPostShare_postId_createdAt_idx" ON "SocialPostShare"("postId", "createdAt");
CREATE INDEX IF NOT EXISTS "SocialPostShare_userId_createdAt_idx" ON "SocialPostShare"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "SocialPostShare_recipientId_createdAt_idx" ON "SocialPostShare"("recipientId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialPostLike_postId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialPostLike"
        ADD CONSTRAINT "SocialPostLike_postId_fkey"
        FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialPostLike_userId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialPostLike"
        ADD CONSTRAINT "SocialPostLike_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialPostComment_postId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialPostComment"
        ADD CONSTRAINT "SocialPostComment_postId_fkey"
        FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialPostComment_userId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialPostComment"
        ADD CONSTRAINT "SocialPostComment_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialPostShare_postId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialPostShare"
        ADD CONSTRAINT "SocialPostShare_postId_fkey"
        FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialPostShare_userId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialPostShare"
        ADD CONSTRAINT "SocialPostShare_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SocialPostShare_recipientId_fkey') THEN
    BEGIN
      ALTER TABLE "SocialPostShare"
        ADD CONSTRAINT "SocialPostShare_recipientId_fkey"
        FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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

ALTER TYPE "SocialEventStatus" ADD VALUE IF NOT EXISTS 'LIVE';
ALTER TABLE "SocialEvent" ADD COLUMN IF NOT EXISTS "game" JSONB;
ALTER TABLE "SocialPost" ADD COLUMN IF NOT EXISTS "eventId" TEXT REFERENCES "SocialEvent"("id") ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS "AppNotification" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL, "data" JSONB NOT NULL,
 "dedupeKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "readAt" TIMESTAMP(3));
CREATE UNIQUE INDEX IF NOT EXISTS "AppNotification_userId_dedupeKey_key" ON "AppNotification"("userId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "AppNotification_userId_readAt_createdAt_idx" ON "AppNotification"("userId", "readAt", "createdAt");
CREATE TABLE IF NOT EXISTS "MediaAsset" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "contentType" TEXT NOT NULL, "bytes" BYTEA NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS "MediaAsset_ownerId_createdAt_idx" ON "MediaAsset"("ownerId", "createdAt");
CREATE INDEX IF NOT EXISTS "DirectMessage_unread_thread_idx" ON "DirectMessage"("recipientId", "senderId", "createdAt") WHERE "readAt" IS NULL;
