import React,{useState} from 'react';
import {View,Text,Pressable,StyleSheet} from 'react-native';
import {Capacitor} from '@capacitor/core';
import {registerForPushNotifications} from '../notifications/register';
import {colors,fonts} from '../theme/tokens';
export function PermissionChoices(){
 const [status,setStatus]=useState<Record<string,string>>({});
 async function ask(kind:'notifications'|'camera'|'photos'){
  try{
   if(kind==='notifications'){
    const result=await registerForPushNotifications(true);
    setStatus(s=>({...s,[kind]:result?.status==='registered'?'Enabled':'You can enable alerts in phone Settings.'}));
   }else{
    const {Camera}=await import('@capacitor/camera');
    const result=await Camera.requestPermissions({permissions:[kind]});
    setStatus(s=>({...s,[kind]:result[kind]==='granted'||result[kind]==='limited'?'Enabled':'You can change access in phone Settings.'}));
   }
  }catch(error:any){setStatus(s=>({...s,[kind]:error.message ?? 'Could not request permission.'}));}
 }
 return <View style={s.wrap}><Text style={s.heading}>Make ASTA yours</Text><Text style={s.note}>Choose what to allow. You can continue now and change these permissions later. Calendar and activity access are requested when you use those features.</Text>{(['notifications',...(Capacitor.isNativePlatform()?['camera','photos']:[])] as ('notifications'|'camera'|'photos')[]).map(kind=><View key={kind}><Pressable style={s.button} onPress={()=>void ask(kind)} accessibilityRole="button"><Text style={s.label}>{kind==='notifications'?'Enable phone notifications':kind==='camera'?'Allow camera':'Allow photo library'}</Text></Pressable>{status[kind]?<Text accessibilityLiveRegion="polite" style={s.note}>{status[kind]}</Text>:null}</View>)}</View>;
}
const s=StyleSheet.create({wrap:{gap:12},heading:{fontFamily:fonts.display,fontSize:20,color:colors.text},note:{fontFamily:fonts.body,fontSize:14,color:colors.sub,lineHeight:21},button:{padding:14,borderRadius:12,backgroundColor:colors.accent},label:{fontFamily:fonts.bodySemiBold,color:colors.onAccent,fontSize:16,textAlign:'center'}});
