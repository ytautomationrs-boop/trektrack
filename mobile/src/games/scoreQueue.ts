import type {Game} from './scoring';
export type Point={operationId:string;side:0|1;value:number;at:string};
export class ScoreQueue {
 private listeners=new Set<()=>void>();private working=false;
 snapshot:{game:Game;pending:Point[];error:string};
 constructor(game:Game,pending:Point[],private send:(point:Point,version:number)=>Promise<Game>,private persist:(pending:Point[])=>void){this.snapshot={game,pending,error:''};}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private emit(){this.snapshot={...this.snapshot,pending:[...this.snapshot.pending]};this.persist(this.snapshot.pending);this.listeners.forEach(fn=>fn());}
 reconcile(game:Game){if(game.version>this.snapshot.game.version){this.snapshot.game=game;this.snapshot.pending=this.snapshot.pending.filter(p=>!game.actions.some(a=>a.id===p.operationId)&&!game.operationIds.includes(p.operationId));this.emit();}}
 enqueue(side:0|1,value:number){this.snapshot.pending.push({operationId:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`,side,value,at:new Date().toISOString()});this.emit();void this.flush();}
 retry=()=>{void this.flush();};
 discard=()=>{if(!this.working){this.snapshot.pending=[];this.snapshot.error='';this.emit();}};
 async flush(){if(this.working)return;this.working=true;this.snapshot.error='';this.emit();try{while(this.snapshot.pending.length){const point=this.snapshot.pending[0];try{const saved=await this.send(point,this.snapshot.game.version);if(saved.version>=this.snapshot.game.version)this.snapshot.game=saved;this.snapshot.pending=this.snapshot.pending.filter(p=>p.operationId!==point.operationId);this.emit();}catch(e:any){this.snapshot.error=e.message??'Your points are waiting to save.';this.emit();break;}}}finally{this.working=false;}}
 preview(){const game=this.snapshot.game;return {...game,actions:[...game.actions,...this.snapshot.pending.filter(p=>!game.actions.some(a=>a.id===p.operationId)).map(p=>({id:p.operationId,side:p.side,value:p.value,at:p.at}))]};}
}
