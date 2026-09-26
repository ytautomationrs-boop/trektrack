import {prisma} from '../lib/prisma.js';
import {notifyActivity} from '../modules/notifications/inbox.js';
export async function sendStartReminders(now=new Date()) {
 const soon=new Date(now.getTime()+15*60000);
 const [races,events]=await Promise.all([
  prisma.race.findMany({where:{status:'LOCKED',scheduledStartAt:{gt:now,lte:soon}},select:{id:true,name:true,scheduledStartAt:true,entries:{where:{status:'ENTERED'},select:{userId:true}}}}),
  prisma.socialEvent.findMany({where:{status:'UPCOMING',startsAt:{gt:now,lte:soon}},select:{id:true,name:true,startsAt:true,participants:{where:{status:'JOINED'},select:{userId:true}}}}),
 ]);
 await Promise.all([
  ...races.flatMap(r=>r.entries.map(e=>notifyActivity(e.userId,'race_starting',`start:${r.id}:${r.scheduledStartAt?.toISOString()}`,'Race starting soon',`${r.name} starts in about ${Math.max(1,Math.ceil((r.scheduledStartAt!.getTime()-now.getTime())/60000))} minutes.`,{raceId:r.id}))),
  ...events.flatMap(e=>e.participants.map(p=>notifyActivity(p.userId,'event_starting',`start:${e.id}:${e.startsAt.toISOString()}`,'Game starting soon',`${e.name} starts in about ${Math.max(1,Math.ceil((e.startsAt.getTime()-now.getTime())/60000))} minutes.`,{eventId:e.id}))),
 ]);
}
