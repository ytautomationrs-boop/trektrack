import {beforeEach,it,expect,vi} from 'vitest';
const db=vi.hoisted(()=>({$queryRaw:vi.fn(),socialEventParticipant:{findMany:vi.fn(),upsert:vi.fn()},socialEvent:{findUnique:vi.fn()}}));
vi.mock('../../lib/prisma.js',()=>({prisma:{...db,$transaction:(fn:any)=>fn(db)}}));
vi.mock('../notifications/inbox.js',()=>({notifyActivity:vi.fn()}));
import {joinSocialEvent} from './service.js';
beforeEach(()=>vi.clearAllMocks());
it('checks capacity under an event row lock before adding a player',async()=>{
 db.$queryRaw.mockResolvedValue([{status:'UPCOMING',visibility:'PUBLIC',maxPlayers:2}]);db.socialEventParticipant.findMany.mockResolvedValue([{userId:'a'},{userId:'b'}]);
 await expect(joinSocialEvent('e','c')).rejects.toMatchObject({code:'event_full'});expect(db.socialEventParticipant.upsert).not.toHaveBeenCalled();expect(db.$queryRaw.mock.calls[0]?.[0].join('')).toContain('FOR UPDATE');
});
it('rejects joining a private game without its invite and never writes',async()=>{
 db.$queryRaw.mockResolvedValue([{status:'UPCOMING',visibility:'PRIVATE',inviteCode:'secret',maxPlayers:2}]);db.socialEventParticipant.findMany.mockResolvedValue([{userId:'a'}]);
 await expect(joinSocialEvent('e','b','wrong')).rejects.toMatchObject({code:'invalid_invite'});expect(db.socialEventParticipant.upsert).not.toHaveBeenCalled();
});
