import {it,expect,vi} from 'vitest';
const find=vi.hoisted(()=>vi.fn());
vi.mock('../src/lib/prisma.js',()=>({prisma:{user:{findUnique:find}}}));
vi.mock('../src/lib/adminAccess.js',()=>({ensureEffectiveAdmin:vi.fn()}));
import {requireAuth} from '../src/middleware/auth.js';
it('rejects purpose tokens and revoked sessions, while keeping pre-upgrade sessions valid at version zero',async()=>{
 for(const [payload,version,allowed] of [[{sub:'u'},0,true],[{sub:'u'},1,false],[{sub:'u',v:2},2,true],[{sub:'u',v:1},2,false],[{sub:'u',v:2,purpose:'otp'},2,false]] as const){
 find.mockResolvedValue({id:'u',authVersion:version});const req:any={jwtVerify:async()=>payload};const reply:any={code:vi.fn().mockReturnThis(),send:vi.fn()};await requireAuth(req,reply);expect(req.userId==='u').toBe(allowed);if(!allowed)expect(reply.code).toHaveBeenCalledWith(401);
 }
});
