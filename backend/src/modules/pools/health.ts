import {verifiedActivity} from './attestation.js';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import {requireAuth} from '../../middleware/auth.js';
import {prisma} from '../../lib/prisma.js';
import {ensurePools,mutatePool} from './store.js';
import {dayDate,dayEnd,midnight,currentDay,fail,type Pool,reportSchema} from './engine.js';
const snapshot=reportSchema.omit({participantId:true}).extend({poolId:z.string().uuid(),observedAt:z.string().datetime(),windowStart:z.string().datetime(),windowEnd:z.string().datetime()});
export function validateSnapshot(p:Pool,s:z.infer<typeof snapshot>,now:Date){
 const start=midnight(dayDate(p,s.day),p.timezone),end=dayEnd(p,s.day),through=new Date(s.windowEnd),observed=new Date(s.observedAt);
 if(s.day<1||s.day>p.durationDays||+start!==Date.parse(s.windowStart)||through<=start||through>end||through.getTime()>now.getTime()+60000||observed<through||observed.getTime()>now.getTime()+60000||now.getTime()>=end.getTime()+86400000)fail('This daily activity window is closed or invalid.');
 for(const key of Object.keys(s.values))if(!p.goals.some(g=>g.metric===key))fail('Activity is not part of this Pool.');
 const minutes=(through.getTime()-start.getTime())/60000;
 if((s.values.steps??0)>minutes*250||(s.values.running??0)>minutes*0.75||(s.values.cycling??0)>minutes*2||(s.values.swimming??0)>minutes*0.2)fail('Activity exceeds a plausible rate.');
 if(s.sleepStart||s.sleepEnd){if(!s.sleepStart||!s.sleepEnd||Date.parse(s.sleepEnd)>+through||(s.values.sleep??0)>(Date.parse(s.sleepEnd)-Date.parse(s.sleepStart))/3600000)fail('Invalid sleep interval.');}
}
export async function poolHealthRoutes(app:FastifyInstance){
 app.get('/pools/health/windows',{preHandler:requireAuth},async req=>{
  await ensurePools();const rows=await prisma.$queryRawUnsafe<Array<{state:Pool}>>(`SELECT state FROM "PoolPrototype" WHERE state->>'currency'='ZAR' AND state->>'status' IN ('SCHEDULED','ACTIVE') AND state->'players' @> $1::jsonb`,JSON.stringify([{id:req.userId,status:'ACTIVE'}]));const now=new Date();
  return {windows:rows.flatMap(({state:p})=>{if(!p.startAt||now<new Date(p.startAt))return [];const today=currentDay(p,now);return [today-1,today].filter(day=>day>=1&&day<=p.durationDays&&now.getTime()<dayEnd(p,day).getTime()+86400000).map(day=>({poolId:p.id,day,metrics:p.goals.map(g=>g.metric),windowStart:midnight(dayDate(p,day),p.timezone).toISOString(),windowEnd:dayEnd(p,day).toISOString()}));})};
 });
 app.post('/pools/health/snapshot',{preHandler:requireAuth},async(req,reply)=>{
  const parsed=snapshot.safeParse(await verifiedActivity(req.userId,req.body));if(!parsed.success)return reply.code(400).send({message:'Invalid Pool activity.'});const s=parsed.data;
  await mutatePool(s.poolId,req.userId,(p,_tx,now)=>{
   if(p.currency!=='ZAR'||p.status!=='ACTIVE')fail('This wallet Pool is not active.');const player=p.players.find(x=>x.id===req.userId&&x.status==='ACTIVE');if(!player)fail('You are not active in this Pool.');validateSnapshot(p,s,now);
   const previous=player!.reports[String(s.day)];if(previous?.observedAt&&previous.observedAt>=s.observedAt)return;
   player!.reports[String(s.day)]={values:s.values,sleepStart:s.sleepStart,sleepEnd:s.sleepEnd,observedAt:s.observedAt};
  });return {saved:true};
 });
}
