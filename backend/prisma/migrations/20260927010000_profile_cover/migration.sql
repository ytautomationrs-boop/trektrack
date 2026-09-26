ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "coverUrl" TEXT;
-- Preserve the oldest spelling when legacy accounts already share a name.
DO $$
DECLARE item RECORD; candidate TEXT; suffix INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(81472019);
  FOR item IN SELECT id, "displayName" FROM (SELECT id, "displayName", row_number() OVER (PARTITION BY lower(btrim("displayName")) ORDER BY "createdAt",id) AS rank FROM "User") names WHERE rank>1 LOOP
    suffix:=0;
    LOOP
      candidate:=left(btrim(item."displayName"),18)||'_'||right(item.id,16)||CASE WHEN suffix=0 THEN '' ELSE '_'||suffix::text END;
      EXIT WHEN NOT EXISTS(SELECT 1 FROM "User" WHERE lower(btrim("displayName"))=lower(candidate));
      suffix:=suffix+1;
    END LOOP;
    UPDATE "User" SET "displayName"=candidate WHERE id=item.id;
  END LOOP;
  CREATE UNIQUE INDEX IF NOT EXISTS "User_username_ci_key" ON "User" (lower(btrim("displayName")));
END $$;

ALTER TABLE "Challenge" ALTER COLUMN "creatorId" DROP NOT NULL;
ALTER TABLE "Challenge" DROP CONSTRAINT IF EXISTS "Challenge_creatorId_fkey";
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AuthIdentity" (id TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE, provider TEXT NOT NULL, subject TEXT NOT NULL,"refreshTokenEncrypted" TEXT,UNIQUE(provider,subject),UNIQUE("userId",provider));
CREATE TABLE IF NOT EXISTS "AuthChallenge" (id TEXT PRIMARY KEY,nonce TEXT NOT NULL,provider TEXT NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL,"consumedAt" TIMESTAMP(3));
CREATE INDEX IF NOT EXISTS "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hasPassword" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AuthChallenge" ADD COLUMN IF NOT EXISTS "refreshTokenEncrypted" TEXT;
