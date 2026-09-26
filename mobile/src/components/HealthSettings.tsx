import React,{useCallback,useEffect,useState} from 'react';
import {View,Text,Switch,Pressable,StyleSheet,AppState} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {AppleHealth,hasAppleHealth,type HealthStatus} from '../lib/appleHealth';
import {colors,fonts} from '../theme/tokens';
export function HealthSettings(){
 const [status,setStatus]=useState<HealthStatus>();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const load=useCallback(()=>{if(hasAppleHealth())void AppleHealth.status().then(setStatus).catch(()=>{});},[]);
 useFocusEffect(useCallback(()=>{load();},[load]));
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>{if(s==='active')load();});return()=>sub.remove();},[load]);
 const change=async(value:boolean)=>{setBusy(true);setError('');try{setStatus(await (value?AppleHealth.connect():AppleHealth.disconnect()));}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <View><View style={s.row}><Ionicons name="heart" color={colors.accent} size={22}/><Text style={s.label}>Sync to Apple Health</Text><Switch accessibilityLabel="Sync to Apple Health" value={!!status?.enabled} disabled={busy||!hasAppleHealth()} onValueChange={v=>void change(v)} trackColor={{true:colors.accent,false:colors.line}}/></View>{status?.enabled?<View style={s.row}><Text style={s.note}>{status.lastSyncedAt?`Updated ${new Date(status.lastSyncedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'Automatic sync is on'}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setBusy(true);void AppleHealth.refresh().then(setStatus).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}><Text style={s.link}>{busy?'Syncing…':'Sync now'}</Text></Pressable></View>:null}{!hasAppleHealth()?<Text style={s.note}>Available in the iPhone app.</Text>:null}{error?<Text accessibilityRole="alert" style={s.note}>{error}</Text>:null}</View>;
}
const s=StyleSheet.create({row:{minHeight:52,flexDirection:'row',alignItems:'center',gap:12},label:{flex:1,fontFamily:fonts.bodyMedium,fontSize:15,color:colors.text},note:{flex:1,fontFamily:fonts.body,fontSize:12,color:colors.sub,lineHeight:18},link:{fontFamily:fonts.bodySemiBold,fontSize:13,color:colors.text,padding:8}});
