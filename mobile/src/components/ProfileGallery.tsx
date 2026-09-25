import React,{useCallback,useRef,useState} from 'react';
import {View,Text,Pressable,Image,StyleSheet,ActivityIndicator} from 'react-native';
import {useFocusEffect,useNavigation} from '@react-navigation/native';
import {getProfileGallery,type ProfileGalleryData} from '../api/socialClient';
import {colors,fonts} from '../theme/tokens';
export function ProfileGallery({playerId}:{playerId:string}) {
 const navigation=useNavigation<any>();const [data,setData]=useState<ProfileGalleryData|null>(null);const [tab,setTab]=useState<'posts'|'games'>('posts');const [error,setError]=useState('');
 const generation=useRef(0);
 const load=useCallback(()=>{const current=++generation.current;void getProfileGallery(playerId,{onCached:value=>{if(current===generation.current)setData(value);}}).then(value=>{if(current===generation.current){setData(value);setError('');}}).catch(()=>{if(current===generation.current)setError('Could not load this gallery. Tap to retry.');});},[playerId]);
 useFocusEffect(useCallback(()=>{setData(null);load();return()=>{generation.current++;};},[load]));
 return <View style={styles.section}>
 <View style={styles.tabs}>{(['posts','games'] as const).map(key=><Pressable key={key} onPress={()=>setTab(key)} style={[styles.tab,tab===key&&styles.active]}><Text style={styles.heading}>{key==='posts'?'Posts':'Games'}{data?` (${data[key].length})`:''}</Text></Pressable>)}</View>
 {error?<Pressable onPress={load}><Text style={styles.body}>{error}</Text></Pressable>:null}
 {!data&&!error?<ActivityIndicator color={colors.accent}/>:null}
 <View style={styles.grid}>
 {tab==='posts'?data?.posts.map(post=><Pressable accessibilityLabel={`Open post: ${post.body.slice(0,50)}`} key={post.id} style={styles.tile} onPress={()=>navigation.navigate('Social',{screen:'SocialPost',params:{postId:post.id}})}>{post.imageUrl?<Image source={{uri:post.imageUrl}} style={StyleSheet.absoluteFillObject} resizeMode="cover"/>:<Text numberOfLines={4} style={styles.caption}>{post.body}</Text>}</Pressable>):data?.games.map(game=><Pressable accessibilityLabel={`Open game: ${game.name}`} key={game.id} style={styles.tile} onPress={()=>navigation.navigate('Events',{screen:'EventDetail',params:{eventId:game.id}})}><Text numberOfLines={2} style={styles.gameName}>{game.name}</Text><Text numberOfLines={3} style={styles.caption}>{game.summary}</Text></Pressable>)}
 </View>
 {data&&!data[tab].length?<Text style={styles.body}>{tab==='posts'?'Your posts will appear here.':'Completed games appear here automatically.'}</Text>:null}
 </View>;
}
const styles=StyleSheet.create({section:{marginVertical:16},tabs:{flexDirection:'row',marginBottom:8},tab:{flex:1,paddingVertical:12,alignItems:'center',borderBottomWidth:2,borderBottomColor:colors.line},active:{borderBottomColor:colors.accent},heading:{fontFamily:fonts.display,fontSize:16,color:colors.text},grid:{flexDirection:'row',flexWrap:'wrap',gap:3},tile:{width:'32.7%',aspectRatio:1,backgroundColor:colors.surfaceRaised,overflow:'hidden',padding:8,justifyContent:'center'},caption:{fontFamily:fonts.body,fontSize:11,lineHeight:15,color:colors.text},gameName:{fontFamily:fonts.bodySemiBold,fontSize:12,color:colors.text,marginBottom:5},body:{fontFamily:fonts.body,fontSize:13,color:colors.sub,marginVertical:12}});
