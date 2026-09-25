import { Platform } from 'react-native';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { registerPushToken, deregisterPushToken } from '../api/client';
import { getToken } from '../lib/tokenStorage';
let cachedToken: string | null = null;
let handles: PluginListenerHandle[] = [];
let registering: Promise<unknown> | null = null;
let generation=0;
export function registerForPushNotifications(askPermission=false): Promise<any> {
 if(registering)return registering;
 registering=register(askPermission).finally(()=>{registering=null;});return registering;
}
async function register(askPermission:boolean) {
 if(Capacitor.isNativePlatform()) {
  if(Capacitor.getPlatform()!=='ios')return {status:'unsupported'};
  const {PushNotifications}=await import('@capacitor/push-notifications');
  let permissions=await PushNotifications.checkPermissions();
  if(permissions.receive==='prompt' && askPermission)permissions=await PushNotifications.requestPermissions();
  if(permissions.receive!=='granted')return {status:permissions.receive};
  const current=++generation;const session=await getToken();
  await Promise.all(handles.map(h=>h.remove()));handles=[];
  let resolveRegistration!:(value:any)=>void, rejectRegistration!:(reason:any)=>void;
  const registered=new Promise((resolve,reject)=>{resolveRegistration=resolve;rejectRegistration=reject;});
  const timer=setTimeout(()=>rejectRegistration(new Error('Phone notification registration timed out')),10000);
  handles.push(await PushNotifications.addListener('registrationError',error=>{clearTimeout(timer);rejectRegistration(error);}));
  handles.push(await PushNotifications.addListener('registration',async({value})=>{
   if(current!==generation || session!==await getToken()){clearTimeout(timer);resolveRegistration({status:'cancelled'});return;}
   try {await registerPushToken(`apns:${value}`,'IOS');cachedToken=`apns:${value}`;resolveRegistration({status:'registered'});} catch(error){rejectRegistration(error);} finally {clearTimeout(timer);}
  }));
  handles.push(await PushNotifications.addListener('pushNotificationReceived',()=>window.dispatchEvent(new Event('asta-notifications'))));
  handles.push(await PushNotifications.addListener('pushNotificationActionPerformed',({notification})=>{
   window.dispatchEvent(new CustomEvent('asta-open-notification',{detail:notification.data}));
  }));
  void PushNotifications.register().catch(error=>{clearTimeout(timer);rejectRegistration(error);});return registered;
 }
 if(Platform.OS==='web')return {status:'unsupported'};
 const Notifications=await import('expo-notifications');
 const {default:Constants}=await import('expo-constants');
 let permission=await Notifications.getPermissionsAsync();
 if(!permission.granted && permission.canAskAgain && askPermission)permission=await Notifications.requestPermissionsAsync();
 if(!permission.granted)return {status:'denied'};
 Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowAlert:true,shouldPlaySound:false,shouldSetBadge:false})});
 const session=await getToken(), current=++generation;
 const projectId=Constants.expoConfig?.extra?.eas?.projectId;
 const {data:token}=await Notifications.getExpoPushTokenAsync(projectId?{projectId}:undefined);
 if(current!==generation||session!==await getToken())return {status:'cancelled'};
 await registerPushToken(token,Platform.OS==='ios'?'IOS':'ANDROID');cachedToken=token;
 return {status:'registered'};
}
export async function unregisterForPushNotifications() {
 generation++;
 const pending=cachedToken?deregisterPushToken(cachedToken).catch(()=>{}):Promise.resolve();cachedToken=null;
 await Promise.all(handles.map(h=>h.remove()));handles=[];
 await pending;
}
