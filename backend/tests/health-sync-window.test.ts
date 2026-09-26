import {it,expect} from 'vitest';
import {stepSyncClosesAt} from '../src/modules/health/syncWindow.js';
it('leaves the activity deadline unchanged but allows two hours for step delivery',()=>{const end=new Date('2026-09-26T00:00:00Z');expect(stepSyncClosesAt('steps',end).toISOString()).toBe('2026-09-26T02:00:00.000Z');expect(stepSyncClosesAt('running',end)).toEqual(end);expect(end.toISOString()).toBe('2026-09-26T00:00:00.000Z');});
