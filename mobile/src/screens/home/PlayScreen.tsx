import React from 'react';
import {ScrollView,View,Text,Pressable,StyleSheet} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {colors,fonts} from '../../theme/tokens';
import {PageMotion} from '../../components/PageMotion';
const features=[
 {title:'Pools',detail:'Daily goals. Shared rewards.',icon:'layers-outline',route:'Pools'},
 {title:'Competitions',detail:'Find your race. Climb the leaderboard.',icon:'trophy-outline',route:'RacesList'},
 {title:'Events',detail:'Get together. Play your favourite games.',icon:'calendar-outline',route:'EventsHome'},
] as const;
export function PlayScreen(){const navigation=useNavigation<any>();return <PageMotion><ScrollView contentContainerStyle={s.page}><Text style={s.title}>Play</Text><Text style={s.subtitle}>Find your next challenge.</Text>{features.map((f,i)=><Pressable key={f.route} accessibilityRole="button" accessibilityLabel={`Open ${f.title}`} onPress={()=>navigation.navigate(f.route)} style={({pressed})=>[s.bar,pressed&&{opacity:.8,transform:[{scale:.99}]}]}><View style={s.icon}><Ionicons name={f.icon} color={colors.text} size={29}/></View><View style={{flex:1,gap:7}}><Text style={s.name}>{f.title}</Text><Text style={s.subtitle}>{f.detail}</Text></View><Ionicons name="chevron-forward" size={21} color={colors.sub}/></Pressable>)}</ScrollView></PageMotion>}
const s=StyleSheet.create({page:{padding:20,gap:16,paddingBottom:40},title:{fontFamily:fonts.display,fontSize:30,color:colors.text},subtitle:{fontFamily:fonts.body,fontSize:14,lineHeight:21,color:colors.sub},bar:{minHeight:118,backgroundColor:colors.surface,borderRadius:22,padding:18,flexDirection:'row',gap:16,alignItems:'center',borderWidth:1,borderColor:colors.line},icon:{width:56,height:56,borderRadius:18,backgroundColor:colors.accent,alignItems:'center',justifyContent:'center'},name:{fontFamily:fonts.display,fontSize:22,color:colors.text}});
