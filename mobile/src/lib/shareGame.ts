import { Capacitor } from '@capacitor/core';
import { shareCode } from './shareCode';
import type { SocialEvent } from '../api/eventClient';
import { gameSummary, type Game } from '../games/scoring';
export async function shareGame(event:SocialEvent, photo:string|null) {
 const game=event.game as Game;const summary=gameSummary(event.sportKey,game);
 const text=`${event.name}\n${summary}\n${Math.floor(game.elapsedMs/60000)} minutes · ${event.sportName}\nPlayed on ASTA`;
 if(typeof document==='undefined')return shareCode({message:text,title:'Game result',code:summary});
 // Render only when Share is tapped, never on startup or during live scoring.
 const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not create the result card.');
 try {
  ctx.fillStyle='#972541';ctx.fillRect(0,0,1080,1350);
  if(photo){const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Could not read the result photo.'));image.src=photo;});const scale=Math.max(1080/image.width,650/image.height);ctx.save();ctx.beginPath();ctx.rect(0,0,1080,650);ctx.clip();ctx.drawImage(image,(1080-image.width*scale)/2,0,image.width*scale,image.height*scale);ctx.restore();ctx.fillStyle='rgba(7,26,39,0.48)';ctx.fillRect(0,0,1080,650);}
  ctx.fillStyle='#fff';ctx.textAlign='center';
  // Font loading is optional here; the already-loaded heading face paints immediately.
  ctx.font='58px ASTAHeading, sans-serif';ctx.fillText('ASTA',540,130);
  ctx.font='bold 54px sans-serif';
  const fit=(value:string,y:number,size:number)=>{let px=size;ctx.font=`bold ${px}px sans-serif`;while(ctx.measureText(value).width>950&&px>20){px-=2;ctx.font=`bold ${px}px sans-serif`;}ctx.fillText(value,540,y);};
  fit(event.name.toUpperCase(),photo?760:430,56);fit(summary,photo?870:620,54);
  ctx.font='32px sans-serif';ctx.fillText(event.sportName,540,photo?965:730);ctx.fillText(`${Math.floor(game.elapsedMs/60000)} MIN · GAME COMPLETE`,540,photo?1030:800);
  ctx.font='28px sans-serif';ctx.fillText('PLAY. CONNECT. CELEBRATE.',540,1240);
  const data=canvas.toDataURL('image/jpeg',0.85);
  if(Capacitor.isNativePlatform()){
   const [{Filesystem,Directory},{Share}]=await Promise.all([import('@capacitor/filesystem'),import('@capacitor/share')]);
   const path=`asta-result-${event.id}-${Date.now()}.jpg`;
   const file=await Filesystem.writeFile({path,data:data.split(',')[1],directory:Directory.Cache});
   try{await Share.share({title:'ASTA game result',text,files:[file.uri],dialogTitle:'Share your game'});}finally{await Filesystem.deleteFile({path,directory:Directory.Cache}).catch(()=>{});}
  } else {
   const blob=await (await fetch(data)).blob();const file=new File([blob],'asta-game-result.jpg',{type:'image/jpeg'});
   if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:'ASTA game result',text});
   else {const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='asta-game-result.jpg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  }
 } finally {canvas.width=0;canvas.height=0;}
}
