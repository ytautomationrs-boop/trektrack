"use strict";
const {readFile}=require('node:fs/promises');
const {join}=require('node:path');
// A small additive migration through the same Prisma connection used by the app.
// This also works when an older migration history blocks `prisma migrate deploy`.
async function ensureSocialFeatureSchema(client) {
 const [state]=await client.$queryRawUnsafe(`SELECT
  to_regclass('public."MediaAsset"') IS NOT NULL
  AND to_regclass('public."AppNotification"') IS NOT NULL
  AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SocialEvent' AND column_name='game')
  AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SocialPost' AND column_name='eventId')
  AND EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='SocialEventStatus' AND e.enumlabel='LIVE') AS ready`);
 if(state?.ready)return false;
 const sql=await readFile(join(__dirname,'prisma/migrations/20260925193000_social_games_notifications/migration.sql'),'utf8');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await client.$executeRawUnsafe(statement);
 console.info('[startup] Social games, notifications and media schema ready.');
 return true;
}
module.exports={ensureSocialFeatureSchema};
