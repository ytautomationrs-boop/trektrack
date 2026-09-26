import type { FastifyInstance } from 'fastify';
import {z} from 'zod';
import {isBootstrapAdminEmail} from '../../lib/adminAccess.js';
import {prisma} from '../../lib/prisma.js';
import {requireAuth} from '../../middleware/auth.js';
import {hashPassword,verifyPassword} from '../auth/password.js';
import {smsAvailable,sendCode,checkCode} from '../auth/sms.js';
export const preferencesSchema=z.object({push:z.boolean(),messages:z.boolean(),invites:z.boolean(),likes:z.boolean(),comments:z.boolean(),competitions:z.boolean()});
export const defaultPreferences={push:true,messages:true,invites:true,likes:true,comments:true,competitions:true};
const credentials=z.object({password:z.string().min(1).max(1024),code:z.string().regex(/^\d{4,10}$/).optional()});
const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export async function settingsRoutes(app:FastifyInstance){
 const options={preHandler:requireAuth,config:{rateLimit:{max:5,timeWindow:'1 minute'}}};
 async function owner(id:string,password:string){
  const user=await prisma.user.findUniqueOrThrow({where:{id}});
  if(!await verifyPassword(password,user.passwordHash))throw fail('Your current password is incorrect.');
  return user;
 }
 async function secondFactor(user:{twoFactorEnabled:boolean;phoneNumber:string|null},code?:string){
  if(user.twoFactorEnabled){if(!code || !user.phoneNumber)throw fail('Enter the code sent to your phone.');await checkCode(user.phoneNumber,code);}
 }
 app.get('/me/settings',{preHandler:requireAuth},async(req)=>{
  const user=await prisma.user.findUniqueOrThrow({where:{id:req.userId},select:{email:true,phoneNumber:true,twoFactorEnabled:true,notificationPreferences:true}});
  return {...user,notificationPreferences:{...defaultPreferences,...user.notificationPreferences as object},smsAvailable:smsAvailable()};
 });
 app.patch('/me/settings/notifications',{preHandler:requireAuth},async(req)=>{
  const preferences=preferencesSchema.parse(req.body);
  await prisma.user.update({where:{id:req.userId},data:{notificationPreferences:preferences}});
  return {notificationPreferences:preferences};
 });
 app.post('/me/settings/send-code',options,async(req)=>{
  const body=credentials.extend({phoneNumber:z.string().regex(/^\+[1-9]\d{7,14}$/).optional()}).parse(req.body);
  const user=await owner(req.userId,body.password);
  const phone=user.twoFactorEnabled?user.phoneNumber:body.phoneNumber;
  if(!phone)throw fail('Enter your phone number with country code.');
  await sendCode(phone);return {sent:true};
 });
 app.post('/me/settings/security',options,async(req)=>{
  const body=credentials.extend({action:z.enum(['password','email','enable2fa','disable2fa']),newPassword:z.string().min(8).max(1024).optional(),email:z.string().trim().toLowerCase().email().optional(),phoneNumber:z.string().regex(/^\+[1-9]\d{7,14}$/).optional()}).parse(req.body);
  const user=await owner(req.userId,body.password);
  const data:{passwordHash?:string;email?:string;phoneNumber?:string|null;twoFactorEnabled?:boolean}={};
  if(body.action==='password'){if(!body.newPassword)throw fail('Enter a new password of at least 8 characters.');data.passwordHash=await hashPassword(body.newPassword);}
  if(body.action==='email'){
   if(!body.email)throw fail('Enter a valid email address.');
   if(isBootstrapAdminEmail(body.email) || isBootstrapAdminEmail(user.email))throw fail('This administrator email is managed by ASTA support.');
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
