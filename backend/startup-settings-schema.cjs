const {readFile}=require('node:fs/promises');
const {join}=require('node:path');
exports.ensureSettingsSchema=async(client)=>{
 const [complete]=await client.$queryRawUnsafe(`SELECT
  to_regclass('public."User_username_ci_key"') IS NOT NULL
  AND to_regclass('public."SmsThrottle"') IS NOT NULL
  AND to_regclass('public."AuthIdentity"') IS NOT NULL
  AND to_regclass('public."AuthChallenge"') IS NOT NULL
  AND (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name IN ('coverUrl','hasPassword','authVersion','phoneNumber','twoFactorEnabled','notificationPreferences'))=6
  AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='AuthChallenge' AND column_name='refreshTokenEncrypted')
  AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Challenge' AND column_name='creatorId' AND is_nullable='YES')
  AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."Challenge"'::regclass AND conname='Challenge_creatorId_fkey' AND confdeltype='n') AS ready`);
 if(complete?.ready)return;
 await client.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "coverUrl" TEXT');
 const [usernameIndex]=await client.$queryRawUnsafe(`SELECT to_regclass('public."User_username_ci_key"') IS NOT NULL AS ready`);
 if(!usernameIndex?.ready){
  const migration=await readFile(join(__dirname,'prisma/migrations/20260927010000_profile_cover/migration.sql'),'utf8');
  await client.$executeRawUnsafe(migration.slice(migration.indexOf('DO $$'),migration.indexOf('END $$;')+7));
 }
 const [creator]=await client.$queryRawUnsafe(`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Challenge' AND column_name='creatorId' AND is_nullable='YES') AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."Challenge"'::regclass AND conname='Challenge_creatorId_fkey' AND confdeltype='n') AS ready`);
 if(!creator?.ready){
  await client.$executeRawUnsafe(`DO $$ BEGIN
   ALTER TABLE "Challenge" ALTER COLUMN "creatorId" DROP NOT NULL;
   ALTER TABLE "Challenge" DROP CONSTRAINT IF EXISTS "Challenge_creatorId_fkey";
   ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END $$;`);
 }
 const [identity]=await client.$queryRawUnsafe(`SELECT to_regclass('public."AuthIdentity"') IS NOT NULL AND to_regclass('public."AuthChallenge"') IS NOT NULL AS ready`);
 if(!identity?.ready){
  const migration=await readFile(join(__dirname,'prisma/migrations/20260927010000_profile_cover/migration.sql'),'utf8');
  for(const statement of migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS "AuthIdentity"')).split(';').map(s=>s.trim()).filter(Boolean))await client.$executeRawUnsafe(statement);
 }
 await client.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hasPassword" BOOLEAN NOT NULL DEFAULT true');
 await client.$executeRawUnsafe('ALTER TABLE "AuthChallenge" ADD COLUMN IF NOT EXISTS "refreshTokenEncrypted" TEXT');
 const [state]=await client.$queryRawUnsafe(`SELECT to_regclass('public."SmsThrottle"') IS NOT NULL AND (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name IN ('authVersion','phoneNumber','twoFactorEnabled','notificationPreferences'))=4 AS ready`);
 if(state?.ready)return;
 const sql=await readFile(join(__dirname,'prisma/migrations/20260926160000_settings_security/migration.sql'),'utf8');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await client.$executeRawUnsafe(statement);
};
