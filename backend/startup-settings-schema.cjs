const {readFile}=require('node:fs/promises');
const {join}=require('node:path');
exports.ensureSettingsSchema=async(client)=>{
 const [state]=await client.$queryRawUnsafe(`SELECT to_regclass('public."SmsThrottle"') IS NOT NULL AND (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name IN ('authVersion','phoneNumber','twoFactorEnabled','notificationPreferences'))=4 AS ready`);
 if(state?.ready)return;
 const sql=await readFile(join(__dirname,'prisma/migrations/20260926160000_settings_security/migration.sql'),'utf8');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await client.$executeRawUnsafe(statement);
};
