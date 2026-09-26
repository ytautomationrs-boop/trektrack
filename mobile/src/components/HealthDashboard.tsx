import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, AppState } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AppleHealth, hasAppleHealth, type HealthStatus } from '../lib/appleHealth';
import { getMyRaces } from '../api/raceClient';
import type { RaceHistoryEntry } from '../api/raceTypes';
import { request } from '../api/http';
import { colors, fonts, radii, spacing } from '../theme/tokens';

type Competition = { entryId:string; raceId:string; name:string; status:string; steps:number; position:number|null; participants:number; squad:boolean; windowEnded:boolean; syncClosesAt:string|null; lastSyncedAt:string|null };
export function HealthDashboard({ raceId }: {raceId?:string}) {
 const [expanded,setExpanded] = useState(false);
 const [entries,setEntries] = useState<RaceHistoryEntry[]>([]);
 const [entriesLoading,setEntriesLoading] = useState(false);
 const [entriesError,setEntriesError] = useState<string|null>(null);
 const available = hasAppleHealth();
 const navigation = useNavigation<any>();
 const [health,setHealth] = useState<HealthStatus>({available,enabled:false,syncing:false});
 const [races,setRaces] = useState<Competition[]>([]);
 const [error,setError] = useState<string|null>(null);
 const [busy,setBusy] = useState(false);
 const mounted = useRef(true);
 useEffect(() => { mounted.current=true; return()=>{mounted.current=false}; },[]);
 const load = useCallback(async () => {
   if (!available) return;
   try { const data=await request<{competitions:Competition[]}>('/health/competitions',{cacheMode:'reload'}); if(mounted.current){setRaces(data.competitions);setError(null);} }
   catch(e:any){if(mounted.current)setError(e.message??'Could not refresh your position.');}
 },[available]);
 useEffect(()=>{
   if(!available)return;
   let disposed=false; let remove:(()=>Promise<void>)|undefined;
   void AppleHealth.status().then(s=>{if(!disposed)setHealth(s)}).catch(()=>{});
   void AppleHealth.addListener('changed',s=>{if(!disposed){setHealth(s);if(!s.syncing)void load();}}).then(h=>{if(disposed)void h.remove();else remove=()=>h.remove();});
   return()=>{disposed=true;void remove?.()};
 },[available,load]);
 useFocusEffect(useCallback(()=>{
   if(!available)return;
   void load();void AppleHealth.refresh().then(setHealth).catch(()=>{});
   const timer=setInterval(()=>{if(AppState.currentState==='active'){void AppleHealth.refresh().then(setHealth).catch(()=>{});}},60000);
   return()=>clearInterval(timer);
 },[available,load]));
 const action=async(kind:'connect'|'disconnect'|'refresh')=>{
   setBusy(true);setError(null);
   try{setHealth(await AppleHealth[kind]());await load();}catch(e:any){setError(e.message??'Apple Health could not connect.');}finally{setBusy(false);}
 };
 useEffect(()=>{
   if(!expanded)return;
   let active=true;setEntriesLoading(true);setEntriesError(null);
   getMyRaces().then(data=>{if(active)setEntries(data.entries)}).catch(()=>{if(active)setEntriesError("Could not load your races. Close and reopen to retry.")}).finally(()=>{if(active)setEntriesLoading(false)});
   return()=>{active=false};
 },[expanded]);
 return <View style={s.card}>
   <Pressable accessibilityRole="button" accessibilityLabel={`Your activity, ${health.todaySteps==null?"steps unavailable":health.todaySteps.toLocaleString()+" steps today"}, ${expanded?"hide":"show"} entered races`} accessibilityState={{expanded}} onPress={()=>setExpanded(v=>!v)} style={s.summary}>
     <View style={s.stepIcon}><Ionicons name="footsteps-outline" size={23} color={colors.text}/></View>
     <View style={{flex:1,gap:3}}><Text style={s.summaryLabel}>Your activity</Text><Text style={s.small}>Steps today · Your entered races</Text></View>
     <Text style={s.number}>{health.todaySteps==null?"—":health.todaySteps.toLocaleString()}</Text>
     <Ionicons name={expanded?"chevron-up":"chevron-down"} size={18} color={colors.sub}/>
   </Pressable>
   {expanded && <>
   <Text style={s.title}>Your entered races</Text>
   {entriesLoading && <Text style={s.small}>Loading races…</Text>}
   {!!entriesError && <Text accessibilityRole="alert" style={s.error}>{entriesError}</Text>}
   {entries.filter(e=>!races.some(r=>r.raceId===e.raceId)).map(e=><Pressable key={e.id} style={s.race} onPress={()=>navigation.navigate("RaceDetail",{raceId:e.raceId})}><View style={s.row}><Ionicons name="flag-outline" size={22} color={colors.risk}/><Text style={[s.title,{fontSize:15}]}>{e.race.name}</Text><Ionicons name="chevron-forward" size={18} color={colors.text}/></View><Text style={s.small}>{e.race.raceType.displayName} · {e.race.status.replace(/_/g," ").toLowerCase()}</Text></Pressable>)}
   {!available ? <Text style={s.small}>Connect Apple Health in ASTA on your iPhone to see steps here.</Text> : !health.enabled ? <>
     <Text style={s.body}>Connect your iPhone and Apple Watch steps to your competitions. Steps recorded during games count too.</Text>
     <Text style={s.small}>Read-only access to Steps. Only totals for competitions you join are sent to ASTA.</Text>
     <Pressable disabled={busy} style={s.button} onPress={()=>void action('connect')}><Text style={s.buttonText}>{busy?'Connecting…':'Connect Apple Health'}</Text></Pressable>
   </> : <>
     {races.filter(r=>!raceId||r.raceId===raceId).map(r=><Pressable key={r.entryId} style={s.race} onPress={()=>{if(!raceId)navigation.navigate('RaceDetail',{raceId:r.raceId});}}>
       <View style={s.row}><Ionicons name="trophy-outline" size={22} color={colors.risk}/><Text style={[s.title,{fontSize:15}]}>{r.name}</Text></View>
       <View style={s.row}><Text style={s.body}>{r.steps.toLocaleString()} race steps</Text><Text style={s.rank}>{r.position?`${r.squad?'Team ':''}#${r.position} / ${r.participants}`:r.status==='FILLING'?'Waiting for racers':'Starts soon'}</Text></View>
       {r.windowEnded&&<Text style={s.small}>Race ended · final step syncing until {r.syncClosesAt?new Date(r.syncClosesAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"results are confirmed"}. No steps after the finish count.</Text>}
       {!!r.position&&<Text style={s.small}>Provisional position · {r.lastSyncedAt?`Synced ${new Date(r.lastSyncedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'Not synced yet'}</Text>}
     </Pressable>)}
     {races.length===0&&entries.length===0&&!entriesLoading&&!entriesError&&<Text style={s.small}>Join a steps competition to see your race position here.</Text>}
     <Text style={s.small}>{health.syncing?'Syncing steps…':health.lastSyncedAt?`Last sync ${new Date(health.lastSyncedAt).toLocaleString()}`:'No successful sync yet'}. Background timing is managed by iOS.</Text>
     {!!health.message&&<Text style={s.small}>{health.message}</Text>}
     <View style={s.row}><Pressable disabled={busy||health.syncing} style={s.button} onPress={()=>void action('refresh')}><Text style={s.buttonText}>Sync now</Text></Pressable><Pressable disabled={busy} onPress={()=>void action('disconnect')}><Text style={s.link}>Disconnect</Text></Pressable></View>
   </>}
   </>}
   {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
 </View>;
}
const s=StyleSheet.create({card:{padding:12,borderRadius:14,backgroundColor:colors.surfaceRaised,gap:12,marginBottom:10},summary:{minHeight:48,flexDirection:"row",alignItems:"center",gap:10,flexWrap:"wrap"},stepIcon:{width:36,height:36,borderRadius:10,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center"},summaryLabel:{fontFamily:fonts.bodySemiBold,fontSize:14,color:colors.text},row:{flexDirection:'row',alignItems:'center',gap:10,flexWrap:'wrap'},title:{fontFamily:fonts.display,fontSize:19,color:colors.text,flex:1},badge:{fontFamily:fonts.bodyMedium,fontSize:12,color:colors.sub},body:{fontFamily:fonts.body,fontSize:15,color:colors.text},small:{fontFamily:fonts.body,fontSize:12,color:colors.sub,lineHeight:18},number:{fontFamily:fonts.display,fontSize:24,color:colors.text},track:{height:8,borderRadius:4,backgroundColor:colors.line,overflow:'hidden'},fill:{height:8,backgroundColor:colors.sage,borderRadius:4},button:{backgroundColor:colors.accent,paddingHorizontal:18,paddingVertical:13,borderRadius:radii.md,alignItems:'center'},buttonText:{fontFamily:fonts.bodyBold,color:'#ffffff',fontSize:15},link:{fontFamily:fonts.bodySemiBold,color:colors.text,paddingVertical:10},race:{padding:14,borderRadius:radii.md,backgroundColor:colors.surface,gap:8},rank:{fontFamily:fonts.bodyBold,color:colors.risk,marginLeft:'auto'},input:{fontSize:16,color:colors.text,borderWidth:1,borderColor:colors.line,padding:12,borderRadius:8,minWidth:100},error:{fontFamily:fonts.body,color:colors.fail,fontSize:13}});
