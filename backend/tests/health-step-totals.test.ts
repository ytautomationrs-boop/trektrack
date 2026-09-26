import {it,expect,vi} from 'vitest';
const db=vi.hoisted(()=>({raceHealthSample:{groupBy:vi.fn()},healthStepSnapshot:{findMany:vi.fn()}}));
vi.mock('../src/lib/env.js',()=>({env:{}}));
vi.mock('../src/lib/prisma.js',()=>({prisma:db}));
import {aggregateForEntries} from '../src/modules/races/scoring.js';
it('uses the merged HealthKit snapshot without adding older imports or other device snapshots',async()=>{
 db.raceHealthSample.groupBy.mockResolvedValue([{raceEntryId:'e',_sum:{value:1000}},{raceEntryId:'legacy',_sum:{value:150}}]);
 db.healthStepSnapshot.findMany.mockResolvedValue([{raceEntryId:'e',steps:800}]);
 const totals=await aggregateForEntries({metricKey:'steps',startedAt:new Date('2026-09-25'),endsAt:new Date('2026-09-27')},['e','legacy']);
 expect(totals.get('e')).toBe(800);expect(totals.get('legacy')).toBe(150);
});
