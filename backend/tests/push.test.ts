import Fastify from 'fastify';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({tokens:vi.fn(),send:vi.fn(),configured:vi.fn(()=>true)}));
vi.mock('../src/lib/prisma.js',()=>({prisma:{pushToken:{findMany:mocks.tokens}}}));
vi.mock('../src/middleware/auth.js',()=>({requireAuth:async(req:any)=>{req.userId='viewer';}}));
vi.mock('../src/modules/notifications/apns.js',()=>({apnsConfigured:mocks.configured,sendApplePush:mocks.send}));
import {notificationRoutes} from '../src/modules/notifications/routes.js';
const app=Fastify();beforeAll(async()=>{await app.register(notificationRoutes);await app.ready();});afterAll(()=>app.close());beforeEach(()=>{vi.clearAllMocks();mocks.configured.mockReturnValue(true);});
it('tests only phones belonging to the authenticated account and confirms Apple acceptance',async()=>{
 mocks.tokens.mockResolvedValue([{token:'apns:test-token'}]);mocks.send.mockResolvedValue(undefined);
 const response=await app.inject({method:'POST',url:'/notifications/test',payload:{}});
 expect(response.statusCode).toBe(200);expect(response.json()).toEqual({accepted:1});expect(mocks.tokens.mock.calls[0]?.[0].where.userId).toBe('viewer');expect(mocks.send.mock.calls[0]?.[0]).toBe('test-token');
});
it('does not claim success when Apple rejects every device',async()=>{
 mocks.tokens.mockResolvedValue([{token:'apns:test-token'}]);mocks.send.mockRejectedValue(new Error('APNs 403: InvalidProviderToken'));
 const response=await app.inject({method:'POST',url:'/notifications/test',payload:{}});expect(response.statusCode).toBe(502);
});
it('explains missing phone registration',async()=>{
 mocks.tokens.mockResolvedValue([]);const response=await app.inject({method:'POST',url:'/notifications/test',payload:{}});expect(response.statusCode).toBe(400);expect(mocks.send).not.toHaveBeenCalled();
});
