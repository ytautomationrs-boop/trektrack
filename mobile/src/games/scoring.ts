export type Side = 0 | 1;
export type ScoreAction = { id: string; side: Side; value: number; at: string };
export type Game = {
  version: number; startedAt: string; finishedAt: string | null;
  runningSince: string | null; elapsedMs: number; bestOf: 1 | 3 | 5;
  teams: [string, string]; actions: ScoreAction[]; operationIds: string[];
};
export function scoreChoices(sport: string) {
  if (sport === 'rugby') return [{label:'Try',value:5},{label:'Conversion',value:2},{label:'Penalty',value:3},{label:'Drop goal',value:3},{label:'Penalty try',value:7}];
  if (sport === 'basketball') return [{label:'Free throw',value:1},{label:'2 points',value:2},{label:'3 points',value:3}];
  if (sport === 'hiking') return [];
  return [{label: sport === 'touch_rugby' ? 'Try' : ['football','netball'].includes(sport) ? 'Goal' : 'Point',value:1}];
}
export function scoreGame(sport: string, game: Pick<Game,'actions'|'bestOf'>) {
  const points: [number,number] = [0,0], games: [number,number] = [0,0], sets: [number,number] = [0,0];
  const completedSets: number[][] = [];
  let winner: Side | null = null;
  const racket = sport === 'tennis' || sport === 'padel';
  const setSport = racket || sport === 'squash' || sport === 'volleyball';
  const winSet = (side: Side, result: number[]) => {
    completedSets.push([...result]); sets[side]++; games.fill(0); points.fill(0);
    if (sets[side] >= Math.ceil(game.bestOf / 2)) winner = side;
  };
  for (const action of game.actions) {
    if (winner !== null) break;
    const side = action.side, other = (1 - side) as Side;
    points[side] += action.value;
    if (racket) {
      const tieBreak = games[0] === 6 && games[1] === 6;
      if (points[side] >= (tieBreak ? 7 : 4) && points[side] - points[other] >= 2) {
        games[side]++; points.fill(0);
        if (tieBreak || games[side] >= 6 && games[side] - games[other] >= 2) winSet(side,games);
      }
    } else if (setSport) {
      const target = sport === 'squash' ? 11 : sets[0] + sets[1] === game.bestOf - 1 ? 15 : 25;
      if (points[side] >= target && points[side] - points[other] >= 2) winSet(side,points);
    }
  }
  let display = points.map(String);
  if (racket && !(games[0] === 6 && games[1] === 6)) {
    display = points.map((p,i) => p >= 3 && points[(1-i) as Side] >= 3 ? p === points[(1-i) as Side] ? '40' : p > points[(1-i) as Side] ? 'AD' : '40' : (['0','15','30','40'][Math.min(p,3)] ?? '40'));
  }
  return { points, games, sets, completedSets, display, winner, setSport, racket };
}
export function elapsedGameMs(game: Game, now = Date.now()) {
  return game.elapsedMs + (game.runningSince ? Math.max(0,now-Date.parse(game.runningSince)) : 0);
}
export function gameSummary(sport: string, game: Game) {
  if (sport === "hiking") return "Activity completed";
  const score = scoreGame(sport,game);
  const result = score.setSport ? score.sets : score.points;
  return `${game.teams[0]} ${result[0]} – ${result[1]} ${game.teams[1]}${score.racket && (score.games.some(Boolean) || score.points.some(Boolean)) ? ` · games ${score.games.join('–')}, points ${score.display.join('–')}` : ''}${score.completedSets.length ? ` (${score.completedSets.map(s=>s.join('–')).join(', ')})` : ''}`;
}
