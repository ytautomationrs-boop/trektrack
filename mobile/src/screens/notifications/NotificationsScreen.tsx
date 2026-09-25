import React,{useCallback,useState} from 'react';
import {ActivityIndicator,View,Text,ScrollView,Pressable,StyleSheet,RefreshControl} from 'react-native';
import {useFocusEffect,useNavigation} from '@react-navigation/native';
import {getNotifications,readNotifications,openNotification,type Inbox} from '../../api/notificationClient';
import {registerForPushNotifications} from '../../notifications/register';
import {colors,fonts,spacing,radii} from '../../theme/tokens';
import {showAlert} from '../../lib/alert';
export function NotificationsScreen() {
 const navigation=useNavigation<any>();const [inbox,setInbox]=useState<Inbox|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const load=useCallback(async()=>{try{const data=await getNotifications({onCached:setInbox});setInbox(data);setError('');}catch(e:any){setError(e.message);}finally{setLoading(false);}},[]);
 useFocusEffect(useCallback(()=>{void load();},[load]));
 const enable=async()=>{if(!inbox?.pushAvailable){showAlert("Phone alerts","Phone alerts are being set up. Your notifications are available in this inbox.");return;}try{const result=await registerForPushNotifications(true);showAlert('Notifications',result.status==='registered'?'Phone notifications enabled.':result.status==='denied'?'Allow notifications for ASTA in iPhone Settings.':'Notifications remain available in this inbox.');}catch{showAlert('Notifications','Could not register this phone. Your in-app inbox still works.');}};
 return <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>}>
  <Text style={styles.title}>NOTIFICATIONS</Text>
  <Pressable style={styles.button} onPress={enable}><Text style={styles.buttonText}>Enable phone notifications</Text></Pressable>
  {loading&&!inbox?<ActivityIndicator color={colors.accent}/>:null}
  {error?<Text style={styles.body}>{error}</Text>:null}
  {!loading&&!inbox?.notifications.length?<Text style={styles.body}>Invites, messages, likes and game updates will appear here.</Text>:null}
  {inbox?.unreadCount? <Pressable onPress={async()=>{try {await readNotifications(inbox.notifications.filter(n=>!n.readAt).map(n=>n.id));void load();} catch {showAlert("Notifications","Could not mark these as read. Please try again.");}}}><Text style={styles.body}>Mark shown notifications as read</Text></Pressable>:null}
  {inbox?.notifications.map(n=><Pressable key={n.id} style={[styles.row,!n.readAt&&styles.unread]} onPress={()=>{void readNotifications([n.id]).then(load).catch(()=>{});openNotification(navigation,n.data);}}>
   <Text style={styles.label}>{n.title}</Text><Text style={styles.body}>{n.body}</Text><Text style={styles.date}>{new Date(n.createdAt).toLocaleString()}</Text>
  </Pressable>)}
 </ScrollView>;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:colors.bg},content:{padding:spacing.lg,gap:spacing.md},title:{fontFamily:fonts.display,textTransform:'uppercase',fontSize:24,color:colors.text},body:{fontFamily:fonts.body,fontSize:14,color:colors.sub,lineHeight:21},label:{fontFamily:fonts.bodyBold,fontSize:15,color:colors.text},date:{fontFamily:fonts.body,fontSize:11,color:colors.sub,marginTop:8},row:{backgroundColor:colors.surface,borderRadius:radii.md,padding:16,borderLeftWidth:3,borderLeftColor:colors.surface},unread:{borderLeftColor:colors.accent},button:{backgroundColor:colors.accent,padding:14,borderRadius:radii.md},buttonText:{fontFamily:fonts.bodyBold,color:colors.onAccent,textAlign:'center'}});
