import {it,expect,vi,beforeEach} from 'vitest';
const tx=vi.hoisted(()=>({$queryRaw:vi.fn(),race:{findUnique:vi.fn(),delete:vi.fn()},raceEntry:{findUnique:vi.fn(),update:vi.fn(),count:vi.fn()},user:{update:vi.fn()},ledgerEntry:{updateMany:vi.fn(),create:vi.fn()},userLeagueState:{update:vi.fn()}}));
vi.mock('../src/lib/prisma.js',()=>({prisma:{$transaction:(fn:any)=>fn(tx)}}));
vi.mock('../src/modules/notifications/service.js',()=>({notifyUsers:vi.fn(),notifyUser:vi.fn()}));
import {cancelRaceEntry,ensureOpenRaces} from '../src/modules/races/service.js';
beforeEach(()=>{vi.clearAllMocks();tx.race.findUnique.mockResolvedValue({id:'r',status:'FILLING',currency:'ZAR',metricKey:'STEPS'});tx.raceEntry.findUnique.mockResolvedValue({id:'e',status:'ENTERED',entryFeeCents:100,squadId:null});tx.raceEntry.count.mockResolvedValue(0);});
it('refunds the last entrant before removing the empty race',async()=>{
 expect(await cancelRaceEntry({raceId:'r',userId:'u'})).toMatchObject({deleted:true,refundedCents:100});
 expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({data:{walletBalanceCents:{increment:100}}}));
 expect(tx.ledgerEntry.create.mock.invocationCallOrder[0]).toBeLessThan(tx.race.delete.mock.invocationCallOrder[0]);
});
it('keeps a race with another entrant and rejects withdrawals after locking',async()=>{
 tx.raceEntry.count.mockResolvedValue(1);expect(await cancelRaceEntry({raceId:'r',userId:'u'})).toMatchObject({deleted:false});expect(tx.race.delete).not.toHaveBeenCalled();
 tx.race.findUnique.mockResolvedValue({id:'r',status:'LOCKED'});await expect(cancelRaceEntry({raceId:'r',userId:'u'})).rejects.toThrow('locked');
});
it('rechecks entrants under the race lock before cleanup',async()=>{
 tx.$queryRaw.mockResolvedValue([{id:'joined'},{id:'empty'}]);tx.raceEntry.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
 await ensureOpenRaces();expect(tx.race.delete).toHaveBeenCalledTimes(1);expect(tx.race.delete).toHaveBeenCalledWith({where:{id:'empty'}});
});
