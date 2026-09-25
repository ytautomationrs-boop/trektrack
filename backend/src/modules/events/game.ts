import { prisma } from '../../lib/prisma.js';
import { Prisma, type SocialEvent } from '@prisma/client';
import { SocialEventError } from './service.js';
import { elapsedGameMs, scoreChoices, scoreGame, type Game, type Side } from './scoring.js';
import { notifyActivity } from '../notifications/inbox.js';

export type GameCommand = { action: 'start'|'score'|'undo'|'pause'|'resume'|'finish'; operationId: string; version: number; side?: Side; value?: number; teams?: [string,string]; bestOf?: 1|3|5 };
export async function updateGame(eventId: string, userId: string, command: GameCommand) {
 const result = await prisma.$transaction(async tx => {
  const [event] = await tx.$queryRaw<SocialEvent[]>`SELECT * FROM "SocialEvent" WHERE "id" = ${eventId} FOR UPDATE`;
  if (!event) throw new SocialEventError('not_found','Event not found.');
  if (event.hostUserId !== userId) throw new SocialEventError('not_host','Only the host can control this game.');
  let game = event.game as Game | null;
  if (game?.operationIds.includes(command.operationId)) return {game,status:event.status};
  if ((game?.version ?? 0) !== command.version) throw new SocialEventError('game_changed','The score changed on another device. Refresh and try again.');
  const now = new Date().toISOString();
  if (command.action === 'start') {
   if (event.status !== 'UPCOMING' || game) throw new SocialEventError('event_closed','This game has already started.');
   const joined = await tx.socialEventParticipant.count({where:{eventId,status:'JOINED'}});
   if (joined < event.maxPlayers) throw new SocialEventError('not_full','All players must join before starting.');
   game = {version:0,startedAt:now,finishedAt:null,runningSince:now,elapsedMs:0,bestOf:command.bestOf ?? 3,teams:command.teams ?? ['Team A','Team B'],actions:[],operationIds:[]};
  } else {
   if (!game || event.status !== 'LIVE') throw new SocialEventError('event_closed','This game is not live.');
   if (command.action === 'score') {
    if (!game.runningSince) throw new SocialEventError('game_paused','Resume the timer before scoring.');
    if (scoreGame(event.sportKey,game).winner !== null) throw new SocialEventError('match_won','The match has been won. Finish the game or undo the last point.');
    if (game.actions.length >= 3000) throw new SocialEventError('score_limit','Finish this game before starting another.');
    if (command.side !== 0 && command.side !== 1 || !scoreChoices(event.sportKey).some(x=>x.value===command.value)) throw new SocialEventError('invalid_score','Choose a valid score for this sport.');
    game.actions.push({id:command.operationId,side:command.side!,value:command.value!,at:now});
   }
   if (command.action === 'undo') game.actions.pop();
   if (command.action === 'pause' || command.action === 'finish') { game.elapsedMs=elapsedGameMs(game);game.runningSince=null; }
   if (command.action === 'resume' && !game.runningSince) game.runningSince=now;
   if (command.action === 'finish') game.finishedAt=now;
  }
  game.version++;game.operationIds=[...game.operationIds.slice(-99),command.operationId];
  const status=game.finishedAt?'COMPLETED':'LIVE';
  await tx.socialEvent.update({where:{id:eventId},data:{status,game:game as unknown as Prisma.InputJsonValue}});
  return {game,status};
 }, {timeout:10000});
 if (command.action==='start'||command.action==='finish') {
  void prisma.socialEventParticipant.findMany({where:{eventId,status:'JOINED',userId:{not:userId}},select:{userId:true}}).then(players=>Promise.all(players.map(p=>notifyActivity(p.userId,`event_${command.action}`,`${eventId}:${command.action}`,'Game update',command.action==='start'?'Your game has started.':'Your game result is ready.',{eventId})))).catch(console.error);
 }
 return result;
}
