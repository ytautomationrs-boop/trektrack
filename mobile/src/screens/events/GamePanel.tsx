import React,{useCallback,useRef,useState} from 'react';
import {View,Text,Pressable,StyleSheet,TextInput,Image,ActivityIndicator} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {colors,fonts,radii,spacing} from '../../theme/tokens';
import {updateSocialGame,type SocialEvent,inviteToSocialEvent} from '../../api/eventClient';
import {createSocialPost,getFriends,type PlayerSummary} from '../../api/socialClient';
import {elapsedGameMs,gameSummary,scoreChoices,scoreGame,type Game} from '../../games/scoring';
import {pickPhoto} from '../../lib/photos';
import {shareGame} from '../../lib/shareGame';
import {showAlert} from '../../lib/alert';
function Timer({game}:{game:Game}) {
 const [now,setNow]=useState(Date.now());
 useFocusEffect(useCallback(()=>{if(!game.runningSince)return;setNow(Date.now());const id=setInterval(()=>{if(typeof document==='undefined'||!document.hidden)setNow(Date.now());},1000);return()=>clearInterval(id);},[game.runningSince]));
 const total=Math.floor(elapsedGameMs(game,now)/1000);
 return <Text style={styles.timer}>{Math.floor(total/3600)>0?`${Math.floor(total/3600)}:`:''}{String(Math.floor(total/60)%60).padStart(2,'0')}:{String(total%60).padStart(2,'0')}</Text>;
}
export function GamePanel({event,onChange,onRefresh}:{event:SocialEvent;onChange:(event:SocialEvent)=>void;onRefresh:()=>Promise<void>}) {
 const [teams,setTeams]=useState<[string,string]>(['Team A','Team B']);const [bestOf,setBestOf]=useState<1|3|5>(3);
 const [busy,setBusy]=useState(false);const actionLock=useRef(false);const [photo,setPhoto]=useState<string|null>(null);const [friends,setFriends]=useState<PlayerSummary[]|null>(null);const [invited,setInvited]=useState<string[]>([]);const [posted,setPosted]=useState(false);
 const game=event.game;const score=game?scoreGame(event.sportKey,game):null;const choices=scoreChoices(event.sportKey);
 const action=async(action:'start'|'score'|'undo'|'pause'|'resume'|'finish',side?:0|1,value?:number)=>{
  if(actionLock.current)return;actionLock.current=true;setBusy(true);
  const operationId=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {const result=await updateSocialGame(event.id,{action,operationId,version:game?.version??0,teams,bestOf,side,value});onChange({...event,game:result.game,status:result.status});}
  catch(e:any){showAlert('Game',e.message??'Could not save. Your score has not been changed.');await onRefresh();}
  finally{actionLock.current=false;setBusy(false);}
 };
 const choosePhoto=async()=>{try{const next=await pickPhoto();if(next)setPhoto(next);}catch(e:any){showAlert('Photo',e.message);}};
 const finish=()=>showAlert('Finish game?','This saves the final score and stops the timer.',[{text:'Keep playing',style:'cancel'},{text:'Finish game',onPress:()=>void action('finish')}]);
 const publish=async()=>{if(!game||busy)return;setBusy(true);try{await createSocialPost({body:`${event.name}\n${gameSummary(event.sportKey,game)}\n${Math.floor(game.elapsedMs/60000)} minutes · ${event.sportName}`,eventId:event.id,imageUrl:photo});setPosted(true);showAlert('Posted','Your result is now on your ASTA feed.');}catch(e:any){showAlert('Could not post',e.message);}finally{setBusy(false);}};
 return <View style={styles.card}>
  <Text style={styles.heading}>{game?.finishedAt?'GAME SUMMARY':game?'LIVE GAME':'GAME DAY'}</Text>
  {!game && event.isHost ? <>
   <Text style={styles.body}>{event.participantCount<event.maxPlayers?'Start is available when all players have joined.':'All players are here. Name your teams, then start.'}</Text>
   <View style={styles.row}>{teams.map((team,i)=><TextInput key={i} accessibilityLabel={`Team ${i+1} name`} keyboardAppearance="dark" style={styles.input} value={team} maxLength={32} onChangeText={text=>setTeams(current=>i===0?[text,current[1]]:[current[0],text])}/>)}</View>
   {['tennis','padel','squash','volleyball'].includes(event.sportKey)?<><Text style={styles.body}>Best of</Text><View style={styles.row}>{([1,3,5] as const).map(n=><Pressable key={n} onPress={()=>setBestOf(n)} style={[styles.choice,bestOf===n&&styles.active]}><Text style={styles.white}>{n} sets</Text></Pressable>)}</View></>:null}
   <Pressable disabled={busy||event.participantCount<event.maxPlayers||teams.some(t=>!t.trim())} onPress={()=>action('start')} style={[styles.button,(event.participantCount<event.maxPlayers||busy)&&styles.disabled]}><Text style={styles.white}>Start Game</Text></Pressable>
  </> : null}
  {!game&&!event.isHost?<Text style={styles.body}>The host can start once the game is full.</Text>:null}
  {game&&score?<>
   <Timer game={game}/>
   {game.finishedAt?<Text style={styles.body}>{gameSummary(event.sportKey,game)}</Text>:null}
   {choices.length?<View style={styles.row}>{([0,1] as const).map(side=><View key={side} style={styles.team}>
    <Text style={styles.teamName}>{game.teams[side]}</Text>
    <Text style={styles.score}>{score.display[side]}</Text>
    {score.setSport?<Text style={styles.body}>{score.sets[side]} sets{score.racket?` · ${score.games[side]} games`:''}</Text>:null}
    {event.isHost&&!game.finishedAt?choices.map((c,i)=><Pressable key={i} disabled={busy||!game.runningSince||score.winner!==null} style={[styles.button,(busy||!game.runningSince||score.winner!==null)&&styles.disabled]} onPress={()=>action('score',side,c.value)}><Text style={styles.white}>+{c.value} {c.label}</Text></Pressable>):null}
   </View>)}</View>:<Text style={styles.body}>Time-based activity — no points.</Text>}
   {score.completedSets.length?<Text style={styles.body}>Sets: {score.completedSets.map(s=>s.join('–')).join(' · ')}</Text>:null}
   {score.winner!==null?<Text style={styles.teamName}>{game.teams[score.winner]} won the match</Text>:null}
   {event.isHost&&!game.finishedAt?<>
    <View style={styles.row}><Pressable style={styles.choice} disabled={busy} onPress={()=>action(game.runningSince?'pause':'resume')}><Text style={styles.white}>{game.runningSince?'Pause timer':'Resume timer'}</Text></Pressable><Pressable style={styles.choice} disabled={busy||!game.actions.length} onPress={()=>action('undo')}><Text style={styles.white}>Undo point</Text></Pressable></View>
    <Pressable style={styles.button} disabled={busy} onPress={finish}><Text style={styles.white}>Finish game</Text></Pressable>
   </>:null}
   {game.finishedAt&&event.hasJoined?<>
    {photo?<Image source={{uri:photo}} style={styles.photo}/>:null}
    <Pressable style={styles.choice} disabled={busy} onPress={choosePhoto}><Text style={styles.white}>{photo?'Change photo':'Add a photo'}</Text></Pressable>
    <View style={styles.row}><Pressable style={styles.button} disabled={busy||posted} onPress={publish}><Text style={styles.white}>{posted?'Posted to ASTA':'Post to ASTA'}</Text></Pressable><Pressable style={styles.button} disabled={busy} onPress={async()=>{setBusy(true);try{await shareGame(event,photo);}catch(e:any){if(!/cancel|abort/i.test(e.message))showAlert('Share',e.message);}finally{setBusy(false);}}}><Text style={styles.white}>Share result</Text></Pressable></View>
    <Text style={styles.body}>Share the result card to Instagram, WhatsApp, Facebook or another installed app.</Text>
   </>:null}
  </>:null}
  {busy?<ActivityIndicator color={colors.accent}/>:null}
  {event.hasJoined&&event.status==='UPCOMING'?<><Pressable style={styles.choice} onPress={async()=>{try{setFriends((await getFriends()).friends);}catch(e:any){showAlert('Invites',e.message);}}}><Text style={styles.white}>Invite friends</Text></Pressable>
  {friends?.filter(p=>!event.participants.some(e=>e.userId===p.id)).map(p=><Pressable key={p.id} style={styles.invite} disabled={invited.includes(p.id)} onPress={async()=>{setInvited(v=>[...v,p.id]);try{await inviteToSocialEvent(event.id,p.id);}catch(e:any){setInvited(v=>v.filter(id=>id!==p.id));showAlert('Invite',e.message);}}}><Text style={styles.body}>{p.displayName}</Text><Text style={styles.white}>{invited.includes(p.id)?'Invited':'Invite'}</Text></Pressable>)}
  {friends?.length===0?<Text style={styles.body}>Follow a player to invite them, or use Share event.</Text>:null}</>:null}
 </View>;
}
const styles=StyleSheet.create({card:{backgroundColor:colors.surface,padding:16,borderRadius:radii.lg,gap:14,marginTop:16},heading:{fontFamily:fonts.display,textTransform:'uppercase',fontSize:24,color:colors.text},body:{fontFamily:fonts.body,fontSize:13,color:colors.sub,lineHeight:20},row:{flexDirection:'row',gap:10},team:{flex:1,gap:8,alignItems:'stretch'},teamName:{fontFamily:fonts.bodyBold,fontSize:15,color:colors.text,textAlign:'center'},score:{fontFamily:fonts.bodyBold,fontSize:40,color:colors.text,textAlign:'center'},timer:{fontFamily:fonts.bodyBold,fontSize:32,color:colors.text,textAlign:'center',fontVariant:['tabular-nums']},input:{flex:1,minWidth:0,backgroundColor:colors.surfaceRaised,color:colors.text,borderRadius:10,padding:10,fontFamily:fonts.body,fontSize:16},button:{flexGrow:1,backgroundColor:colors.accent,borderRadius:12,padding:12,minHeight:44,justifyContent:'center'},choice:{flexGrow:1,backgroundColor:colors.surfaceRaised,borderRadius:12,padding:12},active:{backgroundColor:colors.accent},white:{fontFamily:fonts.bodyBold,fontSize:13,color:colors.onAccent,textAlign:'center'},disabled:{opacity:0.4},photo:{width:'100%',height:220,borderRadius:12},invite:{flexDirection:'row',justifyContent:'space-between',paddingVertical:10}});
