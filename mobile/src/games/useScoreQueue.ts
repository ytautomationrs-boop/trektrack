import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {ScoreQueue,type Point} from './scoreQueue';
import type {Game} from './scoring';
import {updateSocialGame} from '../api/eventClient';
import {AppStateMachine} from '../state/AppStateMachine';
const queues=new Map<string,ScoreQueue>();
export function useScoreQueue(eventId:string,game:Game|null){
 const owner=AppStateMachine.session?.userId;
 const queue=useMemo(()=>{
  if(!game||!owner)return null;
  const key=`asta-points:${owner}:${eventId}`;let q=queues.get(key);if(q)return q;
  let pending:Point[]=[];try{pending=JSON.parse(localStorage.getItem(key)??'[]');if(!Array.isArray(pending))pending=[];}catch{}
  q=new ScoreQueue(game,pending,async(point,version)=>{
   if(AppStateMachine.session?.userId!==owner)throw new Error('Sign in to the original account to save these points.');
   return (await updateSocialGame(eventId,{action:'score',version,...point})).game;
  },points=>{try{if(points.length)localStorage.setItem(key,JSON.stringify(points));else localStorage.removeItem(key);}catch{}});queues.set(key,q);return q;
 },[eventId,owner,Boolean(game)]);
 const snapshot=useSyncExternalStore(queue?.subscribe??(()=>()=>{}),()=>queue?.snapshot??null);
 useEffect(()=>{if(game)queue?.reconcile(game);},[queue,game]);
 useEffect(()=>{queue?.retry();const retry=()=>queue?.retry();if(typeof window!=='undefined')window.addEventListener('online',retry);return()=>{if(typeof window!=='undefined')window.removeEventListener('online',retry);};},[queue]);
 return {queue,game:queue?.preview()??game,pending:snapshot?.pending.length??0,error:snapshot?.error??''};
}
