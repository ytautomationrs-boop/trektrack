import React,{useEffect,useState} from 'react';
import {View,Text,Pressable,StyleSheet} from 'react-native';
import {useRoute} from '@react-navigation/native';
import {colors,fonts} from '../../theme/tokens';
import {PoolList} from '../pools/PoolsScreen';
import {RacesScreen} from '../races/RacesScreen';
import {EventsScreen} from '../events/EventsScreen';
export const playSections=['Pools','Competitions','Events'] as const;
export function PlayScreen(){
 const route=useRoute<any>();
 const initial=route.params?.section??(route.name==='RacesList'?'Competitions':route.name==='EventsHome'?'Events':'Pools');
 const [selected,setSelected]=useState<string>(initial);
 useEffect(()=>setSelected(initial),[initial]);
 return <View style={s.screen}><View style={s.selector} accessibilityRole="tablist">{playSections.map(section=><Pressable key={section} accessibilityRole="tab" accessibilityState={{selected:selected===section}} onPress={()=>setSelected(section)} style={[s.tab,selected===section&&s.active]}><Text style={[s.label,selected===section&&s.activeLabel]}>{section}</Text></Pressable>)}</View><View style={{flex:1}}>{selected==='Pools'?<PoolList/>:selected==='Competitions'?<RacesScreen/>:<EventsScreen/>}</View></View>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:colors.bg},selector:{flexDirection:'row',padding:5,marginHorizontal:16,marginTop:12,marginBottom:4,backgroundColor:colors.surface,borderRadius:15},tab:{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:11},active:{backgroundColor:colors.accent},label:{fontFamily:fonts.bodySemiBold,fontSize:13,color:colors.sub},activeLabel:{color:'#fff'}});
