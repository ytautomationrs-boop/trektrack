CREATE TABLE "SocialPostLike" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialPostLike_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SocialPostComment" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialPostComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SocialPostShare" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipientId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialPostShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialPostLike_postId_userId_key" ON "SocialPostLike"("postId", "userId");
CREATE INDEX "SocialPostLike_userId_createdAt_idx" ON "SocialPostLike"("userId", "createdAt");
CREATE INDEX "SocialPostComment_postId_createdAt_idx" ON "SocialPostComment"("postId", "createdAt");
CREATE INDEX "SocialPostComment_userId_createdAt_idx" ON "SocialPostComment"("userId", "createdAt");
CREATE INDEX "SocialPostShare_postId_createdAt_idx" ON "SocialPostShare"("postId", "createdAt");
CREATE INDEX "SocialPostShare_userId_createdAt_idx" ON "SocialPostShare"("userId", "createdAt");
CREATE INDEX "SocialPostShare_recipientId_createdAt_idx" ON "SocialPostShare"("recipientId", "createdAt");

ALTER TABLE "SocialPostLike"
  ADD CONSTRAINT "SocialPostLike_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialPostLike"
  ADD CONSTRAINT "SocialPostLike_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialPostComment"
  ADD CONSTRAINT "SocialPostComment_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialPostComment"
  ADD CONSTRAINT "SocialPostComment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialPostShare"
  ADD CONSTRAINT "SocialPostShare_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialPostShare"
  ADD CONSTRAINT "SocialPostShare_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialPostShare"
  ADD CONSTRAINT "SocialPostShare_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
