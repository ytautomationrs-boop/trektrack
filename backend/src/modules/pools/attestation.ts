import {randomBytes} from 'node:crypto';
import {verifyAttestation,verifyAssertion} from 'node-app-attest';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import {prisma} from '../../lib/prisma.js';
import {requireAuth} from '../../middleware/auth.js';
const identity={bundleIdentifier:'com.reecewheeler.asta',teamIdentifier:'K2B23SBUZ8'};
const deny=()=>Object.assign(new Error('Device verification failed. Reconnect Apple Health in the updated ASTA app.'),{statusCode:403});
let ready:Promise<void>|undefined;
export function ensureAttestation(){return ready??=(async()=>{
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PoolDeviceKey" (id TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,"publicKey" TEXT NOT NULL,"signCount" INTEGER NOT NULL DEFAULT 0)`);
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PoolDeviceNonce" (id TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,purpose TEXT NOT NULL,"expiresAt" TIMESTAMPTZ NOT NULL)`);
})().catch(e=>{ready=undefined;throw e;});}
export async function poolAttestationRoutes(app:FastifyInstance){
 app.post('/pools/device/challenge',{preHandler:requireAuth,config:{rateLimit:{max:60,timeWindow:'1 minute'}}},async req=>{
  const {purpose}=z.object({purpose:z.enum(['register','activity'])}).parse(req.body);await ensureAttestation();const nonce=randomBytes(32).toString('base64url');
  await prisma.$executeRawUnsafe('DELETE FROM "PoolDeviceNonce" WHERE "expiresAt"<now()');
  await prisma.$executeRawUnsafe('INSERT INTO "PoolDeviceNonce" (id,"userId",purpose,"expiresAt") VALUES ($1,$2,$3,now()+interval \'5 minutes\')',nonce,req.userId,purpose);return {nonce};
 });
 app.post('/pools/device/register',{preHandler:requireAuth,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async req=>{
  const b=z.object({nonce:z.string().max(100),keyId:z.string().max(200),attestation:z.string().max(30000)}).parse(req.body);await ensureAttestation();
  await prisma.$transaction(async tx=>{
   const nonces=await tx.$queryRawUnsafe<any[]>('SELECT id FROM "PoolDeviceNonce" WHERE id=$1 AND "userId"=$2 AND purpose=\'register\' AND "expiresAt">now() FOR UPDATE',b.nonce,req.userId);if(!nonces.length)throw deny();
   let result;try{result=verifyAttestation({...identity,attestation:Buffer.from(b.attestation,'base64'),challenge:b.nonce,keyId:b.keyId,allowDevelopmentEnvironment:false});}catch{throw deny();}
   await tx.$executeRawUnsafe('INSERT INTO "PoolDeviceKey" (id,"userId","publicKey") VALUES ($1,$2,$3)',b.keyId,req.userId,result.publicKey);
   await tx.$executeRawUnsafe('DELETE FROM "PoolDeviceNonce" WHERE id=$1',b.nonce);
  });return {verified:true};
 });
}
export async function verifiedActivity(userId:string,input:unknown){
 const parsed=z.object({payload:z.string().max(16000),keyId:z.string().max(200),assertion:z.string().max(8000)}).strict().safeParse(input);if(!parsed.success)throw deny();const b=parsed.data;const payload=Buffer.from(b.payload,'base64');let value:any;try{value=JSON.parse(payload.toString('utf8'));}catch{throw deny();}if(typeof value.nonce!=='string')throw deny();await ensureAttestation();
 await prisma.$transaction(async tx=>{
  const keys=await tx.$queryRawUnsafe<any[]>('SELECT * FROM "PoolDeviceKey" WHERE id=$1 AND "userId"=$2 FOR UPDATE',b.keyId,userId);if(!keys[0])throw deny();
  const nonces=await tx.$queryRawUnsafe<any[]>('SELECT id FROM "PoolDeviceNonce" WHERE id=$1 AND "userId"=$2 AND purpose=\'activity\' AND "expiresAt">now() FOR UPDATE',value.nonce,userId);if(!nonces.length)throw deny();
  let result;try{result=verifyAssertion({...identity,assertion:Buffer.from(b.assertion,'base64'),payload,publicKey:keys[0].publicKey,signCount:keys[0].signCount});}catch{throw deny();}
  await tx.$executeRawUnsafe('UPDATE "PoolDeviceKey" SET "signCount"=$2 WHERE id=$1',b.keyId,result.signCount);
  await tx.$executeRawUnsafe('DELETE FROM "PoolDeviceNonce" WHERE id=$1',value.nonce);
 });delete value.nonce;return value;
}
