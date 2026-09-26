import {beforeAll,it,expect} from 'vitest';
import {generateKeyPair,SignJWT} from 'jose';
import {verifyProviderToken} from '../src/modules/auth/providerTokens.js';
let keys:Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async()=>{keys=await generateKeyPair('RS256');});
async function token(extra:Record<string,unknown>={}){return new SignJWT({sub:'stable-subject',nonce:'one-use-nonce',email:'member@example.test',email_verified:true,...extra}).setProtectedHeader({alg:'RS256'}).setIssuer('https://accounts.google.com').setAudience('asta-client').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);}
it('accepts verified provider identity with matching nonce and audience',async()=>{expect(await verifyProviderToken('google',await token(),'one-use-nonce',['asta-client'],async()=>keys.publicKey)).toEqual({subject:'stable-subject',email:'member@example.test'});});
it('rejects a token issued for another application',async()=>{await expect(verifyProviderToken('google',await token(),'one-use-nonce',['other-client'],async()=>keys.publicKey)).rejects.toThrow();});
it('rejects replay into a different login challenge',async()=>{await expect(verifyProviderToken('google',await token(),'different-nonce',['asta-client'],async()=>keys.publicKey)).rejects.toThrow();});
it('rejects a Google token presented as an Apple identity',async()=>{await expect(verifyProviderToken('apple',await token(),'one-use-nonce',['asta-client'],async()=>keys.publicKey)).rejects.toThrow();});
it('does not trust an unverified provider email',async()=>{expect((await verifyProviderToken('google',await token({email_verified:false}),'one-use-nonce',['asta-client'],async()=>keys.publicKey)).email).toBeNull();});
