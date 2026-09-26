import {closeHolds,isWalletPool,moveWallet,paidPoolsEnabled} from './money.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { advance, createPoolSchema, effectiveNow, currentDay, fail, join, leave, makePool, record, tick, type Pool, type Report } from './engine.js';

// This prototype deliberately has its own credits, never User.walletBalanceCents
// or the payment ledger. Credits cannot be deposited, withdrawn or transferred.
export const poolDDL = [
 `CREATE TABLE IF NOT EXISTS "PoolTestWallet" ("userId" TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE, balance INTEGER NOT NULL DEFAULT 100000 CHECK (balance >= 0))`,
 `CREATE TABLE IF NOT EXISTS "PoolPrototype" (id TEXT PRIMARY KEY, "hostId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE, state JSONB NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now())`,
 `CREATE OR REPLACE FUNCTION asta_pool_forget_deleted_user() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF EXISTS (SELECT 1 FROM "PoolPrototype" WHERE state->>'currency'='ZAR' AND state->>'status'<>'COMPLETED' AND ("hostId"=OLD.id OR state->'players' @> jsonb_build_array(jsonb_build_object('id',OLD.id)))) THEN RAISE EXCEPTION 'Finish or leave your wallet Pools before deleting your account.'; END IF;
   UPDATE "PoolPrototype" SET state=jsonb_set(state,'{players}',COALESCE((SELECT jsonb_agg(CASE WHEN player->>'id'=OLD.id THEN player || jsonb_build_object('id','demo:deleted:'||md5(random()::text||clock_timestamp()::text),'name','Deleted player','reports','{}'::jsonb) ELSE player END) FROM jsonb_array_elements(state->'players') player),'[]'::jsonb)) WHERE state->'players' @> jsonb_build_array(jsonb_build_object('id',OLD.id));
   RETURN OLD; END $$`,
 `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='asta_pool_user_cleanup') THEN CREATE TRIGGER asta_pool_user_cleanup BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION asta_pool_forget_deleted_user(); END IF; END $$`,
];
let ready:Promise<void>|undefined;
export function ensurePools(){return ready??=(async()=>{for(const sql of poolDDL)await prisma.$executeRawUnsafe(sql);})().catch(e=>{ready=undefined;throw e;});}
async function wallet(tx:any,userId:string){await tx.$executeRawUnsafe(`INSERT INTO "PoolTestWallet" ("userId") VALUES ($1) ON CONFLICT DO NOTHING`,userId);const rows=await tx.$queryRawUnsafe(`SELECT balance FROM "PoolTestWallet" WHERE "userId"=$1 FOR UPDATE`,userId);return rows[0].balance as number;}
async function credit(tx:any,userId:string,amount:number){await wallet(tx,userId);await tx.$executeRawUnsafe(`UPDATE "PoolTestWallet" SET balance=balance+$2 WHERE "userId"=$1`,userId,amount);}
async function debit(tx:any,userId:string,amount:number){if(await wallet(tx,userId)<amount)fail('Not enough test credits.');await tx.$executeRawUnsafe(`UPDATE "PoolTestWallet" SET balance=balance-$2 WHERE "userId"=$1`,userId,amount);}
export async function saveSettled(tx:any,p:Pool){
  if(p.status==='COMPLETED'&&!p.settled){
    // Ordered locks avoid opposite user-lock order when separate pools settle.
    for(const player of [...p.players].sort((a,b)=>a.id.localeCompare(b.id)))if((player.payout??0)>0){if(isWalletPool(p))await moveWallet(tx,p,player.id,player.payout!,p.players.some(x=>x.status==='FINISHED')?'POOL_PAYOUT':'STAKE_REFUND',`pool:${p.id}:settlement:${player.id}`);else if(!player.id.startsWith('demo:'))await credit(tx,player.id,player.payout!);}
    if(isWalletPool(p))await closeHolds(tx,p);
    p.settled=true;
  }
  p.version++;
  await tx.$executeRawUnsafe(`UPDATE "PoolPrototype" SET state=$2::jsonb,"updatedAt"=now() WHERE id=$1`,p.id,JSON.stringify(p));
}
export async function mutatePool(id:string,userId:string|undefined,action:(p:Pool,tx:any,now:Date)=>Promise<void>|void){
  await ensurePools();
  return prisma.$transaction(async tx=>{
    const rows=await tx.$queryRawUnsafe<Array<{state:Pool}>>(`SELECT state FROM "PoolPrototype" WHERE id=$1 FOR UPDATE`,id);
    if(!rows[0])fail('Pool not found.');const p=rows[0]!.state;const now=new Date();
    tick(p,now);await action(p,tx,now);await saveSettled(tx,p);
    return userId?view(p,userId,now):p;
  },{timeout:15000});
}
export function view(p:Pool,userId:string,now=new Date()){
  const isMember=p.hostId===userId||p.players.some(x=>x.id===userId);
  return {...p,players:p.players.map(x=>({...x,isYou:x.id===userId,reports:(isWalletPool(p)?x.id===userId:isMember)?x.reports:{}})),isHost:p.hostId===userId,joined:p.players.some(x=>x.id===userId),day:Math.max(0,Math.min(p.durationDays,currentDay(p,now))),serverTime:effectiveNow(p,now).toISOString(),testOnly:!isWalletPool(p),currency:p.currency??'TEST'};
}
export async function createPool(userId:string,name:string,input:unknown){
  const rules=createPoolSchema.parse(input);if(rules.currency==='ZAR'&&!paidPoolsEnabled())fail('Wallet Pools are not open yet. You can still explore with test credits.');await ensurePools();const p=makePool(rules.requestId??randomUUID(),userId,rules,new Date());
  return prisma.$transaction(async tx=>{
    await wallet(tx,userId);
    const existing=await tx.$queryRawUnsafe<Array<{state:Pool}>>(`SELECT state FROM "PoolPrototype" WHERE id=$1`,p.id);
    if(existing[0]){if(existing[0].state.hostId!==userId)fail('Creation identifier already used.');return view(existing[0].state,userId);}
    if(isWalletPool(p))await moveWallet(tx,p,userId,-p.buyIn,'STAKE_HOLD',`pool:${p.id}:entry:${userId}:${p.version}`);else await debit(tx,userId,p.buyIn);join(p,userId,name,new Date());
    await tx.$executeRawUnsafe(`INSERT INTO "PoolPrototype" (id,"hostId",state) VALUES ($1,$2,$3::jsonb)`,p.id,userId,JSON.stringify(p));
    return view(p,userId);
  });
}
export async function joinPool(id:string,userId:string,name:string){return mutatePool(id,userId,async(p,tx,now)=>{if(isWalletPool(p)&&!paidPoolsEnabled())fail('Wallet Pools are not open yet.');if(join(p,userId,name,now)){if(isWalletPool(p))await moveWallet(tx,p,userId,-p.buyIn,'STAKE_HOLD',`pool:${p.id}:entry:${userId}:${p.version}`);else await debit(tx,userId,p.buyIn);}});}
export async function leavePool(id:string,userId:string){return mutatePool(id,userId,async(p,tx)=>{if(leave(p,userId)){if(isWalletPool(p)){await moveWallet(tx,p,userId,p.buyIn,'STAKE_REFUND',`pool:${p.id}:leave:${userId}:${p.version}`);await closeHolds(tx,p,userId);}else await credit(tx,userId,p.buyIn);}});}
export async function reportPool(id:string,userId:string,participantId:string,day:number,report:Report){return mutatePool(id,userId,(p,_tx,now)=>{if(isWalletPool(p))fail('Wallet Pools only accept activity synced from Apple Health.');if(p.hostId!==userId)fail('Only the host can enter simulated activity.');record(p,participantId,day,report,now);});}
export async function advancePool(id:string,userId:string,expectedVersion:number,reports?:Array<Report & {participantId:string;day:number}>){return mutatePool(id,userId,(p,_tx,now)=>{if(isWalletPool(p))fail('Wallet Pools run on the real clock.');if(p.hostId!==userId)fail('Only the host can advance the test clock.');if(p.version!==expectedVersion)fail('Pool changed. Refresh before advancing again.');
  if(reports){if(new Set(reports.map(r=>r.participantId)).size!==reports.length)fail('Send one report per player.');for(const r of reports)record(p,r.participantId,r.day,r,now);}
  if(p.status==='ACTIVE'){const day=String(currentDay(p,now));const missing=p.players.filter(x=>x.status==='ACTIVE'&&!x.reports[day]);if(missing.length)fail('Save totals for every active player before closing the test day. Enter 0 to test a missed goal.');}
  advance(p,now);});}
export async function getPool(id:string,userId:string){return mutatePool(id,userId,()=>{});}
export async function listPools(userId:string){
  await ensurePools();
  const rows=await prisma.$queryRawUnsafe<Array<{state:Pool}>>(`SELECT (state - 'players') || jsonb_build_object('players',COALESCE((SELECT jsonb_agg(player - 'reports' - 'days') FROM jsonb_array_elements(state->'players') player),'[]'::jsonb)) AS state FROM "PoolPrototype" WHERE state->>'status'='WAITING'  OR "hostId"=$1 OR state->'players' @> $2::jsonb ORDER BY "updatedAt" DESC LIMIT 50`,userId,JSON.stringify([{id:userId}]));
  const balance=await prisma.$transaction(tx=>wallet(tx,userId));
  const user=await prisma.user.findUniqueOrThrow({where:{id:userId},select:{walletBalanceCents:true}});
  return {pools:rows.map(r=>view(r.state,userId)),testBalance:balance,walletBalanceCents:user.walletBalanceCents,walletEnabled:paidPoolsEnabled()};
}
export async function tickPools(){await ensurePools();const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT id FROM "PoolPrototype" WHERE state->>'status' IN ('SCHEDULED','ACTIVE') ORDER BY "updatedAt" LIMIT 100`);for(const {id}of rows)await mutatePool(id,undefined,()=>{});}
export async function fillTestPlayers(id:string,userId:string){return mutatePool(id,userId,(p,_tx,now)=>{
  if(isWalletPool(p))fail('Only real people can join a wallet Pool.');if(p.hostId!==userId)fail('Only the host can add test players.');
  if(p.status!=='WAITING')fail('This pool is already full.');
  while(p.players.length<p.capacity){const n=p.players.length+1;join(p,`demo:${p.id}:${n}`,`Test player ${n}`,now);}
});}
