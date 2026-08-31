import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { prisma } from "../../lib/prisma.js";
import { STRAVA_SUPPORTED_METRICS } from "../../lib/constants.js";
import { fetchStravaSamples } from "../integrations/strava/stravaService.js";
import { ingestChallengeCheckIn } from "./scoring.js";

/**
 * Server-side Strava pull for active challenge participants — the direct
 * counterpart to jobs/raceLifecycle.ts runRaceStravaSync.
 *
 * This exists because of an asymmetry that would otherwise be unfair. A
 * challenge check-in normally comes from the device's own health store, but
 * a browser has no health store at all (see health/adapters/webUnavailable.ts).
 * Without this job, a web participant in a running or cycling challenge
 * could log a real ride, never be credited, and forfeit their entire stake
 * to people who did no more than they did.
 *
 * It only covers what Strava can corroborate — running and cycling. Steps,
 * swimming and sleep have no web-reachable source, which is a real product
 * constraint rather than something this job can paper over; see
 * `webVerifiableMetrics` below and the note in DEPLOYMENT.md.
 */

/** Metrics a WEB user can have verified at all: exactly what Strava corroborates. */
export const WEB_VERIFIABLE_METRICS = STRAVA_SUPPORTED_METRICS;

export async function runChallengeStravaSync(now = new Date()) {
  const participants = await prisma.challengeParticipant.findMany({
    where: {
      status: "ACTIVE",
      challenge: { status: "ACTIVE" },
      user: { stravaConnection: { status: "ACTIVE" } },
    },
    include: {
      challenge: { include: { metricRequirements: { select: { metricKey: true } } } },
    },
  });

  let synced = 0;
  let considered = 0;

  for (const participant of participants) {
    const stravaMetrics = participant.challenge.metricRequirements
      .map((r) => r.metricKey)
      .filter((key) => (STRAVA_SUPPORTED_METRICS as readonly string[]).includes(key));
    if (stravaMetrics.length === 0) continue;
    considered++;

    try {
      // The participant's OWN local day — a challenge day is a local-day
      // concept, so pulling "since 24h ago" would straddle two of them.
      const local = toZonedTime(now, participant.timezone);
      const localDate = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
      const dayStartUtc = fromZonedTime(new Date(local.getFullYear(), local.getMonth(), local.getDate(), 0, 0, 0, 0), participant.timezone);

      for (const metricKey of stravaMetrics) {
        const samples = await fetchStravaSamples({ userId: participant.userId, metricKey, sinceUtc: dayStartUtc });
        if (samples.length === 0) continue;

        const result = await ingestChallengeCheckIn(participant.id, localDate, samples);
        if (result.accepted > 0) {
          synced++;
          // Mark the evidence's real source, matching how races do it. The
          // duplicate guard in ingestion is what makes re-running safe: a
          // re-fetched activity carries the same strava:<id> bundle id.
          await prisma.dailyMetricResult.updateMany({
            where: { checkIn: { participantId: participant.id, localDate }, metricKey },
            data: { dataSource: "STRAVA" },
          });
        }
      }
    } catch (err) {
      // One participant's expired token must not stop the sweep — the whole
      // point is that people who did the work get credited.
      console.error(`[challenge-strava] participant ${participant.id} failed:`, err);
    }
  }

  return { considered, synced };
}
