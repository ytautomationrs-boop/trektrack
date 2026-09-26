import {appleReady,exchangeAppleCode} from './appleTokens.js';
import type {FastifyInstance} from 'fastify';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {prisma} from '../../lib/prisma.js';
import {requireAuth} from '../../middleware/auth.js';
import {hashPassword} from './password.js';
import {verifyProviderToken,type Provider} from './providerTokens.js';
// OAuth client IDs are public app identifiers, not secrets. Environment values can override them.
const googleWebClientId=process.env.GOOGLE_WEB_CLIENT_ID ?? '1006280282553-bsmbb44ie7j4d9nul9s7mnuu9fa12h3p.apps.googleusercontent.com';
const googleIosClientId=process.env.GOOGLE_IOS_CLIENT_ID ?? '1006280282553-bs0e7gkm59h5p0sg5iif0ln622b1tgn3.apps.googleusercontent.com';
const provider=z.enum(['apple','google']);
const failure=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const rate={rateLimit:{max:12,timeWindow:'1 minute',keyGenerator:(req:{ip:string})=>req.ip}};
export function providerConfig(){return {apple:process.env.APPLE_SIGN_IN_ENABLED==='true' && appleReady(),google:process.env.GOOGLE_SIGN_IN_ENABLED==='true' && !!googleWebClientId,googleWebClientId,googleIosClientId};}
const select={id:true,email:true,displayName:true,avatarUrl:true,coverUrl:true,bio:true,walletBalanceCents:true,isAdmin:true,authVersion:true,bannedAt:true,suspendedAt:true,twoFactorEnabled:true} as const;
export async function providerRoutes(app:FastifyInstance){
 app.post('/auth/provider/challenge',{config:rate},async req=>{
  const body=z.object({provider}).parse(req.body),config=providerConfig();
  if(!config[body.provider])throw failure('This sign-in option is not ready yet.',503);
  const id=randomBytes(24).toString('hex'),nonce=randomBytes(32).toString('hex');
  await prisma.authChallenge.create({data:{id,nonce,provider:body.provider,expiresAt:new Date(Date.now()+10*60000)}});
  void prisma.authChallenge.deleteMany({where:{expiresAt:{lt:new Date(Date.now()-3600000)}}}).catch(()=>{});
  return {id,nonce};
 });
 app.post('/auth/provider',{config:rate},async(req,reply)=>{
  const body=z.object({provider,challengeId:z.string().length(48),identityToken:z.string().max(16000),authorizationCode:z.string().max(4000).optional()}).parse(req.body);
  const challenge=await prisma.authChallenge.findUnique({where:{id:body.challengeId}});
  if(!challenge || challenge.provider!==body.provider || challenge.consumedAt || challenge.expiresAt.getTime()<Date.now())throw failure('Sign-in expired. Please try again.');
  const audiences=body.provider==='apple'?[process.env.APPLE_CLIENT_ID ?? 'com.reecewheeler.asta']:[googleWebClientId].filter(Boolean) as string[];
  let identity;
  try{identity=await verifyProviderToken(body.provider,body.identityToken,challenge.nonce,audiences);}catch{throw failure('We could not verify this sign-in. Please try again.',401);}
  const claimed=await prisma.authChallenge.updateMany({where:{id:challenge.id,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
  if(!claimed.count)throw failure('This sign-in was already used.',401);
  let refreshTokenEncrypted:string|undefined;
  if(body.provider==='apple'){
   if(!body.authorizationCode)throw failure('Apple did not return its authorization code.',401);
   refreshTokenEncrypted=await exchangeAppleCode(body.authorizationCode,challenge.nonce,identity.subject);
   await prisma.authChallenge.update({where:{id:challenge.id},data:{refreshTokenEncrypted}});
  }
  const linked=await prisma.authIdentity.findUnique({where:{provider_subject:{provider:body.provider,subject:identity.subject}},include:{user:{select}}});
  if(linked){
   if(refreshTokenEncrypted)await prisma.authIdentity.update({where:{id:linked.id},data:{refreshTokenEncrypted}});
   const user=linked.user;
   if(user.bannedAt||user.suspendedAt)throw failure('This account is not available.',403);
   if(user.twoFactorEnabled)throw failure('Use your existing sign-in method with phone verification for this protected account.',403);
   return {token:app.jwt.sign({sub:user.id,v:user.authVersion},{expiresIn:'30d'}),user};
  }
  if(!identity.email)throw failure('Allow email access to create your ASTA account.');
  if(await prisma.user.findUnique({where:{email:identity.email},select:{id:true}}))throw failure('An ASTA account already uses this email. Sign in with your existing password.',409);
  return {needsUsername:true,registrationToken:app.jwt.sign({purpose:'provider_signup',challengeId:challenge.id,provider:body.provider,subject:identity.subject,email:identity.email},{expiresIn:'10m'})};
 });
 app.post('/auth/provider/reauth',{preHandler:requireAuth,config:rate},async req=>{
  const body=z.object({provider,challengeId:z.string().length(48),identityToken:z.string().max(16000),authorizationCode:z.string().max(4000).optional()}).parse(req.body);
  const challenge=await prisma.authChallenge.findUnique({where:{id:body.challengeId}});
  if(!challenge || challenge.provider!==body.provider || challenge.consumedAt || challenge.expiresAt.getTime()<Date.now())throw failure('Verification expired. Try again.',401);
  const audience=body.provider==='apple'?[process.env.APPLE_CLIENT_ID ?? 'com.reecewheeler.asta']:[googleWebClientId].filter(Boolean) as string[];
  let identity;try{identity=await verifyProviderToken(body.provider,body.identityToken,challenge.nonce,audience);}catch{throw failure('Verification failed.',401);}
  const linked=await prisma.authIdentity.findUnique({where:{provider_subject:{provider:body.provider,subject:identity.subject}},include:{user:true}});
  if(!linked || linked.userId!==req.userId)throw failure('Use the account linked to this ASTA profile.',403);
  const claimed=await prisma.authChallenge.updateMany({where:{id:challenge.id,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
  if(!claimed.count)throw failure('Verification already used.',401);
  const id=randomBytes(24).toString('hex');
  await prisma.authChallenge.create({data:{id,nonce:req.userId,provider:'reauth',expiresAt:new Date(Date.now()+5*60000)}});
  return {reauthToken:app.jwt.sign({purpose:'reauth',sub:req.userId,v:linked.user.authVersion,jti:id},{expiresIn:'5m'})};
 });
 app.post('/auth/provider/signup',{config:rate},async(req,reply)=>{
  const body=z.object({registrationToken:z.string().max(16000),displayName:z.string().trim().min(2).max(40),inviteCode:z.string().trim().min(1),timezone:z.string().max(100).default('UTC')}).parse(req.body);
  let claims:{purpose:string;provider:Provider;subject:string;email:string;challengeId:string};
  try{claims=app.jwt.verify(body.registrationToken);}catch{throw failure('Sign-in expired. Start again.',401);}
  if(claims.purpose!=='provider_signup'||!['apple','google'].includes(claims.provider))throw failure('Invalid registration.',401);
  const verification=await prisma.authChallenge.findUnique({where:{id:claims.challengeId}});
  if(!verification?.consumedAt || verification.expiresAt.getTime()<Date.now())throw failure('Sign-in expired. Start again.',401);
  const passwordHash=await hashPassword(randomBytes(48).toString('hex'));
  const user=await prisma.$transaction(async tx=>{
   const invite=await tx.inviteCode.findUnique({where:{code:body.inviteCode}});
   if(!invite||invite.revokedAt||invite.useCount>=invite.maxUses)throw failure('That invite code is not available.',403);
   const user=await tx.user.create({data:{email:claims.email,passwordHash,hasPassword:false,displayName:body.displayName,timezone:body.timezone,isAdmin:false,authIdentities:{create:{provider:claims.provider,subject:claims.subject,refreshTokenEncrypted:verification.refreshTokenEncrypted}}},select});
   const claimed=await tx.inviteCode.updateMany({where:{id:invite.id,useCount:invite.useCount,revokedAt:null},data:{useCount:{increment:1},usedByUserIds:{push:user.id}}});
   if(!claimed.count)throw failure('That invite was just used. Try a new code.',409);
   const consumed=await tx.authChallenge.deleteMany({where:{id:claims.challengeId,consumedAt:{not:null},expiresAt:{gt:new Date()}}});
   if(!consumed.count)throw failure('This signup was already completed. Sign in again.',409);
   return user;
  });
  return reply.code(201).send({token:app.jwt.sign({sub:user.id,v:user.authVersion},{expiresIn:'30d'}),user,isNewUser:true});
 });
}
