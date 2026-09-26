export const currentRaceStatuses=new Set(['FILLING','LOCKED','RUNNING','RESOLVING']);
export const currentPoolStatuses=new Set(['WAITING','SCHEDULED','ACTIVE']);
export function activeRaces<T extends {status:string;race:{status:string}}>(entries:T[]){return entries.filter(e=>e.status==='ENTERED'&&currentRaceStatuses.has(e.race.status));}
export function activePools<T extends {currency?:string;joined:boolean;status:string;players?:Array<{isYou?:boolean;status:string}>}>(pools:T[]){return pools.filter(p=>p.currency==='ZAR'&&p.joined&&currentPoolStatuses.has(p.status)&&p.players?.some(x=>x.isYou&&x.status==='ACTIVE'));}
export function competingMetrics(races:Array<{race:{metricKey:string}}>,pools:Array<{goals:Array<{metric:string}>}>){const selected=new Set([...races.map(e=>e.race.metricKey),...pools.flatMap(p=>p.goals.map(g=>g.metric))]);return ['steps','running','cycling','swimming','sleep'].filter(m=>selected.has(m));}
