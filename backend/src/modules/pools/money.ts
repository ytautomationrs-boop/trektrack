import {randomUUID} from 'node:crypto';
import {fail,type Pool} from './engine.js';

// An explicit rollout switch; never convert existing test-credit pools.
export const paidPoolsEnabled=()=>process.env.POOLS_WALLET_ENABLED==='true';
export const isWalletPool=(p:Pool)=>p.currency==='ZAR';
export async function moveWallet(tx:any,p:Pool,userId:string,amount:number,type:'STAKE_HOLD'|'STAKE_REFUND'|'POOL_PAYOUT',reference:string){
 if(userId.startsWith('demo:'))fail('Test players cannot use wallet rands.');
 const rows=await tx.$queryRawUnsafe('SELECT "walletBalanceCents" FROM "User" WHERE id=$1 FOR UPDATE',userId);
 if(!rows[0])fail('Account no longer available.');
 if(rows[0].walletBalanceCents+amount<0)fail('Not enough money in your wallet.');
 const existing=await tx.$queryRawUnsafe('SELECT id FROM "LedgerEntry" WHERE "externalRef"=$1 AND type=$2::"LedgerEntryType"',reference,type);
 if(existing.length)return;
 await tx.$executeRawUnsafe('UPDATE "User" SET "walletBalanceCents"="walletBalanceCents"+$2 WHERE id=$1',userId,amount);
 await tx.$executeRawUnsafe(`INSERT INTO "LedgerEntry" (id,"userId",type,status,"amountCents",currency,description,"externalRef","externalProvider","createdAt") VALUES ($1,$2,$3::"LedgerEntryType",$4::"LedgerEntryStatus",$5,'zar',$6,$7,'asta-pools',now())`,randomUUID(),userId,type,type==='STAKE_HOLD'?'PENDING':'COMPLETED',amount,`${p.title} · ${type==='STAKE_HOLD'?'Pool entry':type==='STAKE_REFUND'?'Pool refund':'Pool winnings'}`,reference);
}
export async function closeHolds(tx:any,p:Pool,userId?:string){
 await tx.$executeRawUnsafe(`UPDATE "LedgerEntry" SET status='COMPLETED' WHERE "externalProvider"='asta-pools' AND type='STAKE_HOLD' AND status='PENDING' AND "externalRef" LIKE $1 AND ($2::text IS NULL OR "userId"=$2)`,`pool:${p.id}:entry:%`,userId??null);
}
