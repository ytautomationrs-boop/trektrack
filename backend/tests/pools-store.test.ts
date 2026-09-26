import {createHash,createSign,generateKeyPairSync} from 'node:crypto';
import cbor from 'cbor';
import {PGlite} from '@electric-sql/pglite';
import Fastify from 'fastify';
import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
const ctx=vi.hoisted(()=>({db:null as any,queue:Promise.resolve() as Promise<any>}));
vi.mock('../src/lib/prisma.js',()=>{
 const client:any={
  $queryRawUnsafe:async(sql:string,...values:any[])=>(await ctx.db.query(sql,values)).rows,
  $executeRawUnsafe:async(sql:string,...values:any[])=>{const r=await ctx.db.query(sql,values);return r.affectedRows??0;},
  user:{findUniqueOrThrow:async({where}:any)=>{const r=await ctx.db.query('SELECT * FROM "User" WHERE id=$1',[where.id]);if(!r.rows[0])throw Error('User not found');return r.rows[0];}},
 };
 client.$transaction=(fn:any)=>{const run=ctx.queue.then(async()=>{await ctx.db.exec('BEGIN');try{const result=await fn(client);await ctx.db.exec('COMMIT');return result;}catch(e){await ctx.db.exec('ROLLBACK');throw e;}});ctx.queue=run.catch(()=>{});return run;};
 return {prisma:client};
});
vi.mock('../src/middleware/auth.js',()=>({requireAuth:async(req:any)=>{if(!req.headers['x-test-user'])throw Object.assign(Error('Sign in'),{statusCode:401});req.userId=req.headers['x-test-user'];}}));
import {poolRoutes} from '../src/modules/pools/routes.js';
import {ensureAttestation} from '../src/modules/pools/attestation.js';
import {ensurePools} from '../src/modules/pools/store.js';
const app=Fastify();
beforeAll(async()=>{ctx.db=new PGlite();await ctx.db.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY,"displayName" TEXT,"walletBalanceCents" INTEGER NOT NULL DEFAULT 12345)');await ctx.db.exec(`CREATE TYPE "LedgerEntryType" AS ENUM ('STAKE_HOLD','STAKE_REFUND','POOL_PAYOUT'); CREATE TYPE "LedgerEntryStatus" AS ENUM ('PENDING','COMPLETED'); CREATE TABLE "LedgerEntry" (id TEXT PRIMARY KEY,"userId" TEXT,type "LedgerEntryType",status "LedgerEntryStatus","amountCents" INTEGER,currency TEXT,description TEXT,"externalRef" TEXT,"externalProvider" TEXT,"createdAt" TIMESTAMPTZ,UNIQUE("externalRef",type));`);await ensurePools();await ensureAttestation();app.setErrorHandler((e,_q,r)=>r.code(e.statusCode??400).send({message:e.message}));await app.register(poolRoutes);},20000);
afterAll(async()=>{await app.close();await ctx.db.close();});
beforeEach(async()=>{vi.unstubAllEnvs();await ctx.db.exec(`TRUNCATE "PoolDeviceKey", "PoolDeviceNonce", "LedgerEntry", "PoolPrototype", "PoolTestWallet", "User" CASCADE; INSERT INTO "User" (id,"displayName") VALUES ('a','Alice'),('b','Bob'),('c','Chris');`);});
const call=(method:any,url:string,payload?:any,user='a')=>app.inject({method,url,payload,headers:{'x-test-user':user}});
async function signed(body:any,user='a'){
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const keyId='test-'+Math.random();
 await ctx.db.query('INSERT INTO "PoolDeviceKey" (id,"userId","publicKey") VALUES ($1,$2,$3)',[keyId,user,publicKey.export({type:'spki',format:'pem'})]);
 const nonce=(await call('POST','/pools/device/challenge',{purpose:'activity'},user)).json().nonce;
 const payload=Buffer.from(JSON.stringify({...body,nonce}));const auth=Buffer.alloc(37);createHash('sha256').update('K2B23SBUZ8.com.reecewheeler.asta').digest().copy(auth);auth.writeUInt32BE(1,33);
 const nonceHash=createHash('sha256').update(Buffer.concat([auth,createHash('sha256').update(payload).digest()])).digest();const signer=createSign('SHA256');signer.update(nonceHash);
 return {payload:payload.toString('base64'),keyId,assertion:cbor.encode({signature:signer.sign(privateKey),authenticatorData:auth}).toString('base64')};
}
const input={title:'Pilot pool',durationDays:7,capacity:3,buyIn:100,timezone:'Africa/Johannesburg',goals:[{metric:'steps',target:10000}]};
async function create(){const r=await call('POST','/pools',input);expect(r.statusCode).toBe(201);return r.json().pool;}
async function balance(user='a'){return (await call('GET','/pools',undefined,user)).json().testBalance;}
it('requires authentication',async()=>{expect((await app.inject({method:'GET',url:'/pools'})).statusCode).toBe(401);});
it('creates and joins using separate credits, leaving real wallets untouched',async()=>{const p=await create();expect(p.players).toHaveLength(1);expect(await balance()).toBe(99900);expect((await ctx.db.query('SELECT "walletBalanceCents" FROM "User"')).rows.every((r:any)=>r.walletBalanceCents===12345)).toBe(true);});
it('duplicate concurrent joins debit once and never overfill',async()=>{const p=await create();const responses=await Promise.all([call('POST',`/pools/${p.id}/join`,{},'b'),call('POST',`/pools/${p.id}/join`,{},'b'),call('POST',`/pools/${p.id}/join`,{},'c')]);expect(responses.every(r=>r.statusCode===200)).toBe(true);expect(await balance('b')).toBe(99900);const current=(await call('GET',`/pools/${p.id}`)).json().pool;expect(current.players).toHaveLength(3);expect(current.status).toBe('SCHEDULED');});
it('leaving twice refunds only once and reopens a scheduled pool',async()=>{const p=await create();await call('POST',`/pools/${p.id}/test-fill`,{});await call('POST',`/pools/${p.id}/leave`,{});await call('POST',`/pools/${p.id}/leave`,{});expect(await balance()).toBe(100000);expect((await call('GET',`/pools/${p.id}`)).json().pool.status).toBe('WAITING');});
it('rejects insufficient credits without adding a participant',async()=>{const p=await create();await balance('b');await ctx.db.query('UPDATE "PoolTestWallet" SET balance=1 WHERE "userId"=$1',['b']);expect((await call('POST',`/pools/${p.id}/join`,{},'b')).statusCode).toBe(400);expect((await call('GET',`/pools/${p.id}`)).json().pool.players).toHaveLength(1);});
it('restricts simulation to the host',async()=>{const p=await create();expect((await call('POST',`/pools/${p.id}/test-fill`,{},'b')).statusCode).toBe(400);expect((await call('POST',`/pools/${p.id}/test-advance`,{version:p.version},'b')).statusCode).toBe(400);expect((await call('POST',`/pools/${p.id}/test-report`,{participantId:'a',day:1,values:{steps:10000}},'b')).statusCode).toBe(400);});
it('retries cannot advance the clock twice and invalid reports do not debit',async()=>{let p=await create();p=(await call('POST',`/pools/${p.id}/test-fill`,{})).json().pool;const body={version:p.version};const first=await call('POST',`/pools/${p.id}/test-advance`,body);expect(first.statusCode).toBe(200);expect((await call('POST',`/pools/${p.id}/test-advance`,body)).statusCode).toBe(400);expect((await call('POST',`/pools/${p.id}/test-report`,{participantId:'a',day:2,values:{steps:10000}})).statusCode).toBe(400);});
it('pays the sole survivor on day one; reconnecting never pays twice',async()=>{let p=await create();p=(await call('POST',`/pools/${p.id}/test-fill`,{})).json().pool;p=(await call('POST',`/pools/${p.id}/test-advance`,{version:p.version})).json().pool;for(const player of p.players.filter((x:any)=>x.id!=='a'))await call('POST',`/pools/${p.id}/test-report`,{participantId:player.id,day:1,values:{steps:0}});for(let day=1;day<=1;day++){p=(await call('POST',`/pools/${p.id}/test-report`,{participantId:'a',day,values:{steps:10000}})).json().pool;p=(await call('POST',`/pools/${p.id}/test-advance`,{version:p.version})).json().pool;}expect(p.status).toBe('COMPLETED');expect(await balance()).toBe(100200);await call('GET',`/pools/${p.id}`);await call('GET',`/pools/${p.id}`);expect(await balance()).toBe(100200);});
it('an empty-finish pool returns each real participant stake',async()=>{let p=await create();p=(await call('POST',`/pools/${p.id}/test-fill`,{})).json().pool;for(let i=0;i<8;i++)p=(await call('POST',`/pools/${p.id}/test-advance`,{version:p.version,...(p.status==='ACTIVE'?{reports:p.players.filter((x:any)=>x.status==='ACTIVE').map((x:any)=>({participantId:x.id,day:p.day,values:{steps:0}}))}:{})})).json().pool;expect(p.status).toBe('COMPLETED');expect(await balance()).toBe(100000);});
it('a retried create request returns the original pool without a second debit',async()=>{const body={...input,requestId:'12345678-1234-4123-8123-123456789abc'};const a=await call('POST','/pools',body),b=await call('POST','/pools',body);expect(a.statusCode).toBe(201);expect(b.json().pool.id).toBe(a.json().pool.id);expect(await balance()).toBe(99900);});
it('deleting a member removes stored identity and test activity',async()=>{const p=await create();await call('POST',`/pools/${p.id}/join`,{},'b');await ctx.db.query('DELETE FROM "User" WHERE id=$1',['b']);const row=(await ctx.db.query('SELECT state FROM "PoolPrototype" WHERE id=$1',[p.id])).rows[0].state;expect(row.players[1].name).toBe('Deleted player');expect(row.players[1].reports).toEqual({});expect((await ctx.db.query('SELECT * FROM "PoolTestWallet" WHERE "userId"=$1',['b'])).rows).toHaveLength(0);});

it('splits winnings between two finishers without paying early',async()=>{let p=await create();await call('POST',`/pools/${p.id}/join`,{},'b');p=(await call('POST',`/pools/${p.id}/join`,{},'c')).json().pool;p=(await call('POST',`/pools/${p.id}/test-advance`,{version:p.version})).json().pool;for(let day=1;day<=7;day++){for(const participantId of day===1?['a','b','c']:['a','b'])p=(await call('POST',`/pools/${p.id}/test-report`,{participantId,day,values:{steps:participantId==='c'?0:10000}})).json().pool;p=(await call('POST',`/pools/${p.id}/test-advance`,{version:p.version})).json().pool;if(day<7){expect(p.status).toBe('ACTIVE');expect(await balance('a')).toBe(99900);}}expect(p.status).toBe('COMPLETED');expect(await balance('a')).toBe(100050);expect(await balance('b')).toBe(100050);expect(await balance('c')).toBe(99900);await call('GET',`/pools/${p.id}`);expect(await balance('a')).toBe(100050);});

it('keeps all three qualifying players through seven days and splits equally',async()=>{
 let p=(await call('POST','/pools',{...input,goals:[{metric:'steps',target:1000}]})).json().pool;
 for(const user of ['b','c'])p=(await call('POST',`/pools/${p.id}/join`,{},user)).json().pool;
 p=(await call('POST',`/pools/${p.id}/test-advance`,{version:p.version})).json().pool;
 for(let day=1;day<=7;day++){
  const reports=p.players.map((x:any,i:number)=>({participantId:x.id,day,values:{steps:day===1?1000:1000+i*500}}));
  const response=await call('POST',`/pools/${p.id}/test-advance`,{version:p.version,reports});expect(response.statusCode).toBe(200);p=response.json().pool;
  expect(p.players.every((x:any)=>x.status===(day===7?'FINISHED':'ACTIVE'))).toBe(true);
  if(day<7){expect(p.status).toBe('ACTIVE');expect(await balance()).toBe(99900);}
 }
 expect(p.players.map((x:any)=>x.payout)).toEqual([100,100,100]);
 for(const user of ['a','b','c'])expect(await balance(user)).toBe(100000);
});
it('refuses to close a simulated day with missing entries and rolls back the whole batch',async()=>{
 let p=await create();p=(await call('POST',`/pools/${p.id}/test-fill`,{})).json().pool;p=(await call('POST',`/pools/${p.id}/test-advance`,{version:p.version})).json().pool;
 const incomplete=await call('POST',`/pools/${p.id}/test-advance`,{version:p.version,reports:[{participantId:p.players[2].id,day:1,values:{steps:10000}}]});expect(incomplete.statusCode).toBe(400);expect(incomplete.json().message).toContain('every active player');
 const row=(await ctx.db.query('SELECT state FROM "PoolPrototype" WHERE id=$1',[p.id])).rows[0].state;expect(row.version).toBe(p.version);expect(row.players.every((x:any)=>x.status==='ACTIVE'&&Object.keys(x.reports).length===0)).toBe(true);
 const reports=p.players.map((x:any)=>({participantId:x.id,day:1,values:{steps:10000}}));const valid=await call('POST',`/pools/${p.id}/test-advance`,{version:p.version,reports});expect(valid.statusCode).toBe(200);expect(valid.json().pool.players.every((x:any)=>x.status==='ACTIVE')).toBe(true);
 expect((await call('POST',`/pools/${p.id}/test-advance`,{version:p.version,reports})).statusCode).toBe(400);
});

it('keeps wallet entry disabled until rollout is explicitly enabled',async()=>{const response=await call('POST','/pools',{...input,currency:'ZAR',buyIn:1000});expect(response.statusCode).toBe(400);expect((await ctx.db.query('SELECT "walletBalanceCents" FROM "User" WHERE id=$1',['a'])).rows[0].walletBalanceCents).toBe(12345);});
it('charges and refunds wallet cents with an audit trail; test players cannot join',async()=>{
 vi.stubEnv('POOLS_WALLET_ENABLED','true');let p=(await call('POST','/pools',{...input,currency:'ZAR',buyIn:1050})).json().pool;
 expect(p.currency).toBe('ZAR');expect((await ctx.db.query('SELECT "walletBalanceCents" FROM "User" WHERE id=$1',['a'])).rows[0].walletBalanceCents).toBe(11295);
 expect((await call('POST',`/pools/${p.id}/test-fill`,{})).statusCode).toBe(400);
 expect((await call('POST',`/pools/${p.id}/test-advance`,{version:p.version})).statusCode).toBe(400);
 await call('POST',`/pools/${p.id}/join`,{},'b');await call('POST',`/pools/${p.id}/join`,{},'b');
 expect((await ctx.db.query('SELECT "walletBalanceCents" FROM "User" WHERE id=$1',['b'])).rows[0].walletBalanceCents).toBe(11295);
 await call('POST',`/pools/${p.id}/leave`,{},'b');await call('POST',`/pools/${p.id}/leave`,{},'b');
 expect((await ctx.db.query('SELECT "walletBalanceCents" FROM "User" WHERE id=$1',['b'])).rows[0].walletBalanceCents).toBe(12345);
 expect((await ctx.db.query('SELECT * FROM "LedgerEntry" WHERE "userId"=$1',['b'])).rows).toHaveLength(2);
 await expect(ctx.db.query('DELETE FROM "User" WHERE id=$1',['a'])).rejects.toThrow('wallet Pools');
});
it('settles wallet winnings once, preserves every cent and leaves test credits alone',async()=>{
 vi.stubEnv('POOLS_WALLET_ENABLED','true');let p=(await call('POST','/pools',{...input,currency:'ZAR',buyIn:1001})).json().pool;for(const user of ['b','c'])p=(await call('POST',`/pools/${p.id}/join`,{},user)).json().pool;
 p.status='ACTIVE';p.startAt='2026-01-01T00:00:00.000Z';p.timezone='UTC';for(const player of p.players.slice(0,2))for(let day=1;day<=7;day++)player.reports[String(day)]={values:{steps:10000}};
 await ctx.db.query('UPDATE "PoolPrototype" SET state=$2::jsonb WHERE id=$1',[p.id,JSON.stringify(p)]);
 p=(await call('GET',`/pools/${p.id}`)).json().pool;expect(p.status).toBe('COMPLETED');expect(p.players.map((x:any)=>x.payout??0)).toEqual([1502,1501,0]);
 await call('GET',`/pools/${p.id}`);expect((await ctx.db.query('SELECT sum("walletBalanceCents") AS total FROM "User"')).rows[0].total).toBe(37035);
 expect((await ctx.db.query("SELECT * FROM \"LedgerEntry\" WHERE type='POOL_PAYOUT'")).rows).toHaveLength(2);expect(await balance()).toBe(100000);
});
it('rolls back an unaffordable wallet entry without a ledger debit',async()=>{vi.stubEnv('POOLS_WALLET_ENABLED','true');const r=await call('POST','/pools',{...input,currency:'ZAR',buyIn:20000});expect(r.statusCode).toBe(400);expect((await ctx.db.query('SELECT * FROM "PoolPrototype"')).rows).toHaveLength(0);expect((await ctx.db.query('SELECT * FROM "LedgerEntry"')).rows).toHaveLength(0);});
it('accepts only a member’s own Health totals and keeps them private',async()=>{
 vi.stubEnv('POOLS_WALLET_ENABLED','true');let p=(await call('POST','/pools',{...input,currency:'ZAR'})).json().pool;for(const user of ['b','c'])p=(await call('POST',`/pools/${p.id}/join`,{},user)).json().pool;
 const now=new Date();const start=new Date(now);start.setUTCHours(0,0,0,0);p.status='ACTIVE';p.startAt=start.toISOString();p.timezone='UTC';await ctx.db.query('UPDATE "PoolPrototype" SET state=$2::jsonb WHERE id=$1',[p.id,JSON.stringify(p)]);
 const windows=await call('GET','/pools/health/windows');expect(windows.json().windows[0].poolId).toBe(p.id);
 const body={poolId:p.id,day:1,values:{steps:100},windowStart:start.toISOString(),windowEnd:now.toISOString(),observedAt:now.toISOString()};expect((await call('POST','/pools/health/snapshot',await signed(body))).statusCode).toBe(200);
 const own=(await call('GET',`/pools/${p.id}`)).json().pool;expect(own.players[0].reports['1'].values.steps).toBe(100);
 const other=(await call('GET',`/pools/${p.id}`,undefined,'b')).json().pool;expect(other.players[0].reports).toEqual({});
 expect((await call('POST',`/pools/${p.id}/test-report`,{participantId:'b',day:1,values:{steps:100}})).statusCode).toBe(400);
 expect((await call('POST','/pools/health/snapshot',await signed({...body,participantId:'b'}))).statusCode).toBe(400);
 expect((await call('POST','/pools/health/snapshot',await signed({...body,windowStart:new Date(+start-86400000).toISOString()}))).statusCode).toBe(400);
});
it('rejects unsigned activity rather than trusting the old device passed flag',async()=>{expect((await call('POST','/pools/health/snapshot',{poolId:'anything',day:1,values:{steps:10000}})).statusCode).toBe(403);});

it('rejects replayed and cross-account activity assertions',async()=>{const envelope=await signed({poolId:'12345678-1234-4123-8123-123456789abc',day:1,values:{steps:0},windowStart:new Date().toISOString(),windowEnd:new Date().toISOString(),observedAt:new Date().toISOString()});expect((await call('POST','/pools/health/snapshot',envelope,'b')).statusCode).toBe(403);expect((await call('POST','/pools/health/snapshot',envelope)).statusCode).toBe(400);expect((await call('POST','/pools/health/snapshot',envelope)).statusCode).toBe(403);});
