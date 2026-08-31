import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { prisma } from "../../lib/prisma.js";
import { runValidation } from "../health/validators/index.js";
import { runAnomalyDetection } from "../anomaly/rules/index.js";
import { eliminateParticipant } from "./resolution.js";
import type { HealthSampleInput } from "../health/schemas.js";
import type { ChallengeParticipant } from "@prisma/client";

/**
 * StreakPot check-in scoring — day-level pass/fail against a personal
 * target, not a ranked total. Reuses the SAME anti-fraud stack as races
 * (runValidation, runAnomalyDetection): a spoofed step count is spoofed
 * regardless of which model is scoring it.
 *
 * A day's result is computed INCREMENTALLY as samples arrive (so a
 * participant checking the app mid-day sees provisional progress), and
 * FINALISED either the moment every required metric has passed, or by
 * finalizeDueCheckIns() once `cutoffAt` passes with something still missing
 * (scored SYNC_ISSUE, not silently left pending forever).
 */

/** 1-based day number this local date falls on, relative to the challenge's start date in the PARTICIPANT's own timezone (not the challenge creator's). */
export function challengeDayNumber(startDate: Date, timezone: string, localDate: string): number {
  const startLocal = toZonedTime(startDate, timezone);
  const startDay = Date.UTC(startLocal.getFullYear(), startLocal.getMonth(), startLocal.getDate());
  const [y, m, d] = localDate.split("-").map(Number);
  const targetDay = Date.UTC(y!, m! - 1, d!);
  return Math.round((targetDay - startDay) / 86_400_000) + 1;
}

/** Inverse of challengeDayNumber — the local date string for a given day number. */
function localDateForChallengeDay(startDate: Date, timezone: string, day: number): string {
  const startLocal = toZonedTime(startDate, timezone);
  const target = new Date(startLocal.getFullYear(), startLocal.getMonth(), startLocal.getDate() + (day - 1));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
}

/** The instant a check-in for this local day stops accepting new data. */
function cutoffAtFor(localDate: string, timezone: string, gracePeriodMinutes: number): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  // Midnight at the START of the NEXT local day, converted to a real UTC
  // instant in the participant's timezone, plus the grace window.
  const nextLocalMidnight = new Date(y!, m! - 1, d! + 1, 0, 0, 0, 0);
  const utcInstant = fromZonedTime(nextLocalMidnight, timezone);
  return new Date(utcInstant.getTime() + gracePeriodMinutes * 60_000);
}

export type CheckInIngestResult = {
  accepted: number;
  rejected: Array<{ reasonCode: string; reason: string }>;
  flagsRaised: number;
  dayResult: "PENDING" | "PASSED" | "FAILED" | "SYNC_ISSUE";
};

/**
 * Stores validated samples against one participant's check-in for one local
 * day, then recomputes that day's pass/fail across every required metric.
 */
export async function ingestChallengeCheckIn(
  participantId: string,
  localDate: string,
  samples: HealthSampleInput[]
): Promise<CheckInIngestResult> {
  const participant = await prisma.challengeParticipant.findUniqueOrThrow({
    where: { id: participantId },
    include: { challenge: { include: { metricRequirements: { include: { metricType: true } } } } },
  });
  const { challenge } = participant;

  if (challenge.status !== "ACTIVE") {
    return { accepted: 0, rejected: [{ reasonCode: "challenge_not_active", reason: "This challenge isn't currently active." }], flagsRaised: 0, dayResult: "PENDING" };
  }
  if (participant.status !== "ACTIVE") {
    return { accepted: 0, rejected: [{ reasonCode: "participant_not_active", reason: "You're no longer active in this challenge." }], flagsRaised: 0, dayResult: "PENDING" };
  }

  const challengeDay = challengeDayNumber(challenge.startDate, participant.timezone, localDate);
  if (challengeDay < 1 || challengeDay > challenge.durationDays) {
    return { accepted: 0, rejected: [{ reasonCode: "outside_challenge_window", reason: "That date falls outside this challenge's run." }], flagsRaised: 0, dayResult: "PENDING" };
  }

  const cutoffAt = cutoffAtFor(localDate, participant.timezone, challenge.gracePeriodMinutes);
  const checkIn = await prisma.dailyCheckIn.upsert({
    where: { participantId_challengeDay: { participantId, challengeDay } },
    create: { participantId, challengeDay, localDate, result: "PENDING", cutoffAt },
    update: {},
  });

  // Local calendar-day window (in the PARTICIPANT's timezone) — the same
  // "local day" concept a race deliberately avoids (see races/scoring.ts),
  // but exactly right here: a daily target is a target for THAT PERSON's day.
  const [y, m, d] = localDate.split("-").map(Number);
  const dayStart = fromZonedTime(new Date(y!, m! - 1, d!, 0, 0, 0, 0), participant.timezone);
  const dayEnd = fromZonedTime(new Date(y!, m! - 1, d! + 1, 0, 0, 0, 0), participant.timezone);

  let accepted = 0;
  let flagsRaised = 0;
  const rejected: CheckInIngestResult["rejected"] = [];

  for (const requirement of challenge.metricRequirements) {
    const relevant = samples.filter((s) => s.metricKey === requirement.metricKey);
    if (relevant.length === 0) continue;

    // Hoisted: this query is invariant across the loop below — the user is
    // fixed, and every sample in `relevant` has this requirement's metricKey
    // by construction. Inside the loop it refetched the identical rows once
    // per sample, up to 200 times for a single check-in request.
    //
    // Drawn from BOTH models' evidence: a person's real activity history is
    // the same history whether it was logged in a race or a challenge, and a
    // baseline built from half of it is easier to walk past. Before challenge
    // samples were persisted this could only see race data, which left the
    // baseline permanently empty for anyone who had only ever done
    // challenges — and baselineSpike needs 3+ values to fire at all.
    const historicalValues = await personalBaseline(participant.userId, requirement.metricKey);

    let total = 0;
    for (const sample of relevant) {
      const start = new Date(sample.startTime);
      const end = new Date(sample.endTime);
      if (start < dayStart || end > dayEnd) {
        rejected.push({ reasonCode: "outside_day_window", reason: "Activity falls outside this check-in's local day." });
        continue;
      }
      if (!withinTimeOfDayWindow(start, requirement.startTimeMinutes, requirement.endTimeMinutes, participant.timezone)) {
        rejected.push({ reasonCode: "outside_time_window", reason: "Activity falls outside this challenge's required time window." });
        continue;
      }

      const validation = runValidation(requirement.metricType.validationRuleKey, sample);
      if (!validation.accepted) {
        rejected.push({ reasonCode: validation.reasonCode, reason: validation.reason });
        continue;
      }

      total += sample.value;
      accepted++;

      // Store the evidence before scoring anything on it. Same duplicate
      // guard as races: the OS health store is re-read on every foreground,
      // so the identical underlying record is routinely submitted more than
      // once, and an evidence trail with the same activity in it five times
      // is worse than useless during a dispute.
      const duplicate = await prisma.challengeHealthSample.findFirst({
        where: {
          participantId,
          metricKey: sample.metricKey,
          sourceBundleId: sample.sourceBundleId,
          startTime: start,
          endTime: end,
          value: sample.value,
        },
        select: { id: true },
      });
      if (duplicate) continue;

      const stored = await prisma.challengeHealthSample.create({
        data: {
          participantId,
          checkInId: checkIn.id,
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

      const { flags } = runAnomalyDetection({
        metricKey: sample.metricKey,
        value: sample.value,
        historicalValues,
        durationSeconds: (end.getTime() - start.getTime()) / 1000,
        distanceMeters: sample.unit === "m" || sample.unit === "km" ? sample.value : undefined,
      });
      if (flags.length > 0) {
        // Previously these were counted and thrown away — nothing recorded
        // them, so nothing could ever review them.
        await prisma.challengeAnomalyFlag.createMany({
          data: flags.map((f) => ({
            sampleId: stored.id,
            challengeId: challenge.id,
            participantId,
            ruleKey: f.ruleKey,
            severity: f.severity,
            details: { ...f.details, metricKey: sample.metricKey } as never,
          })),
        });
        flagsRaised += flags.length;
      }
    }

    const passed = total >= requirement.dailyTarget;
    await prisma.dailyMetricResult.upsert({
      where: { checkInId_metricKey: { checkInId: checkIn.id, metricKey: requirement.metricKey } },
      create: {
        checkInId: checkIn.id,
        metricKey: requirement.metricKey,
        targetValue: requirement.dailyTarget,
        actualValue: total,
        passed,
        paceTargetSecPerKm: requirement.paceTargetSecPerKm,
        dataSource: "NATIVE_HEALTH",
      },
      update: { actualValue: total, passed },
    });
  }

  const dayResult = await finalizeCheckInIfComplete(checkIn.id, participant, challenge.metricRequirements.length);
  return { accepted, rejected, flagsRaised, dayResult };
}

function withinTimeOfDayWindow(sampleStart: Date, startMinutes: number | null, endMinutes: number | null, timezone: string): boolean {
  if (startMinutes == null && endMinutes == null) return true;
  const local = toZonedTime(sampleStart, timezone);
  const minutesOfDay = local.getHours() * 60 + local.getMinutes();
  if (startMinutes != null && minutesOfDay < startMinutes) return false;
  if (endMinutes != null && minutesOfDay > endMinutes) return false;
  return true;
}

/**
 * A day PASSES only once every required metric has a result and all of them
 * passed; FAILS as soon as any required metric has a result and failed (no
 * need to wait for the others). Otherwise stays PENDING until
 * finalizeDueCheckIns() scores it SYNC_ISSUE at cutoff.
 *
 * A FAILED day eliminates the participant immediately unless an unused
 * redemption absorbs it — see eliminateParticipant in resolution.ts.
 */
async function finalizeCheckInIfComplete(
  checkInId: string,
  participant: ChallengeParticipant & { challenge: { id: string; mode: string; eliminationScope: string | null } },
  requiredMetricCount: number
): Promise<"PENDING" | "PASSED" | "FAILED" | "SYNC_ISSUE"> {
  const results = await prisma.dailyMetricResult.findMany({ where: { checkInId } });
  const anyFailed = results.some((r) => !r.passed);
  const allPresent = results.length >= requiredMetricCount;

  if (!anyFailed && !allPresent) return "PENDING";

  const result = anyFailed ? "FAILED" : "PASSED";
  await prisma.dailyCheckIn.update({ where: { id: checkInId }, data: { result, verifiedAt: new Date() } });

  if (result === "PASSED") {
    await prisma.challengeParticipant.update({ where: { id: participant.id }, data: { currentStreak: { increment: 1 } } });
  } else {
    const checkIn = await prisma.dailyCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
    await eliminateParticipant(participant.id, checkIn.challengeDay);
  }
  return result;
}

/**
 * Scores every closed day that still needs a verdict, as SYNC_ISSUE:
 *
 *  1. A DailyCheckIn already exists (the participant submitted SOMETHING)
 *     but never accumulated enough to pass before cutoffAt — same as before.
 *  2. No DailyCheckIn exists at all, because the participant submitted
 *     NOTHING that day. Without this branch, someone who never opens the
 *     app is invisible to elimination entirely and would wrongly stay
 *     ACTIVE (and therefore wrongly share the payout) forever — this is
 *     the branch that makes "must check in every required day" actually
 *     mean every day, not just every day someone bothered to sync.
 *
 * Driven by jobs/challengeLifecycle.ts, ahead of resolveDueChallenges so a
 * challenge never resolves one tick early against a stale ACTIVE status.
 */
export async function finalizeDueCheckIns(now = new Date()) {
  let finalized = 0;

  // Branch 2 first: create-and-finalize any day that closed with zero
  // submission, for every still-ACTIVE participant in an ACTIVE challenge.
  const activeParticipants = await prisma.challengeParticipant.findMany({
    where: { status: "ACTIVE", challenge: { status: "ACTIVE" } },
    include: { challenge: true },
  });
  for (const participant of activeParticipants) {
    const { challenge } = participant;
    const dayNow = challengeDayNumber(challenge.startDate, participant.timezone, currentLocalDate(now, participant.timezone));
    const lastPossibleDay = Math.min(dayNow, challenge.durationDays);

    for (let day = 1; day <= lastPossibleDay; day++) {
      const localDate = localDateForChallengeDay(challenge.startDate, participant.timezone, day);
      const cutoffAt = cutoffAtFor(localDate, participant.timezone, challenge.gracePeriodMinutes);
      if (now < cutoffAt) continue;

      const existing = await prisma.dailyCheckIn.findUnique({ where: { participantId_challengeDay: { participantId: participant.id, challengeDay: day } } });
      if (existing) continue; // handled by branch 1 below if still PENDING

      // Conditional create via a fresh row — the unique constraint on
      // (participantId, challengeDay) means a second concurrent tick's
      // insert simply fails and is treated as "already handled".
      try {
        await prisma.dailyCheckIn.create({
          data: { participantId: participant.id, challengeDay: day, localDate, result: "SYNC_ISSUE", cutoffAt, verifiedAt: now },
        });
      } catch {
        continue; // lost a race with another tick — it already exists now
      }
      // Re-check status: an earlier day in this same loop may have already
      // eliminated (or cascaded past) this participant.
      const stillActive = await prisma.challengeParticipant.findUniqueOrThrow({ where: { id: participant.id } });
      if (stillActive.status === "ACTIVE") await eliminateParticipant(participant.id, day);
      finalized++;
    }
  }

  // Branch 1: a DailyCheckIn exists (something was submitted) but never
  // accumulated a pass before its cutoff.
  const pending = await prisma.dailyCheckIn.findMany({
    where: { result: "PENDING", cutoffAt: { lte: now } },
    include: { participant: true },
  });
  for (const checkIn of pending) {
    const claimed = await prisma.dailyCheckIn.updateMany({
      where: { id: checkIn.id, result: "PENDING" },
      data: { result: "SYNC_ISSUE", verifiedAt: now },
    });
    if (claimed.count === 0) continue;
    if (checkIn.participant.status === "ACTIVE") {
      await eliminateParticipant(checkIn.participantId, checkIn.challengeDay);
    }
    finalized++;
  }

  return { finalized, considered: activeParticipants.length + pending.length };
}

/**
 * This user's own prior values for a metric, across BOTH models' evidence.
 *
 * A person's activity history is the same history whether it was logged
 * racing or in a challenge, and a baseline computed from only half of it is
 * easier to walk past — someone who does all their real activity in races
 * would otherwise look like a stranger the first time they check in on a
 * challenge, and vice versa.
 *
 * Capped per side rather than globally so one busy model can't crowd the
 * other out of the window entirely.
 */
export async function personalBaseline(userId: string, metricKey: string, perSource = 60): Promise<number[]> {
  const [raceSamples, challengeSamples] = await Promise.all([
    prisma.raceHealthSample.findMany({
      where: { raceEntry: { userId }, metricKey },
      select: { value: true },
      orderBy: { startTime: "desc" },
      take: perSource,
    }),
    prisma.challengeHealthSample.findMany({
      where: { participant: { userId }, metricKey },
      select: { value: true },
      orderBy: { startTime: "desc" },
      take: perSource,
    }),
  ]);
  return [...raceSamples, ...challengeSamples].map((s) => s.value);
}

/** "Today" as a local date string in the given timezone, for scanning which challenge days have closed so far. */
function currentLocalDate(now: Date, timezone: string): string {
  const local = toZonedTime(now, timezone);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}
