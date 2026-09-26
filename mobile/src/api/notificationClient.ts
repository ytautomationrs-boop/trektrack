import { request, type ReadOptions } from './http';
export type AppNotification = {id:string;kind:string;title:string;body:string;data:Record<string,string>;createdAt:string;readAt:string|null};
export type Inbox = {notifications:AppNotification[];unreadCount:number;pushAvailable:boolean};
export const getNotifications = (options?:ReadOptions<Inbox>)=>request<Inbox>('/notifications',{cacheMode:'reload',...options});
export const readNotifications=(ids:string[])=>request('/notifications/read',{method:'POST',body:JSON.stringify({ids})});
export function openNotification(navigation:any,data:Record<string,string>) {
 if(data.eventId)navigation.navigate('Events',{screen:'EventDetail',params:{eventId:data.eventId,code:data.code}});
 else if(data.raceId)navigation.navigate('Competitions',{screen:'RaceDetail',params:{raceId:data.raceId},initial:false});
 else if(data.playerId)navigation.navigate('Social',{screen:'SocialThread',params:{playerId:data.playerId}});
 else if(data.postId)navigation.navigate('Social',{screen:'SocialPost',params:{postId:data.postId}});
 else navigation.navigate('Social');
}

export const testPhoneNotification=()=>request<{accepted:number}>('/notifications/test',{method:'POST',body:'{}'});
