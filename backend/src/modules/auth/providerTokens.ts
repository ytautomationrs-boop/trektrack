import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';
const appleKeys=createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export type Provider='apple'|'google';
export async function verifyProviderToken(provider:Provider,token:string,nonce:string,audience:string[],key?:JWTVerifyGetKey){
 if(!audience.length)throw new Error('This sign-in provider is not configured.');
 const {payload}=await jwtVerify(token,key ?? (provider==='apple'?appleKeys:googleKeys),{
  algorithms:['RS256'],issuer:provider==='apple'?'https://appleid.apple.com':['https://accounts.google.com','accounts.google.com'],audience,maxTokenAge:'10m',clockTolerance:30,
 });
 if(payload.nonce!==nonce || !payload.sub)throw new Error('Sign-in verification failed. Please try again.');
 return {subject:payload.sub,email:typeof payload.email==='string' && (payload.email_verified===true||payload.email_verified==='true')?payload.email.toLowerCase():null};
}
