import {Capacitor,registerPlugin} from '@capacitor/core';
import {request,clearApiCache} from './http';
import {setToken,setStoredSession} from '../lib/tokenStorage';
export type Provider='apple'|'google';
export type ProviderConfig={apple:boolean;google:boolean;googleWebClientId:string|null;googleIosClientId:string|null};
const NativeAuth=registerPlugin<{apple(options:{nonce:string}):Promise<{identityToken:string;authorizationCode?:string}>;google(options:{nonce:string;clientId:string;serverClientId:string}):Promise<{identityToken:string}>}>('ASTAAuth');
export async function providerCredential(provider:Provider,config:ProviderConfig){
 const challenge=await request<{id:string;nonce:string}>('/auth/provider/challenge',{method:'POST',body:JSON.stringify({provider})});
 if(!Capacitor.isNativePlatform())throw new Error('Use the ASTA iPhone app for this sign-in option.');
 const result=provider==='apple'?await NativeAuth.apple({nonce:challenge.nonce}):await NativeAuth.google({nonce:challenge.nonce,clientId:config.googleIosClientId!,serverClientId:config.googleWebClientId!});
 return {...result,provider,challengeId:challenge.id};
}
export async function acceptProviderSession(data:any){
 clearApiCache();await setToken(data.token);
 const user=data.user,session={userId:user.id,displayName:user.displayName,email:user.email,avatarUrl:user.avatarUrl??null,coverUrl:user.coverUrl??null,bio:user.bio??null,isAdmin:user.isAdmin};
 setStoredSession(session);return session;
}
export async function signInProvider(provider:Provider,config:ProviderConfig){
 const credential=await providerCredential(provider,config);
 return request<any>('/auth/provider',{method:'POST',body:JSON.stringify(credential)});
}
