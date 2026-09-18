import { prisma } from "./prisma.js";

let socialRepairPromise: Promise<void> | null = null;

export function ensureSocialSchema() {
  socialRepairPromise ??= (async () => {
    const statements = [
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bio" TEXT`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3)`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspendedReason" TEXT`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedAt" TIMESTAMP(3)`,
      `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FriendshipStatus') THEN
        CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');
      END IF;
    END $$`,
      `CREATE TABLE IF NOT EXISTS "Friendship" (
      "id" TEXT NOT NULL,
      "requesterId" TEXT NOT NULL,
      "addresseeId" TEXT NOT NULL,
      "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "acceptedAt" TIMESTAMP(3),
      CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
    )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "Friendship_requesterId_addresseeId_key" ON "Friendship"("requesterId", "addresseeId")`,
      `CREATE INDEX IF NOT EXISTS "Friendship_requesterId_status_idx" ON "Friendship"("requesterId", "status")`,
      `CREATE INDEX IF NOT EXISTS "Friendship_addresseeId_status_idx" ON "Friendship"("addresseeId", "status")`,
      `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Friendship_requesterId_fkey') THEN
        ALTER TABLE "Friendship"
          ADD CONSTRAINT "Friendship_requesterId_fkey"
          FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Friendship_addresseeId_fkey') THEN
        ALTER TABLE "Friendship"
          ADD CONSTRAINT "Friendship_addresseeId_fkey"
          FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
      `CREATE TABLE IF NOT EXISTS "DirectMessage" (
      "id" TEXT NOT NULL,
      "senderId" TEXT NOT NULL,
      "recipientId" TEXT NOT NULL,
      "body" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "readAt" TIMESTAMP(3),
      CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
    )`,
      `CREATE INDEX IF NOT EXISTS "DirectMessage_senderId_recipientId_createdAt_idx" ON "DirectMessage"("senderId", "recipientId", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "DirectMessage_recipientId_senderId_createdAt_idx" ON "DirectMessage"("recipientId", "senderId", "createdAt")`,
      `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessage_senderId_fkey') THEN
        ALTER TABLE "DirectMessage"
          ADD CONSTRAINT "DirectMessage_senderId_fkey"
          FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessage_recipientId_fkey') THEN
        ALTER TABLE "DirectMessage"
          ADD CONSTRAINT "DirectMessage_recipientId_fkey"
          FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`,
    ];

    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
  })();
  return socialRepairPromise;
}
