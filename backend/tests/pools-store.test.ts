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
import {ensurePools} from '../src/modules/pools/store.js';
const app=Fastify();
beforeAll(async()=>{ctx.db=new PGlite();await ctx.db.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY,"displayName" TEXT,"walletBalanceCents" INTEGER NOT NULL DEFAULT 12345)');await ensurePools();app.setErrorHandler((e,_q,r)=>r.code(e.statusCode??400).send({message:e.message}));await app.register(poolRoutes);},20000);
afterAll(async()=>{await app.close();await ctx.db.close();});
beforeEach(async()=>{await ctx.db.exec(`TRUNCATE "PoolPrototype", "PoolTestWallet", "User" CASCADE; INSERT INTO "User" (id,"displayName") VALUES ('a','Alice'),('b','Bob'),('c','Chris');`);});
const call=(method:any,url:string,payload?:any,user='a')=>app.inject({method,url,payload,headers:{'x-test-user':user}});
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
it('settles seven days once; reconnecting never pays twice',async()=>{let p=await create();p=(await call('POST',`/pools/${p.id}/test-fill`,{})).json().pool;p=(await call('POST',`/pools/${p.id}/test-advance`,{version:p.version})).json().pool;for(let day=1;day<=7;day++){p=(await call('POST',`/pools/${p.id}/test-report`,{participantId:'a',day,values:{steps:10000}})).json().pool;p=(await call('POST',`/pools/${p.id}/test-advance`,{version:p.version})).json().pool;}expect(p.status).toBe('COMPLETED');expect(await balance()).toBe(100200);await call('GET',`/pools/${p.id}`);await call('GET',`/pools/${p.id}`);expect(await balance()).toBe(100200);});
it('an empty-finish pool returns each real participant stake',async()=>{let p=await create();p=(await call('POST',`/pools/${p.id}/test-fill`,{})).json().pool;for(let i=0;i<8;i++)p=(await call('POST',`/pools/${p.id}/test-advance`,{version:p.version})).json().pool;expect(p.status).toBe('COMPLETED');expect(await balance()).toBe(100000);});
it('a retried create request returns the original pool without a second debit',async()=>{const body={...input,requestId:'12345678-1234-4123-8123-123456789abc'};const a=await call('POST','/pools',body),b=await call('POST','/pools',body);expect(a.statusCode).toBe(201);expect(b.json().pool.id).toBe(a.json().pool.id);expect(await balance()).toBe(99900);});
it('deleting a member removes stored identity and test activity',async()=>{const p=await create();await call('POST',`/pools/${p.id}/join`,{},'b');await ctx.db.query('DELETE FROM "User" WHERE id=$1',['b']);const row=(await ctx.db.query('SELECT state FROM "PoolPrototype" WHERE id=$1',[p.id])).rows[0].state;expect(row.players[1].name).toBe('Deleted player');expect(row.players[1].reports).toEqual({});expect((await ctx.db.query('SELECT * FROM "PoolTestWallet" WHERE "userId"=$1',['b'])).rows).toHaveLength(0);});
