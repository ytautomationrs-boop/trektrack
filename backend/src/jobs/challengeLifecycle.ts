import { startDueChallenges, resolveDueChallenges } from "../modules/challenges/resolution.js";
import { finalizeDueCheckIns } from "../modules/challenges/scoring.js";
import { sendCheckInReminders } from "../modules/challenges/reminders.js";

/**
 * StreakPot lifecycle tick. Ordering matters for the same reason as
 * jobs/raceLifecycle.ts: finalize check-ins (which can eliminate a
 * participant) before resolving challenges whose window just ended, so a
 * challenge doesn't resolve one tick early against stale ACTIVE statuses.
 */
export async function runChallengeLifecycle(now = new Date()) {
  const started = await startDueChallenges(now);
  const finalizedCheckIns = await finalizeDueCheckIns(now);
  const resolved = await resolveDueChallenges(now);
  // Last, and after finalization: reminding someone to check in on a day
  // that was just scored as missed would be worse than not reminding them.
  // Deduped by (challenge, local date) — see modules/challenges/reminders.ts.
  const reminders = await sendCheckInReminders(now);
  return { started, finalizedCheckIns, resolved, reminders };
}
