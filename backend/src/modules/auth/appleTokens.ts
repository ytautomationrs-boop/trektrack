import {z} from 'zod';
import {verifyProviderToken} from './providerTokens.js';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {importPKCS8,SignJWT} from 'jose';
function encryptionKey(){if(!process.env.JWT_SECRET)throw new Error('Missing session secret');return createHash('sha256').update('ASTA Apple refresh token\0'+process.env.JWT_SECRET).digest();}
export function sealToken(token:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const data=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
function openToken(value:string){const data=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',encryptionKey(),data.subarray(0,12));decipher.setAuthTag(data.subarray(12,28));return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');}
export function appleReady(){return !!(process.env.APPLE_AUTH_KEY_ID && process.env.APPLE_AUTH_PRIVATE_KEY && process.env.APPLE_TEAM_ID);}
async function clientSecret(){
 const key=await importPKCS8(process.env.APPLE_AUTH_PRIVATE_KEY!.replace(/\\n/g,'\n'),'ES256');
 return new SignJWT({}).setProtectedHeader({alg:'ES256',kid:process.env.APPLE_AUTH_KEY_ID!}).setIssuer(process.env.APPLE_TEAM_ID!).setAudience('https://appleid.apple.com').setSubject(process.env.APPLE_CLIENT_ID ?? 'com.reecewheeler.asta').setIssuedAt().setExpirationTime('5m').sign(key);
}
async function appleRequest(path:string,values:Record<string,string>){
 const response=await fetch(`https://appleid.apple.com/auth/${path}`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.APPLE_CLIENT_ID ?? 'com.reecewheeler.asta',client_secret:await clientSecret(),...values}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Object.assign(new Error('Apple could not confirm this request. Try again.'),{statusCode:503});
 return path==='token'?response.json():null;
}
export async function exchangeAppleCode(code:string,nonce:string,subject:string):Promise<string>{const result=z.object({id_token:z.string().min(1),refresh_token:z.string().min(1)}).parse(await appleRequest('token',{code,grant_type:'authorization_code'}));const identity=await verifyProviderToken('apple',result.id_token,nonce,[process.env.APPLE_CLIENT_ID ?? 'com.reecewheeler.asta']);if(identity.subject!==subject)throw new Error('Apple identity mismatch.');if(!result?.refresh_token)throw new Error('Apple did not return a refresh token.');return sealToken(result.refresh_token);}
export async function revokeAppleToken(encrypted:string){await appleRequest('revoke',{token:openToken(encrypted),token_type_hint:'refresh_token'});}
