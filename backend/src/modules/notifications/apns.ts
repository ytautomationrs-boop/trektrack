import { connect } from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';
let cachedJwt = {value:'',until:0};
export function apnsConfigured() { return Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY); }
function authorization() {
 if(cachedJwt.until>Date.now())return cachedJwt.value;
 const head=Buffer.from(JSON.stringify({alg:'ES256',kid:process.env.APNS_KEY_ID})).toString('base64url');
 const body=Buffer.from(JSON.stringify({iss:process.env.APNS_TEAM_ID,iat:Math.floor(Date.now()/1000)})).toString('base64url');
 const value=`${head}.${body}`;
 const signature=sign('sha256',Buffer.from(value),{key:createPrivateKey(process.env.APNS_PRIVATE_KEY!.replace(/\\n/g,'\n')),dsaEncoding:'ieee-p1363'}).toString('base64url');
 cachedJwt={value:`${value}.${signature}`,until:Date.now()+45*60*1000};return cachedJwt.value;
}
async function send(token:string,payload:object,sandbox:boolean):Promise<{status:number;reason?:string}> {
 const auth=authorization();
 const session=connect(sandbox?'https://api.sandbox.push.apple.com':'https://api.push.apple.com');
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{session.destroy();reject(new Error('APNs timed out'));},8000);
  session.on('error',error=>{clearTimeout(timer);session.destroy();reject(error);});
  const req=session.request({':method':'POST',':path':`/3/device/${token}`,authorization:`bearer ${auth}`,'apns-topic':process.env.APNS_BUNDLE_ID||'com.asta.app','apns-push-type':'alert','apns-priority':'10'});
  let status=0,body='';req.on('response',headers=>{status=Number(headers[':status']);});req.on('data',chunk=>body+=chunk);req.on('error',error=>{clearTimeout(timer);session.destroy();reject(error);});
  req.on('end',()=>{clearTimeout(timer);session.close();let reason;try{reason=JSON.parse(body).reason;}catch{} resolve({status,reason});});req.end(JSON.stringify(payload));
 });
}
export async function sendApplePush(token:string,title:string,body:string,data:Record<string,string>) {
 if(!apnsConfigured())return;
 const payload={aps:{alert:{title,body},sound:'default'},...data};
 let result=await send(token,payload,process.env.APNS_ENVIRONMENT==='sandbox');
 // Xcode and TestFlight issue different tokens. Try the other Apple endpoint only for a wrong environment.
 if(result.reason==='BadDeviceToken')result=await send(token,payload,process.env.APNS_ENVIRONMENT!=='sandbox');
 if(result.status!==200)throw new Error(`APNs ${result.status}: ${result.reason ?? 'delivery failed'}`);
}
