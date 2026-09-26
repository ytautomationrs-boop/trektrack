// iOS step delivery is batched. Only activity inside the original race
// window counts; this extra time is for receiving that activity, not earning more.
export const STEP_SYNC_GRACE_MS = 2 * 60 * 60 * 1000;
export function stepSyncClosesAt(metricKey: string, end: Date): Date {
  return new Date(end.getTime() + (metricKey === 'steps' ? STEP_SYNC_GRACE_MS : 0));
}
