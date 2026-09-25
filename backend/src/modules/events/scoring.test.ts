import {describe,it,expect} from 'vitest';
import {scoreGame,elapsedGameMs,scoreChoices,type Game,type Side} from './scoring.js';
const game=(actions:Side[],bestOf:1|3|5=3):Game=>({version:1,startedAt:'2026-09-25T12:00:00Z',finishedAt:null,runningSince:null,elapsedMs:0,bestOf,teams:['A','B'],operationIds:[],actions:actions.map((side,i)=>({id:String(i),side,value:1,at:''}))});
const winGame=(side:Side)=>Array<Side>(4).fill(side);
describe('sport scoring',()=>{
 it('tennis deuce and advantage need two clear points',()=>{
  const g=game([0,0,0,1,1,1]);expect(scoreGame('tennis',g).display).toEqual(['40','40']);
  g.actions.push({id:'a',side:0,value:1,at:''});expect(scoreGame('tennis',g).display).toEqual(['AD','40']);
  g.actions.push({id:'b',side:1,value:1,at:''});expect(scoreGame('tennis',g).display).toEqual(['40','40']);
  g.actions.push({id:'c',side:0,value:1,at:''},{id:'d',side:0,value:1,at:''});expect(scoreGame('tennis',g).games).toEqual([1,0]);
 });
 it('plays a seven-point win-by-two tiebreak at six games each',()=>{
  const points:Side[]=[];for(let i=0;i<6;i++)points.push(...winGame(0),...winGame(1));
  const tied=game(points,1);expect(scoreGame('tennis',tied).games).toEqual([6,6]);
  for(let i=0;i<6;i++)points.push(0,1);
  expect(scoreGame('tennis',game(points,1)).display).toEqual(['6','6']);
  points.push(0);expect(scoreGame('tennis',game(points,1)).winner).toBeNull();
  points.push(0);const result=scoreGame('tennis',game(points,1));expect(result.winner).toBe(0);expect(result.completedSets).toEqual([[7,6]]);
 });
 it('tennis and padel require the configured number of sets',()=>{
  for(const sport of ['tennis','padel']){const actions=Array<Side>(48).fill(0);expect(scoreGame(sport,game(actions,3)).sets).toEqual([2,0]);expect(scoreGame(sport,game(actions,3)).winner).toBe(0);}
 });
 it('squash is eleven by two; volleyball deciding set is fifteen by two',()=>{
  const actions:Side[]=[];for(let i=0;i<10;i++)actions.push(0,1);actions.push(0);expect(scoreGame('squash',game(actions,1)).winner).toBeNull();actions.push(0);expect(scoreGame('squash',game(actions,1)).winner).toBe(0);
  const volleyball=game([...Array(25).fill(0),...Array(25).fill(1),...Array(14).fill(0)],3);expect(scoreGame('volleyball',volleyball).winner).toBeNull();volleyball.actions.push({id:'last',side:0,value:1,at:''});expect(scoreGame('volleyball',volleyball).completedSets).toEqual([[25,0],[0,25],[15,0]]);
 });
 it('rugby union, touch and basketball expose distinct valid scores',()=>{
  expect(scoreChoices('rugby').map(c=>c.value)).toEqual([5,2,3,3,7]);expect(scoreChoices('touch_rugby').map(c=>c.value)).toEqual([1]);expect(scoreChoices('basketball').map(c=>c.value)).toEqual([1,2,3]);expect(scoreChoices('hiking')).toEqual([]);
  const g=game([]);g.actions=[{id:'try',side:0,value:5,at:''},{id:'conversion',side:0,value:2,at:''},{id:'penalty',side:1,value:3,at:''}];expect(scoreGame('rugby',g).points).toEqual([7,3]);
 });
 it('timer survives backgrounding and pauses without counting paused time',()=>{
  const g=game([]);g.elapsedMs=2000;g.runningSince='2026-09-25T12:00:00Z';expect(elapsedGameMs(g,Date.parse('2026-09-25T12:03:00Z'))).toBe(182000);g.runningSince=null;expect(elapsedGameMs(g,Date.now())).toBe(2000);
 });
});
