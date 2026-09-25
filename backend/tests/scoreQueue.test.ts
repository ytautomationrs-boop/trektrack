import {describe,it,expect,vi} from 'vitest';
import {ScoreQueue} from '../../mobile/src/games/scoreQueue';
const game=()=>({version:1,startedAt:'2026-09-25',finishedAt:null,runningSince:'2026-09-25',elapsedMs:0,bestOf:3 as const,teams:['A','B'] as [string,string],actions:[],operationIds:[]});
describe('phone scoring queue',()=>{
 it('shows rapid taps immediately and serializes saves',async()=>{
  let resolve:any;const send=vi.fn(()=>new Promise<any>(r=>resolve=r));const q=new ScoreQueue(game(),[],send,()=>{});
  q.enqueue(0,1);q.enqueue(1,1);expect(q.preview().actions).toHaveLength(2);expect(send).toHaveBeenCalledTimes(1);
  const first=q.snapshot.pending[0]!;resolve({...game(),version:2,actions:[{id:first.operationId,side:0,value:1,at:''}]});await new Promise(r=>setTimeout(r,0));expect(send).toHaveBeenCalledTimes(2);expect(q.preview().actions).toHaveLength(2);
  const second=q.snapshot.pending[0]!;resolve({...q.snapshot.game,version:3,actions:[...q.snapshot.game.actions,{id:second.operationId,side:1,value:1,at:''}]});await new Promise(r=>setTimeout(r,0));expect(q.snapshot.pending).toHaveLength(0);
 });
 it('keeps uncertain saves and retries the same operation ID',async()=>{
  const send=vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockImplementation(async(point)=>({...game(),version:2,actions:[{id:point.operationId,side:point.side,value:point.value,at:point.at}]}));
  const persist=vi.fn();const q=new ScoreQueue(game(),[],send,persist);q.enqueue(0,1);await new Promise(r=>setTimeout(r,0));expect(q.snapshot.pending).toHaveLength(1);expect(q.snapshot.error).toBe('Connection lost');await q.flush();expect(send.mock.calls[0]![0].operationId).toBe(send.mock.calls[1]![0].operationId);expect(q.snapshot.pending).toHaveLength(0);
 });
});
