import { prisma } from '../../lib/prisma.js';
export const smsAvailable=()=>!!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
function failure(message:string,statusCode=400){return Object.assign(new Error(message),{statusCode});}
async function twilio(path:string,body:Record<string,string>){
 if(!smsAvailable())throw failure('Phone verification is not available yet. Please try again later.',503);
 const response=await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(process.env.TWILIO_VERIFY_SERVICE_SID!)}/${path}`,{
  method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),signal:AbortSignal.timeout(8000)
 });
 if(!response.ok)throw failure(response.status===404?'This code expired or was already used. Request another code.':'Verification could not be completed. Check your code or try again later.',response.status===429?429:400);
 return response.json() as Promise<{status:string}>;
}
export async function sendCode(phone:string){
 if(!smsAvailable())throw failure('Phone verification is not available yet.',503);
 // Persistent, atomic per-phone cooldown also limits attempts across app restarts/IPs.
 const claimed=await prisma.$executeRaw`INSERT INTO "SmsThrottle" ("phone","sentAt") VALUES (${phone},NOW()) ON CONFLICT ("phone") DO UPDATE SET "sentAt"=NOW() WHERE "SmsThrottle"."sentAt" < NOW()-INTERVAL '60 seconds'`;
 if(!claimed)throw failure('Please wait one minute before requesting another code.',429);
 await twilio('Verifications',{To:phone,Channel:'sms'});
}
export async function checkCode(phone:string,code:string){
 const result=await twilio('VerificationCheck',{To:phone,Code:code});
 if(result.status!=='approved')throw failure('That verification code is not correct.');
}
