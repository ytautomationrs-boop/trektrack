import {beforeEach,describe,it,expect,vi} from 'vitest';
const db=vi.hoisted(()=>({$queryRaw:vi.fn(),socialEvent:{update:vi.fn()},socialEventParticipant:{count:vi.fn(),findMany:vi.fn()}}));
vi.mock('../../lib/prisma.js',()=>({prisma:{$transaction:(fn:any)=>fn(db),socialEventParticipant:db.socialEventParticipant}}));
vi.mock('../notifications/inbox.js',()=>({notifyActivity:vi.fn()}));
import {updateGame} from './game.js';
import type {Game} from './scoring.js';
const game=():Game=>({version:1,startedAt:'2026-09-25T12:00:00Z',finishedAt:null,runningSince:'2026-09-25T12:00:00Z',elapsedMs:0,bestOf:3,teams:['A','B'],actions:[],operationIds:['start-123']});
beforeEach(()=>{vi.clearAllMocks();db.socialEventParticipant.findMany.mockResolvedValue([]);db.socialEvent.update.mockResolvedValue({});});
describe('game authorization and retry safety',()=>{
 it('rejects a non-host and a start with empty places',async()=>{
  db.$queryRaw.mockResolvedValue([{hostUserId:'host',status:'UPCOMING',maxPlayers:4,game:null}]);
  await expect(updateGame('event','other',{action:'start',version:0,operationId:'op-123456'})).rejects.toMatchObject({code:'not_host'});
  db.socialEventParticipant.count.mockResolvedValue(3);await expect(updateGame('event','host',{action:'start',version:0,operationId:'op-123456'})).rejects.toMatchObject({code:'not_full'});expect(db.socialEvent.update).not.toHaveBeenCalled();
 });
 it('starts a full event with a persisted timer',async()=>{
  db.$queryRaw.mockResolvedValue([{hostUserId:'host',status:'UPCOMING',maxPlayers:4,game:null}]);db.socialEventParticipant.count.mockResolvedValue(4);
  const result=await updateGame('event','host',{action:'start',version:0,operationId:'op-123456'});expect(result.status).toBe('LIVE');expect(result.game.runningSince).toBeTruthy();expect(result.game.version).toBe(1);
 });
 it('does not double-score a retried operation or accept a stale revision',async()=>{
  const current=game();current.actions.push({id:'point-123',side:0,value:1,at:''});current.operationIds.push('point-123');current.version=2;
  db.$queryRaw.mockResolvedValue([{hostUserId:'host',status:'LIVE',sportKey:'tennis',game:current}]);
  const result=await updateGame('event','host',{action:'score',side:0,value:1,version:1,operationId:'point-123'});expect(result.game.actions).toHaveLength(1);expect(db.socialEvent.update).not.toHaveBeenCalled();
  await expect(updateGame('event','host',{action:'score',side:0,value:1,version:1,operationId:'point-456'})).rejects.toMatchObject({code:'game_changed'});
 });
 it('rejects invalid scoring and pauses before accepting more points',async()=>{
  db.$queryRaw.mockResolvedValue([{hostUserId:'host',status:'LIVE',sportKey:'football',game:game()}]);
  await expect(updateGame('event','host',{action:'score',side:0,value:5,version:1,operationId:'invalid-point'})).rejects.toMatchObject({code:'invalid_score'});
  const paused={...game(),runningSince:null};db.$queryRaw.mockResolvedValue([{hostUserId:'host',status:'LIVE',sportKey:'football',game:paused}]);
  await expect(updateGame('event','host',{action:'score',side:0,value:1,version:1,operationId:'paused-point'})).rejects.toMatchObject({code:'game_paused'});
 });
});
