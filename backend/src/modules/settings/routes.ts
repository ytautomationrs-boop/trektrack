import {revokeAppleToken} from '../auth/appleTokens.js';
import {deleteAccount} from '../account/deletion.js';
import type { FastifyInstance } from 'fastify';
import {z} from 'zod';
import {prisma} from '../../lib/prisma.js';
import {requireAuth} from '../../middleware/auth.js';
import {hashPassword,verifyPassword} from '../auth/password.js';
import {smsAvailable,sendCode,checkCode} from '../auth/sms.js';
export const preferencesSchema=z.object({push:z.boolean(),messages:z.boolean(),invites:z.boolean(),likes:z.boolean(),comments:z.boolean(),competitions:z.boolean()});
export const defaultPreferences={push:true,messages:true,invites:true,likes:true,comments:true,competitions:true};
const credentials=z.object({password:z.string().max(1024).optional(),reauthToken:z.string().max(16000).optional(),code:z.string().regex(/^\d{4,10}$/).optional()});
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export async function settingsRoutes(app:FastifyInstance){
 const options={preHandler:requireAuth,config:{rateLimit:{max:5,timeWindow:'1 minute'}}};
 async function owner(id:string,password?:string,reauthToken?:string){
  const user=await prisma.user.findUniqueOrThrow({where:{id}});
  if(reauthToken){
   let proof:{purpose:string;sub:string;v:number;jti:string};
   try{proof=app.jwt.verify(reauthToken);}catch{throw fail('Verify your identity again.',401);}
   if(proof.purpose!=='reauth'||proof.sub!==id||proof.v!==user.authVersion)throw fail('Verification does not match this account.',401);
   const claimed=await prisma.authChallenge.updateMany({where:{id:proof.jti,provider:'reauth',nonce:id,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
   if(!claimed.count)throw fail('Verify your identity again.',401);
  }else if(!password || !await verifyPassword(password,user.passwordHash))throw fail('Your current password is incorrect.');
  return user;
 }
 async function secondFactor(user:{twoFactorEnabled:boolean;phoneNumber:string|null},code?:string){
  if(user.twoFactorEnabled){if(!code || !user.phoneNumber)throw fail('Enter the code sent to your phone.');await checkCode(user.phoneNumber,code);}
 }
 app.post('/me/settings/delete-account',options,async req=>{
  const body=credentials.extend({confirmation:z.literal('DELETE')}).parse(req.body);
  const user=await owner(req.userId,body.password,body.reauthToken);
  await secondFactor(user,body.code);
  // Only revoke once local obligations have been checked; deletion rechecks
  // them transactionally so concurrent payments cannot slip through.
  const identities=await prisma.authIdentity.findMany({where:{userId:user.id,provider:'apple'},select:{refreshTokenEncrypted:true}});
  return deleteAccount(user.id,user.authVersion,async()=>{for(const identity of identities)if(identity.refreshTokenEncrypted)await revokeAppleToken(identity.refreshTokenEncrypted);});
 });
 app.get('/me/settings',{preHandler:requireAuth},async(req)=>{
  const user=await prisma.user.findUniqueOrThrow({where:{id:req.userId},select:{email:true,phoneNumber:true,twoFactorEnabled:true,notificationPreferences:true,hasPassword:true,authIdentities:{select:{provider:true}}}});
  return {...user,notificationPreferences:{...defaultPreferences,...user.notificationPreferences as object},smsAvailable:smsAvailable()};
 });
 app.patch('/me/settings/notifications',{preHandler:requireAuth},async(req)=>{
  const preferences=preferencesSchema.parse(req.body);
  await prisma.user.update({where:{id:req.userId},data:{notificationPreferences:preferences}});
  return {notificationPreferences:preferences};
 });
 app.post('/me/settings/send-code',options,async(req)=>{
  const body=credentials.extend({phoneNumber:z.string().regex(/^\+[1-9]\d{7,14}$/).optional()}).parse(req.body);
  const user=await owner(req.userId,body.password,body.reauthToken);
  const phone=user.twoFactorEnabled?user.phoneNumber:body.phoneNumber;
  if(!phone)throw fail('Enter your phone number with country code.');
  await sendCode(phone);return {sent:true};
 });
 app.post('/me/settings/security',options,async(req)=>{
  const body=credentials.extend({action:z.enum(['password','email','enable2fa','disable2fa']),newPassword:z.string().min(8).max(1024).optional(),email:z.string().trim().toLowerCase().email().optional(),phoneNumber:z.string().regex(/^\+[1-9]\d{7,14}$/).optional()}).parse(req.body);
  const user=await owner(req.userId,body.password,body.reauthToken);
  const data:{passwordHash?:string;hasPassword?:boolean;email?:string;phoneNumber?:string|null;twoFactorEnabled?:boolean}={};
  if(body.action==='password'){if(!body.newPassword)throw fail('Enter a new password of at least 8 characters.');data.passwordHash=await hashPassword(body.newPassword);data.hasPassword=true;}
  if(body.action==='email'){
   if(!body.email)throw fail('Enter a valid email address.');
   if(await prisma.user.findFirst({where:{email:body.email,id:{not:user.id}},select:{id:true}}))throw fail('That email is already in use.');
   data.email=body.email;
  }
  if(body.action==='enable2fa'){
   if(user.twoFactorEnabled)throw fail('Two-factor authentication is already enabled. Disable it before changing your number.');
   if(!body.phoneNumber || !body.code)throw fail('Verify your phone number first.');
   await checkCode(body.phoneNumber,body.code);data.phoneNumber=body.phoneNumber;data.twoFactorEnabled=true;
  }else await secondFactor(user,body.code);
  if(body.action==='disable2fa'){data.phoneNumber=null;data.twoFactorEnabled=false;}
  // Re-check the authenticated version to prevent concurrent security changes overwriting one another.
  const updated=await prisma.user.updateMany({where:{id:user.id,authVersion:user.authVersion},data:{...data,authVersion:{increment:1}}});
  if(!updated.count)throw fail('Account security changed. Please sign in again.',409);
  return {signInAgain:true};
 });
}
