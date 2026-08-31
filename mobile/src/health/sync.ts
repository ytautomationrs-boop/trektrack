import { getHealthAdapter } from "./registry";
import { revokeHealthConnection } from "../api/client";
import { submitRaceSamples } from "../api/raceClient";
import { submitCheckIn } from "../api/challengeClient";
import type { DataSourceCategory, LocalDayWindow } from "./types";

/**
 * Reads health data off the device and pushes it to the backend for
 * validation and storage against a race entry.
 *
 * A race is scored on the cumulative total across its whole window, so this
 * is safe to call as often as the app foregrounds: the backend rejects
 * anything outside the race window and recognises an already-stored sample
 * by its source id rather than counting it twice.
 *
 * Under the pooled model this synced a *participant* and drove a daily
 * pass/fail check-in, and it carried an allocation override so overlapping
 * challenges could share one phone reading. Races removed both — a race
 * always scores the user's full, unsplit total, so there is nothing to
 * allocate and no check-in to trigger.
 */

function todayWindow(): LocalDayWindow {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86_400_000);
  return { localDate: start.toISOString().slice(0, 10), startUtc: start, endUtc: end };
}

const SESSION_CATEGORIES: DataSourceCategory[] = [
  "CYCLING_WORKOUT",
  "RUNNING_WORKOUT",
  "SWIMMING_WORKOUT",
  "GENERIC_WORKOUT",
];

/** Reads today's samples for a race's metric and submits them against the entry. */
export async function syncRaceHealthData(params: {
  raceEntryId: string;
  metricKey: string;
  category: DataSourceCategory;
}) {
  const adapter = getHealthAdapter();
  const window = todayWindow();

  try {
    const samples = SESSION_CATEGORIES.includes(params.category)
      ? await adapter.readWorkoutSessions(params.category, params.metricKey, window)
      : await adapter.readDailyAggregate(params.category, params.metricKey, window);

    if (samples.length === 0) return { synced: 0, rejected: 0 };

    const result = await submitRaceSamples(params.raceEntryId, samples);
    return { synced: result.accepted, rejected: result.rejected.length };
  } catch (err: any) {
    if (err?.code === "permission_denied" || err?.code === "E_HEALTHKIT_NOT_AUTHORIZED") {
      await revokeHealthConnection(adapter.providerName).catch(() => {});
    }
    throw err;
  }
}

/**
 * Syncs every race the user is currently in. One failure doesn't block the
 * rest — a revoked permission on one entry shouldn't cost them the others.
 */
export async function syncActiveRaces(
  entries: Array<{ raceEntryId: string; metricKey: string; category: DataSourceCategory }>
) {
  const results = await Promise.all(
    entries.map((e) => syncRaceHealthData(e).catch(() => ({ synced: 0, rejected: 0 })))
  );
  return {
    synced: results.reduce((sum, r) => sum + r.synced, 0),
    rejected: results.reduce((sum, r) => sum + r.rejected, 0),
  };
}

/**
 * StreakPot's equivalent of syncRaceHealthData — reads TODAY's samples off
 * the device and submits them as this participant's check-in for today.
 *
 * Unlike a race (one cumulative total for the whole window), a challenge
 * scores one local day at a time, so this always targets "today" rather
 * than the whole run — call it once per day the participant wants scored,
 * typically from ChallengeDetailScreen's own sync action.
 */
export async function syncChallengeCheckIn(params: {
  participantId: string;
  metricKey: string;
  category: DataSourceCategory;
}) {
  const adapter = getHealthAdapter();
  const window = todayWindow();

  try {
    const samples = SESSION_CATEGORIES.includes(params.category)
      ? await adapter.readWorkoutSessions(params.category, params.metricKey, window)
      : await adapter.readDailyAggregate(params.category, params.metricKey, window);

    if (samples.length === 0) return { synced: 0, rejected: 0, dayResult: "PENDING" as const };

    const result = await submitCheckIn(params.participantId, window.localDate, samples);
    return { synced: result.accepted, rejected: result.rejected.length, dayResult: result.dayResult };
  } catch (err: any) {
    if (err?.code === "permission_denied" || err?.code === "E_HEALTHKIT_NOT_AUTHORIZED") {
      await revokeHealthConnection(adapter.providerName).catch(() => {});
    }
    throw err;
  }
}
