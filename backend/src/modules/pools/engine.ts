import { z } from 'zod';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const metricKeys = ['steps','running','cycling','swimming','sleep'] as const;
const requirement = z.object({
  metric: z.enum(metricKeys), target: z.number().finite().positive(),
  bedtime: z.number().int().min(0).max(1439).optional(),
  wakeTime: z.number().int().min(0).max(1439).optional(),
}).superRefine((r,ctx)=>{
  const max = r.metric==='steps'?100000:r.metric==='sleep'?12: r.metric==='cycling'?500:r.metric==='running'?100:30;
  if(r.target>max)ctx.addIssue({code:'custom',message:`Target exceeds ${max}.`});
  if(r.metric==='steps'&&!Number.isInteger(r.target))ctx.addIssue({code:'custom',message:'Steps must be whole numbers.'});
  if(r.metric!=='sleep'&&(r.bedtime!==undefined||r.wakeTime!==undefined))ctx.addIssue({code:'custom',message:'Sleep times apply only to sleep.'});
});
export const createPoolSchema=z.object({
  requestId:z.string().uuid().optional(), title:z.string().trim().min(3).max(60), durationDays:z.number().int().min(7).max(365),
  capacity:z.number().int().min(2).max(50), buyIn:z.number().int().min(1).max(10000),
  timezone:z.string().refine(t=>{try{new Intl.DateTimeFormat('en',{timeZone:t});return true;}catch{return false;}},'Invalid timezone'),
  goals:z.array(requirement).min(1).max(5),
}).refine(v=>new Set(v.goals.map(g=>g.metric)).size===v.goals.length,'Select each activity only once');
export type Rules=z.infer<typeof createPoolSchema>;
export type Metric=typeof metricKeys[number];
export type Report={values:Partial<Record<Metric,number>>;sleepStart?:string;sleepEnd?:string};
export const reportSchema=z.object({
  participantId:z.string().min(1).max(100),day:z.number().int().min(1).max(365),
  values:z.object({steps:z.number().int().min(0).max(200000).optional(),running:z.number().min(0).max(1000).optional(),cycling:z.number().min(0).max(2000).optional(),swimming:z.number().min(0).max(100).optional(),sleep:z.number().min(0).max(24).optional()}).strict(),
  sleepStart:z.string().datetime({offset:true}).optional(),sleepEnd:z.string().datetime({offset:true}).optional(),
}).strict();
export type Player={id:string;name:string;status:'ACTIVE'|'ELIMINATED'|'FINISHED';eliminatedDay?:number;payout?:number;reports:Record<string,Report>;days:Record<string,boolean>};
export type Pool=Rules & {id:string;hostId:string;createdAt:string;status:'WAITING'|'SCHEDULED'|'ACTIVE'|'COMPLETED';startAt:string|null;testNow:string|null;players:Player[];settled:boolean;version:number};
export class PoolError extends Error {statusCode=400;}
export const fail=(message:string):never=>{throw new PoolError(message);};
export function localDateAt(date:Date,tz:string){return formatInTimeZone(date,tz,'yyyy-MM-dd');}
export function addDate(date:string,days:number){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function midnight(date:string,tz:string){return fromZonedTime(date+'T00:00:00',tz);}
export function dayDate(p:Pool,day:number){return addDate(localDateAt(new Date(p.startAt!),p.timezone),day-1);}
export function dayEnd(p:Pool,day:number){return midnight(addDate(dayDate(p,day),1),p.timezone);}
export function effectiveNow(p:Pool,now:Date){return new Date(p.testNow??now);}
export function currentDay(p:Pool,now:Date){if(!p.startAt)return 0;return Math.floor((Date.parse(localDateAt(effectiveNow(p,now),p.timezone)+'T12:00:00Z')-Date.parse(localDateAt(new Date(p.startAt),p.timezone)+'T12:00:00Z'))/86400000)+1;}
export function makePool(id:string,hostId:string,rules:Rules,now:Date):Pool{return {...rules,id,hostId,createdAt:now.toISOString(),status:'WAITING',startAt:null,testNow:null,players:[],settled:false,version:0};}
export function join(p:Pool,id:string,name:string,now:Date){
  if(p.players.some(x=>x.id===id))return false;
  if(p.status!=='WAITING'||p.players.length>=p.capacity)fail('This pool is full or has already started.');
  p.players.push({id,name,status:'ACTIVE',reports:{},days:{}});
  if(p.players.length===p.capacity){p.startAt=midnight(addDate(localDateAt(now,p.timezone),1),p.timezone).toISOString();p.status='SCHEDULED';}
  return true;
}
export function leave(p:Pool,id:string){
  if(p.status!=='WAITING'&&p.status!=='SCHEDULED')fail('You can only leave before the pool starts.');
  const i=p.players.findIndex(x=>x.id===id);if(i<0)return false;
  p.players.splice(i,1);p.status='WAITING';p.startAt=null;p.testNow=null;return true;
}
export function passes(p:Pool,day:number,report:Report|undefined){
  if(!report)return false;
  return p.goals.every(g=>{
    if(g.metric!=='sleep')return (report.values[g.metric]??0)>=g.target;
    // One main overnight sleep, assigned to its wake-up day. Never add
    // overlapping sleep stages or count naps toward a bedtime requirement.
    if(!report.sleepStart||!report.sleepEnd)return false;
    const start=new Date(report.sleepStart),end=new Date(report.sleepEnd);
    const date=dayDate(p,day),previous=addDate(date,-1);
    if(!(end>start)||localDateAt(end,p.timezone)!==date)return false;
    const hours=(end.getTime()-start.getTime())/3600000;
    if(start<midnight(previous,p.timezone)||hours>24||hours<g.target)return false;
    const time=(mins:number)=>`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}:00`;
    const bedDate=g.bedtime!==undefined&&g.bedtime<(g.wakeTime??720)?date:previous;
    if(g.bedtime!==undefined&&start>fromZonedTime(bedDate+'T'+time(g.bedtime),p.timezone))return false;
    if(g.wakeTime!==undefined&&end>fromZonedTime(date+'T'+time(g.wakeTime),p.timezone))return false;
    return true;
  });
}
export function record(p:Pool,id:string,day:number,report:Report,now:Date){
  if(p.status!=='ACTIVE')fail('The pool is not active.');
  const player=p.players.find(x=>x.id===id);if(!player||player.status!=='ACTIVE')fail('Player is no longer active.');
  const today=currentDay(p,now);
  if(day!==today||day<1||day>p.durationDays)fail('Only the current open day can be updated.');
  for(const key of Object.keys(report.values))if(!p.goals.some(g=>g.metric===key))fail('That metric is not part of this pool.');
  if(p.goals.some(g=>g.metric==='sleep')&&(report.sleepStart||report.sleepEnd)){
    if(!report.sleepStart||!report.sleepEnd||new Date(report.sleepEnd)<=new Date(report.sleepStart)||new Date(report.sleepEnd)>effectiveNow(p,now))fail('Use a completed sleep interval with start and end times.');
  }
  // Full daily snapshots replace earlier snapshots: retries never add steps.
  player!.reports[String(day)]=report;
}
export function tick(p:Pool,now:Date){
  const clock=effectiveNow(p,now);
  if(p.status==='SCHEDULED'&&clock>=new Date(p.startAt!))p.status='ACTIVE';
  if(p.status!=='ACTIVE')return;
  for(let day=1;day<=p.durationDays&&clock>=dayEnd(p,day);day++){
    for(const player of p.players){
      if(player.status!=='ACTIVE'||String(day) in player.days)continue;
      const passed=passes(p,day,player.reports[String(day)]);player.days[String(day)]=passed;
      if(!passed){player.status='ELIMINATED';player.eliminatedDay=day;}
    }
  }
  if(clock>=dayEnd(p,p.durationDays)){
    const winners=p.players.filter(x=>x.status==='ACTIVE');
    const total=p.buyIn*p.players.length;
    if(winners.length){const share=Math.floor(total/winners.length),remainder=total%winners.length;winners.forEach((w,i)=>{w.status='FINISHED';w.payout=share+(i<remainder?1:0);});}
    else p.players.forEach(x=>{x.payout=p.buyIn;});
    p.status='COMPLETED';
  }
}
export function advance(p:Pool,now:Date){
  if(p.status==='SCHEDULED')p.testNow=new Date(dayEnd(p,1).getTime()-1000).toISOString();
  else if(p.status==='ACTIVE'){const day=currentDay(p,now);p.testNow=new Date(day>=p.durationDays?dayEnd(p,p.durationDays).getTime():dayEnd(p,day+1).getTime()-1000).toISOString();}
  else fail('Fill the pool before advancing its test clock.');
  tick(p,now);
}
