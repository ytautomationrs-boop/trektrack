import {it,expect} from 'vitest';
import {activeRaces,activePools,competingMetrics} from '../../mobile/src/screens/home/dashboard';
it('shows only current entered races, excluding history and withdrawn entries',()=>{
 const entries=[{status:'ENTERED',race:{status:'RUNNING',metricKey:'running'}},{status:'WITHDRAWN',race:{status:'FILLING',metricKey:'swimming'}},{status:'SCORED',race:{status:'COMPLETED',metricKey:'cycling'}}];
 expect(competingMetrics(activeRaces(entries),[])).toEqual(['running']);
});
it('includes combo metrics once and hides eliminated players and all test pools',()=>{
 const p={currency:'ZAR',joined:true,status:'ACTIVE',players:[{isYou:true,status:'ACTIVE'}],goals:[{metric:'running'},{metric:'steps'}]};
 const pools=activePools([p,{...p,currency:'TEST'},{...p,players:[{isYou:true,status:'ELIMINATED'}]},{...p,status:'COMPLETED'}]);
 expect(pools).toHaveLength(1);expect(competingMetrics([{race:{metricKey:'running'}}],pools)).toEqual(['steps','running']);expect(competingMetrics([],[])).toEqual([]);
});
