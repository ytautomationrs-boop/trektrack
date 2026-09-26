import {providerCredential,type ProviderConfig,type Provider} from "../../api/providerClient";
import {PermissionChoices} from "../../components/PermissionChoices";
import {AdminRow,SupportAndLegalRows} from "./ProfileScreen";
import React,{useEffect,useState} from 'react';
import {ScrollView,View,Text,TextInput,Pressable,Switch,StyleSheet,ActivityIndicator,AppState} from 'react-native';
import {colors,fonts} from '../../theme/tokens';
import {request} from '../../api/http';
import {useAppState} from '../../state/useAppState';
import {showAlert} from '../../lib/alert';
import {registerForPushNotifications} from '../../notifications/register';
import {Capacitor} from '@capacitor/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import {HealthSettings} from '../../components/HealthSettings';
import {openSystemSettings} from '../../lib/appleHealth';
import {PageMotion} from '../../components/PageMotion';
type Preferences={push:boolean;messages:boolean;invites:boolean;likes:boolean;comments:boolean;competitions:boolean};
type Settings={hasPassword:boolean;authIdentities:{provider:Provider}[];email:string;phoneNumber:string|null;twoFactorEnabled:boolean;smsAvailable:boolean;notificationPreferences:Preferences};
const labels:Record<keyof Preferences,string>={push:'Push notifications',messages:'Direct messages',invites:'Invites and followers',likes:'Likes',comments:'Comments and shares',competitions:'Competitions and games'};
export function SettingsScreen(){
 const app=useAppState();
 const [notificationDetails,setNotificationDetails]=useState(false);
 const [phoneAllowed,setPhoneAllowed]=useState(!Capacitor.isNativePlatform());
 const [settings,setSettings]=useState<Settings|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[action,setAction]=useState<'password'|'email'|'enable2fa'|'disable2fa'|null>(null);
 const [password,setPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[code,setCode]=useState(''),[how,setHow]=useState(false),[sent,setSent]=useState(false);
 const [deleting,setDeleting]=useState(false),[confirmation,setConfirmation]=useState('');
 async function removeAccount(){setBusy(true);setError('');try{await request('/me/settings/delete-account',{method:'POST',body:JSON.stringify({password,reauthToken,code:code||undefined,confirmation})});await app.logout();}catch(e:any){setError(e.message);}finally{setReauthToken('');setBusy(false);}}
 const [reauthToken,setReauthToken]=useState('');
 async function verifyIdentity(){setBusy(true);setError('');try{
  const config=await request<ProviderConfig>('/auth/config');
  const provider=settings?.authIdentities[0]?.provider;
  if(!provider)throw new Error('Use your password to confirm.');
  const credential=await providerCredential(provider,config);
  const result=await request<{reauthToken:string}>('/auth/provider/reauth',{method:'POST',body:JSON.stringify(credential)});setReauthToken(result.reauthToken);
 }catch(error:any){setError(error.message);}finally{setBusy(false);}}
 const load=()=>{setError('');request<Settings>('/me/settings',{cacheMode:'reload'}).then(s=>{setSettings(s);setEmail(s.email);}).catch(e=>setError(e.message));};
 useEffect(load,[]);
 useEffect(()=>{const refresh=()=>{if(Capacitor.isNativePlatform())void import('@capacitor/push-notifications').then(({PushNotifications})=>PushNotifications.checkPermissions()).then(p=>setPhoneAllowed(p.receive==='granted')).catch(()=>{});};refresh();const sub=AppState.addEventListener('change',state=>{if(state==='active')refresh();});return()=>sub.remove();},[]);
 async function savePreference(key:keyof Preferences,value:boolean){
  if(!settings || busy)return;const previous=settings.notificationPreferences,next={...previous,[key]:value};
  setSettings({...settings,notificationPreferences:next});setBusy(true);
  try{if(key==='push'&&value&&Capacitor.isNativePlatform()){
   const permission=await registerForPushNotifications(true);
   if(permission?.status!=='registered'){setSettings(s=>s?{...s,notificationPreferences:previous}:s);await openSystemSettings();return;}
   setPhoneAllowed(true);
  }
  await request('/me/settings/notifications',{method:'PATCH',body:JSON.stringify(next)});}catch(e:any){setSettings(s=>s?{...s,notificationPreferences:previous}:s);showAlert('Not saved',e.message);}finally{setBusy(false);}
 }
 async function send(){setBusy(true);setError('');try{await request('/me/settings/send-code',{method:'POST',body:JSON.stringify({password,phoneNumber:phone||undefined})});setSent(true);}catch(e:any){setError(e.message);}finally{setReauthToken('');setBusy(false);}}
 async function save(){setBusy(true);setError('');try{await request('/me/settings/security',{method:'POST',body:JSON.stringify({action,password,reauthToken,newPassword:newPassword||undefined,email:email||undefined,phoneNumber:phone||undefined,code:code||undefined})});setPassword('');setNewPassword('');setCode('');app.logout();showAlert('Security updated','Please sign in again. Your other sessions have also been signed out.');}catch(e:any){setError(e.message);}finally{setReauthToken('');setBusy(false);}}
 function open(value:typeof action){setAction(value);setError('');setPassword('');setNewPassword('');setCode('');setSent(false);}
 const button=(label:string,onPress:()=>void,disabled=false)=><Pressable accessibilityRole="button" onPress={onPress} disabled={disabled||busy} style={({pressed})=>[s.button,{opacity:disabled||busy?0.5:pressed?0.8:1}]}><Text style={[s.buttonText,label.toLowerCase().includes('delete')&&{color:colors.fail}]}>{label}</Text><Ionicons name="chevron-forward" size={17} color={colors.sub}/></Pressable>;
 const input=(placeholder:string,value:string,onChangeText:(s:string)=>void,secure=false,keyboardType:any='default')=><TextInput accessibilityLabel={placeholder} style={s.input} placeholder={placeholder} placeholderTextColor={colors.sub} value={value} onChangeText={onChangeText} secureTextEntry={secure} keyboardType={keyboardType} keyboardAppearance="dark" autoCapitalize="none" autoCorrect={false} textContentType={keyboardType==='number-pad'?'oneTimeCode':secure?'password':'none'}/>;
 return <PageMotion><ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
  <Text style={s.title}>Settings</Text>
  {!settings && !error?<ActivityIndicator color={colors.accent}/>:null}
  {settings && <>
   <Text style={s.heading}>Notifications</Text><View style={s.card}>
    <View style={s.row}><Ionicons name="notifications-outline" size={21} color={colors.sub}/><Text style={[s.text,{flex:1}]}>Phone notifications</Text><Switch accessibilityLabel="Phone notifications" value={settings.notificationPreferences.push&&phoneAllowed} disabled={busy} onValueChange={v=>void savePreference('push',v)} trackColor={{true:colors.accent,false:colors.line}}/></View>
    {button('Notification preferences',()=>setNotificationDetails(v=>!v))}
    {notificationDetails?Object.entries(labels).filter(([key])=>key!=='push').map(([key,label])=><View key={key} style={s.row}><Text style={[s.text,{flex:1}]}>{label}</Text><Switch accessibilityLabel={label} value={settings.notificationPreferences[key as keyof Preferences]} disabled={busy} onValueChange={v=>void savePreference(key as keyof Preferences,v)} trackColor={{true:colors.accent,false:colors.line}}/></View>):null}
   </View>
   <Text style={s.heading}>Connected apps</Text><View style={s.card}><HealthSettings/></View>
   <Text style={s.heading}>App permissions</Text><View style={s.card}><PermissionChoices includeNotifications={false} heading={false}/></View>
   <Text style={s.heading}>Account and security</Text><View style={s.card}>
    <Text style={s.text}>{settings.email}</Text>
    {button('Change email',()=>open('email'))}{button('Change password',()=>open('password'))}
    {settings.twoFactorEnabled?<Text style={s.note}>Two-factor authentication is on · {settings.phoneNumber}</Text>:null}
    {settings.twoFactorEnabled?button('Turn off two-factor authentication',()=>open('disable2fa')):null}
    {action && <View style={s.form}><Text style={s.heading}>{action==='password'?'Change password':action==='email'?'Change email':action==='enable2fa'?'Verify your phone':'Turn off two-factor authentication'}</Text>
     {settings.hasPassword!==false?input('Current password',password,setPassword,true):button(reauthToken?'Identity verified':'Verify with '+(settings.authIdentities[0]?.provider==='apple'?'Apple':'Google'),()=>void verifyIdentity())}
     {action==='password' && input('New password (8+ characters)',newPassword,setNewPassword,true)}
     {action==='email' && input('New email address',email,setEmail,false,'email-address')}
     {action==='enable2fa' && input('Phone with country code, e.g. +27821234567',phone,setPhone,false,'phone-pad')}
     {(settings.twoFactorEnabled || action==='enable2fa') && <>{button(sent?'Send another code':'Send verification code',()=>void send(),!password)}{sent?<Text style={s.note}>Code sent. Wait one minute before requesting another.</Text>:null}{input('SMS verification code',code,setCode,false,'number-pad')}</>}
     <Text style={s.note}>Saving signs out all devices. Keep access to your phone when two-factor authentication is on.</Text>
     {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
     {button('Save and sign out',()=>void save(),(!password&&!reauthToken))}{button('Cancel',()=>open(null))}
    </View>}
   </View>
   <Text style={s.heading}>Help</Text><View style={s.card}>{button('How competitions work',()=>setHow(!how))}{how && ['Choose a sport metric and enter a solo race or a squad race.','Your entry fee is held in your wallet while the competition fills. You can leave for a refund before it fills.','When the required players have joined, the race locks and starts at the next local midnight. Entries are then final.','Sync your activities. Final positions determine the fixed prizes and sport-specific trophies.'].map((text,i)=><Text key={text} style={s.text}>{i+1}. {text}</Text>)}</View>
   <AdminRow/><SupportAndLegalRows/>
   {button('Sign out',()=>app.logout())}
   <View style={s.card}>{deleting?<Text style={s.note}>Permanently remove your profile, photos, posts, messages and account data. Withdraw any balance and settle open competitions or payments first.</Text>:null}
   {button(deleting?'Cancel deletion':'Delete my account',()=>{setDeleting(!deleting);setPassword('');setCode('');setConfirmation('');setError('');})}
   {deleting && <>{settings.hasPassword!==false?input('Current password',password,setPassword,true):button(reauthToken?'Identity verified':'Verify with '+(settings.authIdentities[0]?.provider==='apple'?'Apple':'Google'),()=>void verifyIdentity())}{settings.twoFactorEnabled?<>{button('Send verification code',()=>void send(),!password)}{input('SMS verification code',code,setCode,false,'number-pad')}</>:null}{input('Type DELETE to confirm',confirmation,setConfirmation)}{button('Permanently delete account',()=>void removeAccount(),confirmation!=='DELETE'||(!password&&!reauthToken))}</>}
   </View>
  </>}
  {!!error && !action && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{!settings && !!error?button('Try again',load):null}
 </ScrollView></PageMotion>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:colors.bg},content:{padding:16,paddingBottom:40,gap:10},title:{fontFamily:fonts.display,fontSize:26,color:colors.text},heading:{fontFamily:fonts.display,fontSize:13,color:colors.sub,marginTop:16,marginLeft:4},card:{backgroundColor:colors.surface,borderRadius:18,paddingHorizontal:16,paddingVertical:4,gap:0},row:{minHeight:56,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},text:{fontFamily:fonts.body,fontSize:15,color:colors.text,flexShrink:1},note:{fontFamily:fonts.body,fontSize:12,lineHeight:18,color:colors.sub},button:{minHeight:54,paddingVertical:13,flexDirection:'row',alignItems:'center',gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.line},buttonText:{flex:1,fontFamily:fonts.bodyMedium,fontSize:15,color:colors.text},input:{backgroundColor:colors.surfaceRaised,padding:14,borderRadius:12,fontFamily:fonts.body,fontSize:16,color:colors.text},form:{gap:12,paddingVertical:14},error:{color:colors.fail,fontFamily:fonts.body,fontSize:16}});
