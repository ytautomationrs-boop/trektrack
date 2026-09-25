import type {SocialEvent} from '../api/eventClient';
import {scoreGame,scoreChoices} from '../games/scoring';
import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
export type WatchScoreUpdate={eventId:string;game:NonNullable<SocialEvent['game']>;status:SocialEvent['status']};
const Watch=registerPlugin<{addListener(name:'scoreChanged',listener:(update:WatchScoreUpdate)=>void):Promise<PluginListenerHandle>;setSession(options:{token:string|null}):Promise<void>;refresh():Promise<void>;publishGame(options:{event:unknown}):Promise<void>}>('ASTAWatch');
export async function syncWatchSession(token:string|null){if(Capacitor.isPluginAvailable('ASTAWatch'))try{await Watch.setSession({token});}catch{/* Watch setup never blocks the phone. */}}
export async function refreshWatch(){if(Capacitor.isPluginAvailable('ASTAWatch'))try{await Watch.refresh();}catch{}}

export async function publishWatchGame(event:SocialEvent){
 if(!event.game||!Capacitor.isPluginAvailable('ASTAWatch'))return;
 const {actions,operationIds,...game}=event.game;
 try{await Watch.publishGame({event:{id:event.id,name:event.name,sportKey:event.sportKey,status:event.status,game,score:scoreGame(event.sportKey,event.game),choices:scoreChoices(event.sportKey)}});}catch{}
}

export async function listenWatchScores(listener:(update:WatchScoreUpdate)=>void){if(Capacitor.isPluginAvailable('ASTAWatch'))return Watch.addListener('scoreChanged',listener);return null;}
