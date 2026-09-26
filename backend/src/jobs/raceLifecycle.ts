import { ensureOpenRaces, startLockedRaces } from "../modules/races/service.js";
import { releaseHeldRacePrizes, resolveDueRaces } from "../modules/races/resolution.js";
import { prisma } from "../lib/prisma.js";
import { syncStravaForEntry } from "../modules/races/scoring.js";
import { STRAVA_SUPPORTED_METRICS } from "../lib/constants.js";

/**
 * The race lifecycle tick, run on a schedule.
 *
 * Fill has no deadline any more, so there is nothing here that cancels a
 * race for taking too long to fill — that only ever happens through a
 * manual admin action (see modules/races/service.ts adminCancelRace).
 *
 * Ordering matters:
 *
 *  1. Start every LOCKED race whose scheduled instant has arrived. Locking
 *     itself happens inline in enterRace() the moment a race fills; this is
 *     only the later LOCKED → RUNNING transition, at the next midnight in
 *     that race's anchor timezone.
 *  2. Resolve races whose window has elapsed.
 *  3. Release prizes that were held for review and have since cleared.
 *  4. Remove empty open races after the short creation grace period.
 */
export async function runRaceLifecycle(now = new Date()) {
  const started = await startLockedRaces(now);
  const resolved = await resolveDueRaces(now);
  const released = await releaseHeldRacePrizes(now);
  const opened = await ensureOpenRaces(now);
  return { started, resolved, released, opened };
}

/**
 * Server-side Strava pull for every entrant in a running race whose metric
 * Strava can corroborate.
 *
 * Same reasoning as the pooled model's daily verification backstop: an
 * entrant who logs a real ride but never opens the app should still have it
 * counted. Without this, a race could be decided by who remembered to open
 * their phone rather than who actually rode furthest.
 *
 * Kept as its own job on a slower cadence than the lifecycle tick because it
 * makes real outbound API calls — Strava's free tier is 200 requests per 15
 * minutes per application, shared across every user.
 */
export async function runRaceStravaSync(now = new Date()) {
  const entries = await prisma.raceEntry.findMany({
    where: {
      status: "ENTERED",
      race: { status: "RUNNING", metricKey: { in: [...STRAVA_SUPPORTED_METRICS] } },
      user: { stravaConnection: { status: "ACTIVE" } },
    },
    select: { id: true },
  });

  let synced = 0;
  for (const entry of entries) {
    try {
      const result = await syncStravaForEntry(entry.id, now);
      if (result && result.accepted > 0) synced++;
    } catch (err) {
      // One entrant's expired token must not stop the sweep for everyone
      // else in the race.
      console.error(`[race-strava] entry ${entry.id} failed:`, err);
    }
  }
  return { considered: entries.length, synced };
}
