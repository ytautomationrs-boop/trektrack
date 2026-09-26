import React,{useCallback,useEffect,useState} from 'react';
import {View,Text,Switch,StyleSheet,AppState} from 'react-native';
import {Capacitor} from '@capacitor/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import {registerForPushNotifications} from '../notifications/register';
import {openSystemSettings} from '../lib/appleHealth';
import {colors,fonts} from '../theme/tokens';
type Kind='notifications'|'camera'|'photos';
export function PermissionChoices({includeNotifications=true,heading=true}:{includeNotifications?:boolean;heading?:boolean}){
 const native=Capacitor.isNativePlatform();
 const [permissions,setPermissions]=useState<Record<string,boolean>>({});const [busy,setBusy]=useState<Kind|null>(null);const [error,setError]=useState('');
 const refresh=useCallback(async()=>{if(!native)return;try{const {Camera}=await import('@capacitor/camera');const p=await Camera.checkPermissions();const {PushNotifications}=await import('@capacitor/push-notifications');const n=await PushNotifications.checkPermissions();setPermissions({camera:p.camera==='granted',photos:p.photos==='granted'||p.photos==='limited',notifications:n.receive==='granted'});}catch{/* No permission prompt while reading current state. */}},[native]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});return()=>sub.remove();},[refresh]);
 async function change(kind:Kind,value:boolean){setBusy(kind);setError('');try{
   if(!value){await openSystemSettings();return;}
   if(kind==='notifications'){const r=await registerForPushNotifications(true);if(r?.status!=='registered')await openSystemSettings();}
   else{const {Camera}=await import('@capacitor/camera');const p=await Camera.requestPermissions({permissions:[kind]});if(p[kind]!=='granted'&&p[kind]!=='limited')await openSystemSettings();}
  }catch(e:any){setError(e.message??'Could not change access.');}finally{await refresh();setBusy(null);}
 }
 const kinds:Kind[]=includeNotifications?['notifications','camera','photos']:['camera','photos'];
 return <View style={s.wrap}>{heading?<Text style={s.heading}>Permissions</Text>:null}{kinds.map(kind=><View key={kind} style={s.row}><Ionicons name={kind==='notifications'?'notifications-outline':kind==='camera'?'camera-outline':'images-outline'} size={20} color={colors.sub}/><Text style={s.label}>{kind==='notifications'?'Phone notifications':kind==='camera'?'Camera':'Photo library'}</Text><Switch accessibilityLabel={kind==='notifications'?'Phone notifications':kind==='camera'?'Camera':'Photo library'} value={!!permissions[kind]} disabled={!native||busy!==null} onValueChange={v=>void change(kind,v)} trackColor={{true:colors.accent,false:colors.line}}/></View>)}{!native?<Text style={s.note}>Available in the iPhone app.</Text>:null}{error?<Text accessibilityRole="alert" style={s.note}>{error}</Text>:null}</View>;
}
const s=StyleSheet.create({wrap:{gap:0},heading:{fontFamily:fonts.display,fontSize:20,color:colors.text,marginBottom:8},row:{minHeight:58,flexDirection:'row',gap:12,alignItems:'center',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.line},note:{fontFamily:fonts.body,fontSize:12,color:colors.sub,lineHeight:18,marginTop:8},label:{flex:1,fontFamily:fonts.bodyMedium,color:colors.text,fontSize:15}});
