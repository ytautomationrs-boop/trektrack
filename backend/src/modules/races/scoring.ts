import { prisma } from "../../lib/prisma.js";
import { runValidation } from "../health/validators/index.js";
import { runAnomalyDetection } from "../anomaly/rules/index.js";
import { fetchStravaSamples } from "../integrations/strava/stravaService.js";
import { personalBaseline } from "../challenges/scoring.js";
import { STRAVA_SUPPORTED_METRICS } from "../../lib/constants.js";
import type { HealthSampleInput } from "../health/schemas.js";
import type { Race, RaceEntry } from "@prisma/client";

/**
 * Race scoring — ingesting evidence and turning it into one aggregate total
 * per entrant.
 *
 * ## What is reused
 *
 * The verification stack below the payout layer is shared wholesale with the
 * pooled model, because none of it cares how prizes are computed:
 *  - `runValidation` — manual-entry rejection, pedometer corroboration,
 *    GPS-route requirements. Operates on a plain sample object, so races
 *    call it directly.
 *  - `runAnomalyDetection` — baseline spikes, pace plausibility.
 *  - Strava — same server-side pull, same preference over native data.
 *  - Device attestation — enforced at the route layer, unchanged.
 *
 * ## What is deliberately NOT reused
 *
 * Nothing remains to exclude. The pooled model's priority-allocation layer,
 * which split one real activity total across overlapping challenges, was
 * removed with that model — a race always scores a user's full, unsplit
 * total for the window.
 *
 * ## Timezones
 *
 * A race window is a single shared UTC interval — `[startedAt, endsAt)` —
 * and every entrant is scored over the identical span. This is not a
 * weakening of the pooled model's timezone locking; it is the correct
 * analogue of it. In a pass/fail challenge, day boundaries must be local so
 * a user's "day" matches their lived day. In a ranked race, a local-day
 * window would hand whoever is furthest west extra hours of overlap at the
 * edges. `RaceEntry.timezone` is still locked at entry and still used for
 * the anomaly baseline (which is computed in local days) and for display.
 */

export type IngestResult = {
  accepted: number;
  rejected: Array<{ reasonCode: string; reason: string }>;
  flagsRaised: number;
};

/**
 * Stores validated samples against a race entry. Only samples that fall
 * inside the race window and match the race's single metric are kept —
 * anything else is silently ignored rather than rejected, since the mobile
 * client syncs whatever the OS health store hands it.
 */
export async function ingestRaceSamples(raceEntryId: string, samples: HealthSampleInput[]): Promise<IngestResult> {
  const entry = await prisma.raceEntry.findUniqueOrThrow({
    where: { id: raceEntryId },
    include: { race: { include: { raceType: { include: { metricType: true } } } } },
  });
  const { race } = entry;

  if (race.status !== "RUNNING") {
    return { accepted: 0, rejected: [{ reasonCode: "race_not_running", reason: "This race isn't currently running." }], flagsRaised: 0 };
  }
  if (entry.status !== "ENTERED") {
    return { accepted: 0, rejected: [{ reasonCode: "entry_not_active", reason: "This entry is no longer active." }], flagsRaised: 0 };
  }

  const windowStart = race.startedAt!;
  const windowEnd = race.endsAt!;
  const validationRuleKey = race.raceType.metricType.validationRuleKey;

  let accepted = 0;
  let flagsRaised = 0;
  const rejected: IngestResult["rejected"] = [];

  for (const sample of samples) {
    if (sample.metricKey !== race.metricKey) continue; // not this race's metric — ignore, don't reject

    const start = new Date(sample.startTime);
    const end = new Date(sample.endTime);
    // Strict containment, matching the pooled model's time-window posture
    // no partial credit for activity that straddles the race's start or
    // finish.
    if (start < windowStart || end > windowEnd) {
      rejected.push({ reasonCode: "outside_race_window", reason: "Activity falls outside the race window." });
      continue;
    }

    const validation = runValidation(validationRuleKey, sample);
    if (!validation.accepted) {
      rejected.push({ reasonCode: validation.reasonCode, reason: validation.reason });
      continue;
    }

    // Same re-sync duplicate guard as the pooled model: the OS health store
    // is re-read on every foreground, so the identical underlying record is
    // routinely submitted more than once. Counting it twice would inflate
    // the aggregate that decides the ranking.
    const duplicate = await prisma.raceHealthSample.findFirst({
      where: {
        raceEntryId,
        metricKey: sample.metricKey,
        sourceBundleId: sample.sourceBundleId,
        startTime: start,
        endTime: end,
        value: sample.value,
      },
    });
    if (duplicate) {
      accepted++;
      continue;
    }

    const stored = await prisma.raceHealthSample.create({
      data: {
        raceEntryId,
        deviceId: sample.deviceId,
        metricKey: sample.metricKey,
        value: sample.value,
        unit: sample.unit,
        startTime: start,
        endTime: end,
        sourceBundleId: sample.sourceBundleId,
        sourceName: sample.sourceName,
        wasManualEntry: sample.wasManualEntry,
        isWearableSourced: sample.isWearableSourced,
        corroboration: sample.corroboration as never,
      },
    });
    accepted++;

    flagsRaised += await runSampleAnomalyChecks(entry, race, stored.id, sample);
  }

  return { accepted, rejected, flagsRaised };
}

/**
 * Runs the shared anomaly rules over one freshly-stored sample and records
 * any flags against it.
 *
 * The baseline is this user's own historical values for the metric, drawn
 * from BOTH models' evidence tables — a user's real activity history is the
 * same history whether it was logged in a pooled challenge or a race, and a
 * baseline computed from only half of it is easier to walk past.
 */
async function runSampleAnomalyChecks(
  entry: RaceEntry,
  race: Race,
  sampleId: string,
  sample: HealthSampleInput
): Promise<number> {
  // This user's own prior values for the metric, across BOTH models —
  // races and StreakPot challenges alike. Their real activity history is the
  // same history wherever it was logged, and a baseline built from half of it
  // is easier to walk past.
  //
  // The sample just stored is filtered out here rather than in the query:
  // personalBaseline is shared with the challenge side and has no notion of
  // "the one I'm currently checking". Comparing a value against a baseline
  // that already contains it drags the mean toward it and blunts the spike.
  const baseline = await personalBaseline(entry.userId, sample.metricKey, 120);
  const historicalValues = removeOnce(baseline, sample.value);
  const durationSeconds = (new Date(sample.endTime).getTime() - new Date(sample.startTime).getTime()) / 1000;

  const { flags } = runAnomalyDetection({
    metricKey: sample.metricKey,
    value: sample.value,
    historicalValues,
    // No `target` — races have none. The threshold-hugging rules skip
    // themselves rather than being fed a fabricated number.
    durationSeconds,
    distanceMeters: sample.unit === "m" || sample.unit === "km" ? sample.value : undefined,
  });

  if (flags.length === 0) return 0;

  await prisma.raceAnomalyFlag.createMany({
    data: flags.map((f) => ({
      sampleId,
      raceId: race.id,
      raceEntryId: entry.id,
      ruleKey: f.ruleKey,
      severity: f.severity,
      details: { ...f.details, metricKey: sample.metricKey } as never,
    })),
  });
  return flags.length;
}

/** Drops the first occurrence of a value, leaving duplicates of it intact — the sample under test is one row, not every row that happens to share its value. */
function removeOnce(values: number[], value: number | undefined): number[] {
  if (value === undefined) return values;
  const i = values.indexOf(value);
  if (i === -1) return values;
  return [...values.slice(0, i), ...values.slice(i + 1)];
}

/**
 * Pulls fresh Strava activity for an entrant, where the race metric is one
 * Strava can corroborate. Same server-side pull the pooled model uses; the
 * activities come back in the shared HealthSampleInput shape, so they run
 * through exactly the same validation and storage path above.
 */
export async function syncStravaForEntry(raceEntryId: string, now = new Date()): Promise<IngestResult | null> {
  const entry = await prisma.raceEntry.findUniqueOrThrow({
    where: { id: raceEntryId },
    include: { race: true },
  });
  if (!(STRAVA_SUPPORTED_METRICS as readonly string[]).includes(entry.race.metricKey)) return null;

  if (!entry.race.startedAt) return null;

  // Fetch from the race's start rather than "today" — a race window spans
  // days, and an entrant who doesn't open the app for a week should still
  // have every ride in that window counted.
  const samples = await fetchStravaSamples({
    userId: entry.userId,
    metricKey: entry.race.metricKey,
    sinceUtc: entry.race.startedAt,
  });
  if (samples.length === 0) return null;

  const before = new Date();
  const result = await ingestRaceSamples(raceEntryId, samples);
  // Mark what came from Strava so the evidence trail shows the real source,
  // matching DailyMetricResult.dataSource in the pooled model. Idempotency
  // is the sourceBundleId duplicate guard in ingestRaceSamples — a
  // re-fetched activity carries the same `strava:<id>` bundle id and is
  // recognised as already stored.
  await prisma.raceHealthSample.updateMany({
    where: { raceEntryId, ingestedAt: { gte: before } },
    data: { dataSource: "STRAVA" },
  });
  return result;
}

/**
 * This entrant's total for the race metric across the whole race window.
 *
 * A plain sum of validated samples. There is no target, no per-day pass/fail
 * and no partial credit to reason about — which is what makes the ranked
 * model so much simpler to score than the pooled one.
 */
export async function aggregateForEntry(raceEntryId: string): Promise<number> {
  const entry = await prisma.raceEntry.findUniqueOrThrow({
    where: { id: raceEntryId },
    include: { race: true },
  });
  const totals = await aggregateForEntries(entry.race, [raceEntryId]);
  return totals.get(raceEntryId) ?? 0;
}

/**
 * Every entrant's total in ONE query, keyed by entry id.
 *
 * The per-entry version above costs two queries each (load the entry+race,
 * then aggregate), and both callers that matter run it across a whole field:
 * live standings on a 15-second poll for every viewer, and resolution over
 * the full entrant list. A 16-person squad race was therefore 32 queries per
 * standings request — multiplied by every viewer watching it.
 *
 * Entries with no samples yet are simply absent from the grouped result, so
 * callers use `?? 0` rather than expecting a row per entry.
 */
export async function aggregateForEntries(
  race: Pick<Race, "metricKey" | "startedAt" | "endsAt">,
  raceEntryIds: string[]
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  // Before a race starts there is no window to sum over, and `gte: null`
  // would not mean "from the beginning" — it would throw.
  if (!race.startedAt || !race.endsAt || raceEntryIds.length === 0) return totals;

  const rows = await prisma.raceHealthSample.groupBy({
    by: ["raceEntryId"],
    where: {
      raceEntryId: { in: raceEntryIds },
      metricKey: race.metricKey,
      startTime: { gte: race.startedAt },
      endTime: { lte: race.endsAt },
    },
    _sum: { value: true },
  });
  for (const row of rows) totals.set(row.raceEntryId, row._sum.value ?? 0);
  return totals;
}

/**
 * Live standings for a running race. Ordered but NOT positioned — the
 * ordering shown mid-race is provisional, and finishing positions are only
 * written at resolution once anti-fraud review has had its say.
 */
export async function liveStandings(raceId: string) {
  const race = await prisma.race.findUniqueOrThrow({
    where: { id: raceId },
    include: {
      entries: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } }, squad: true } },
      squads: true,
    },
  });

  const sums = await aggregateForEntries(race, race.entries.map((e) => e.id));
  const totals = race.entries.map((entry) => ({
    entryId: entry.id,
    userId: entry.userId,
    displayName: entry.user.displayName,
    avatarUrl: entry.user.avatarUrl,
    squadId: entry.squadId,
    status: entry.status,
    total: entry.status === "DISQUALIFIED" ? 0 : (sums.get(entry.id) ?? 0),
  }));

  /**
   * Annotates a sorted array with 1-based position and the gap to the
   * leader (0 for the leader themselves) — the two things a mid-race view
   * actually needs to show: 'you are Nth' and 'you are X behind 1st'.
   * Purely derived from the sort order already computed above; no separate
   * query.
   */
  function withPositions<T extends { total: number }>(sorted: T[]): Array<T & { position: number; gapFromLeader: number }> {
    const leaderTotal = sorted[0]?.total ?? 0;
    return sorted.map((row, i) => ({ ...row, position: i + 1, gapFromLeader: Math.max(0, leaderTotal - row.total) }));
  }

  if (race.format === "INDIVIDUAL") {
    return {
      format: race.format,
      metricKey: race.metricKey,
      individuals: withPositions([...totals].sort((a, b) => b.total - a.total)),
      squads: [],
    };
  }

  const squads = race.squads.map((squad) => {
    const members = totals.filter((t) => t.squadId === squad.id);
    return {
      squadId: squad.id,
      name: squad.name,
      total: members.reduce((sum, m) => sum + m.total, 0),
      members: withPositions([...members].sort((a, b) => b.total - a.total)),
    };
  });

  return {
    format: race.format,
    metricKey: race.metricKey,
    individuals: [],
    squads: withPositions([...squads].sort((a, b) => b.total - a.total)),
  };
}

