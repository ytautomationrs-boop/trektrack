import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const db=vi.hoisted(()=>({claim:vi.fn()}));
vi.mock('../src/lib/prisma.js',()=>({prisma:{$executeRaw:db.claim}}));
import {sendCode,checkCode,smsAvailable} from '../src/modules/auth/sms.js';
beforeEach(()=>{vi.stubEnv('TWILIO_ACCOUNT_SID','test-account');vi.stubEnv('TWILIO_AUTH_TOKEN','test-secret');vi.stubEnv('TWILIO_VERIFY_SERVICE_SID','test-service');vi.clearAllMocks();});afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('does not send without provider credentials',async()=>{vi.stubEnv('TWILIO_AUTH_TOKEN','');expect(smsAvailable()).toBe(false);await expect(sendCode('+27820000000')).rejects.toThrow('not available');expect(db.claim).not.toHaveBeenCalled();});
it('enforces a persistent per-phone send cooldown before provider calls',async()=>{db.claim.mockResolvedValue(0);const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(sendCode('+27820000000')).rejects.toThrow('one minute');expect(fetch).not.toHaveBeenCalled();});
it('only accepts the approved verification status',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'pending'})}));await expect(checkCode('+27820000000','123456')).rejects.toThrow('not correct');});
it('handles consumed/expired codes without treating them as verified',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:404}));await expect(checkCode('+27820000000','123456')).rejects.toThrow('expired');});
