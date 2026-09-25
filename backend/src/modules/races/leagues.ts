import { Prisma, type LeagueLevel, type UserLeagueState } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { LEAGUE_OPEN_FILL_MULTIPLIER, POINTS_FLOOR, RACE_ELIGIBLE_METRIC_KEYS } from "./config.js";

/**
 * League membership and permanent point totals — tracked INDEPENDENTLY PER
 * METRIC.
 *
 * A user has four separate progressions: steps, running, cycling, swimming.
 * Winning running races moves their running league and nothing else. Someone
 * can sit in League 12 for running and League 1 for swimming at the same
 * time, and both are correct — races are single-metric, so a level in one
 * says nothing about ability in another.
 *
 * Every function here therefore takes a metricKey. There is no such thing as
 * "the user's league" without one.
 *
 * Four invariants this module exists to hold, all within a single metric's
 * track:
 *
 *  1. POINTS ARE PERMANENT. `totalPoints` is written only by
 *     applyRaceResult(), only with a delta from a race result. No reset, no
 *     decay, no season rollover, no administrative adjustment path.
 *
 *  2. NO DEMOTION, EVER. `currentLevel` is monotonic — only ever assigned via
 *     Math.max against its current value. No code path lowers it.
 *
 *  3. NOBODY IS PLACED IN A LEAGUE THAT CANNOT RUN RACES. `qualifiedLevel`
 *     tracks what the points entitle them to; `currentLevel` tracks where
 *     they actually are. They diverge only while a level is closed.
 *
 *  4. METRICS NEVER LEAK INTO EACH OTHER. Every read and write below is
 *     scoped by (userId, metricKey).
 */

export class LeagueError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/**
 * A user's standing in ONE metric, created lazily at League 1 with zero
 * points.
 *
 * Lazy creation is what makes "a user who has never raced swimming is in the
 * base swimming league" true without writing four rows for everyone at
 * signup: the absence of a row and a row at League 1 with zero points mean
 * exactly the same thing, and this collapses them.
 */
export async function getOrCreateLeagueState(userId: string, metricKey: string, tx: Db = prisma) {
  // upsert, not find-then-create. This is called on the race-entry path, so
  // two entries landing together for the same user and metric — a
  // double-tapped Enter button, or the concurrency the smoke suite
  // deliberately generates — both saw no row and both tried to create one.
  // The loser hit the unique constraint and the whole entry came back 500.
  //
  // The `update` has to assign something. Prisma only compiles an upsert to
  // a single atomic `INSERT ... ON CONFLICT DO UPDATE` when there is a SET
  // clause to emit; given `update: {}` it falls back to find-then-create and
  // reintroduces exactly the race this is here to remove. Assigning userId
  // to itself is a no-op write that keeps the statement atomic.
  //
  // There is deliberately no P2002 fallback. Catching it here cannot work:
  // these calls run inside an interactive transaction, and once a statement
  // raises, Postgres has already aborted it — a recovery read on the same
  // connection fails too. Atomicity is the only fix available.
  return tx.userLeagueState.upsert({
    where: { userId_metricKey: { userId, metricKey } },
    update: { userId },
    create: { userId, metricKey, totalPoints: 0, currentLevel: 1, qualifiedLevel: 1 },
  });
}

/** Every metric's standing for one user, in a stable order, creating any that are missing. */
export async function getAllLeagueStates(userId: string) {
  const existing = await prisma.userLeagueState.findMany({
    where: { userId, metricKey: { in: [...RACE_ELIGIBLE_METRIC_KEYS] } },
  });
  const byMetric = new Map(existing.map((state) => [state.metricKey, state]));
  return Promise.all(
    RACE_ELIGIBLE_METRIC_KEYS.map((metricKey) =>
      byMetric.get(metricKey) ?? getOrCreateLeagueState(userId, metricKey))
  );
}

/** The highest level in this metric whose `minPoints` the total reaches. Never below 1. */
export async function levelForPoints(metricKey: string, totalPoints: number, tx: Db = prisma): Promise<number> {
  const level = await tx.leagueLevel.findFirst({
    where: { metricKey, minPoints: { lte: totalPoints } },
    orderBy: { level: "desc" },
  });
  return level?.level ?? 1;
}

/** The highest OPEN level in this metric at or below `qualifiedLevel`. */
export async function highestOpenLevelUpTo(metricKey: string, qualifiedLevel: number, tx: Db = prisma): Promise<number> {
  const level = await tx.leagueLevel.findFirst({
    where: { metricKey, isOpen: true, level: { lte: qualifiedLevel } },
    orderBy: { level: "desc" },
  });
  return level?.level ?? 1;
}

export type PointsApplication = {
  metricKey: string;
  pointsAwarded: number;
  pointsBefore: number;
  pointsAfter: number;
  levelBefore: number;
  levelAfter: number;
  promoted: boolean;
  qualifiedForUnopenedLevel: number | null;
};

/**
 * Applies one race result to a user's standing IN THAT RACE'S METRIC ONLY.
 *
 * Must run inside the caller's transaction — points, the audit row, and the
 * entry's recorded result commit together or not at all.
 *
 * The floor applies to the stored total but not to the audit row's `points`:
 * a -4 against a 2-point total records points=-4, before=2, after=0, so the
 * trail shows both what the race awarded and what it did to the total.
 */
export async function applyRaceResult(
  tx: Tx,
  params: {
    userId: string;
    metricKey: string;
    raceId: string;
    raceEntryId: string;
    points: number;
    position: number;
    /**
     * The entry raced a league BELOW the user's own — the voluntary
     * fallback for an empty league. `points` is already 0 in this case
     * (the caller decides that), so totalPoints/level are naturally
     * unaffected; this flag additionally suppresses the racesWon counter
     * (a win here should not appear to have won in a league the user did
     * not actually compete in as a peer) and is stamped onto the audit
     * row so the history can say why a 1st-place finish shows 0 points.
     */
    lowerLeagueOptIn?: boolean;
  }
): Promise<PointsApplication> {
  const state = await getOrCreateLeagueState(params.userId, params.metricKey, tx);

  const pointsBefore = state.totalPoints;
  const pointsAfter = Math.max(POINTS_FLOOR, pointsBefore + params.points);

  const qualifiedLevel = Math.max(
    state.qualifiedLevel,
    await levelForPoints(params.metricKey, pointsAfter, tx)
  );
  // Monotonic in both directions of the max: never drops because points fell,
  // never drops because a level they were already placed in somehow closed.
  const levelAfter = Math.max(
    state.currentLevel,
    await highestOpenLevelUpTo(params.metricKey, qualifiedLevel, tx)
  );
  const promoted = levelAfter > state.currentLevel;

  await tx.userLeagueState.update({
    where: { userId_metricKey: { userId: params.userId, metricKey: params.metricKey } },
    data: {
      totalPoints: pointsAfter,
      qualifiedLevel,
      currentLevel: levelAfter,
      ...(promoted ? { promotedAt: new Date() } : {}),
      ...(params.position === 1 && !params.lowerLeagueOptIn ? { racesWon: { increment: 1 } } : {}),
    },
  });

  await tx.racePointEntry.create({
    data: {
      userId: params.userId,
      metricKey: params.metricKey,
      raceId: params.raceId,
      raceEntryId: params.raceEntryId,
      points: params.points,
      pointsBefore,
      pointsAfter,
      position: params.position,
      lowerLeagueOptIn: params.lowerLeagueOptIn ?? false,
    },
  });

  return {
    metricKey: params.metricKey,
    pointsAwarded: params.points,
    pointsBefore,
    pointsAfter,
    levelBefore: state.currentLevel,
    levelAfter,
    promoted,
    qualifiedForUnopenedLevel: qualifiedLevel > levelAfter ? qualifiedLevel : null,
  };
}

/**
 * How ready one metric's level is to be opened.
 *
 * Readiness is inherently per-metric, and that is the main reason the league
 * table is keyed by metric at all: steps may have plenty of racers while
 * swimming has almost none, and "League 2 is ready" for steps says nothing
 * whatsoever about swimming.
 */
export async function leagueOpenReadiness(metricKey: string, level: number) {
  const [leagueLevel, qualifiedCount, schedules] = await Promise.all([
    prisma.leagueLevel.findUnique({ where: { metricKey_level: { metricKey, level } } }),
    prisma.userLeagueState.count({ where: { metricKey, qualifiedLevel: { gte: level } } }),
    prisma.racePrizeSchedule.findMany({ where: { metricKey, leagueLevel: level }, include: { raceType: true } }),
  ]);
  if (!leagueLevel) {
    throw new LeagueError("unknown_level", `No league level ${level} for "${metricKey}".`);
  }

  const activeTypes = schedules.filter((s) => s.raceType.isActive);
  // People, not slots — a 4-squad race of 4 needs 16 bodies, not 4.
  const requiredEntrants = activeTypes.reduce(
    (max, s) => Math.max(max, s.raceType.entrantCount * (s.raceType.squadSize ?? 1)),
    0
  );
  const recommendedMinimum = Math.ceil(requiredEntrants * LEAGUE_OPEN_FILL_MULTIPLIER);

  return {
    metricKey,
    level,
    name: leagueLevel.name,
    isOpen: leagueLevel.isOpen,
    qualifiedCount,
    requiredEntrants,
    recommendedMinimum,
    ready: qualifiedCount >= recommendedMinimum && requiredEntrants > 0,
    activeRaceTypes: activeTypes.map((s) => s.raceTypeKey),
  };
}

/**
 * Opens one metric's league level and promotes everyone already qualified
 * for it — in that metric only.
 *
 * Refuses to open a level with no active race type or too few qualified
 * users unless forced: opening early moves users into a league whose races
 * will fail to fill and refund.
 */
export async function openLeagueLevel(metricKey: string, level: number, opts: { force?: boolean } = {}) {
  const readiness = await leagueOpenReadiness(metricKey, level);
  if (readiness.isOpen) {
    return { ...readiness, opened: false, promotedUsers: 0, reason: "already_open" as const };
  }

  if (readiness.requiredEntrants === 0 && !opts.force) {
    throw new LeagueError(
      "no_active_race_types",
      `${metricKey} league ${level} has no active race type — opening it would place users somewhere with nothing to enter.`
    );
  }
  if (!readiness.ready && !opts.force) {
    throw new LeagueError(
      "insufficient_qualified_users",
      `${metricKey} league ${level} has ${readiness.qualifiedCount} qualified users; its largest format needs ${readiness.requiredEntrants} entrants per race (recommended minimum ${readiness.recommendedMinimum}). Races here would likely fail to fill and refund. Re-run with force to open anyway.`
    );
  }

  const now = new Date();
  const promotedUsers = await prisma.$transaction(async (tx) => {
    await tx.leagueLevel.update({
      where: { metricKey_level: { metricKey, level } },
      data: { isOpen: true, openedAt: now },
    });
    // Promotion-only sweep, scoped to this metric: `lt` is what keeps it from
    // ever lowering anyone.
    const result = await tx.userLeagueState.updateMany({
      where: { metricKey, qualifiedLevel: { gte: level }, currentLevel: { lt: level } },
      data: { currentLevel: level, promotedAt: now },
    });
    return result.count;
  });

  return { ...readiness, isOpen: true, opened: true, promotedUsers, reason: null };
}

export type MetricStanding = {
  metricKey: string;
  metricName: string;
  totalPoints: number;
  racesEntered: number;
  racesWon: number;
  currentLeague: { level: number; name: string; minPoints: number } | null;
  nextLeague: { level: number; name: string; minPoints: number; isOpen: boolean } | null;
  pointsToNextLeague: number | null;
  bandProgress: number | null;
  qualifiedForUnopenedLevel: number | null;
};

/** One metric's standing, shaped for display. */
export async function getMetricStanding(userId: string, metricKey: string): Promise<MetricStanding> {
  const state = await prisma.userLeagueState.findUnique({ where: { userId_metricKey: { userId, metricKey } } })
    ?? await getOrCreateLeagueState(userId, metricKey);
  const [metric, current, next] = await Promise.all([
    prisma.metricTypeDefinition.findUnique({ where: { key: metricKey } }),
    prisma.leagueLevel.findUnique({ where: { metricKey_level: { metricKey, level: state.currentLevel } } }),
    prisma.leagueLevel.findFirst({
      where: { metricKey, level: { gt: state.currentLevel } },
      orderBy: { level: "asc" },
    }),
  ]);

  return standingFromRows(state, metric?.displayName ?? metricKey, current, next);
}

function standingFromRows(
  state: UserLeagueState,
  metricName: string,
  current: LeagueLevel | null,
  next: LeagueLevel | null,
): MetricStanding {
  const bandFloor = current?.minPoints ?? 0;
  const bandCeiling = next?.minPoints ?? null;

  return {
    metricKey: state.metricKey,
    metricName,
    totalPoints: state.totalPoints,
    racesEntered: state.racesEntered,
    racesWon: state.racesWon,
    currentLeague: current ? { level: current.level, name: current.name, minPoints: current.minPoints } : null,
    nextLeague: next
      ? { level: next.level, name: next.name, minPoints: next.minPoints, isOpen: next.isOpen }
      : null,
    pointsToNextLeague: next ? Math.max(0, next.minPoints - state.totalPoints) : null,
    bandProgress:
      bandCeiling && bandCeiling > bandFloor
        ? Math.min(1, Math.max(0, (state.totalPoints - bandFloor) / (bandCeiling - bandFloor)))
        : null,
    qualifiedForUnopenedLevel: state.qualifiedLevel > state.currentLevel ? state.qualifiedLevel : null,
  };
}

/**
 * All four standings, plus which one to lead with.
 *
 * `primaryMetricKey` is whichever metric the user has raced most — the
 * progression they are actually pushing — falling back to steps for someone
 * who has never raced. Deliberately no combined total and no global rank:
 * summing four independent tracks would invent a number that means nothing.
 */
export async function getLeagueStandings(userId: string) {
  // Profile and league screens need all four tracks. Load their rows in three
  // batched reads instead of four writes followed by twelve individual reads.
  const [states, metrics, levels] = await Promise.all([
    getAllLeagueStates(userId),
    prisma.metricTypeDefinition.findMany({
      where: { key: { in: [...RACE_ELIGIBLE_METRIC_KEYS] } },
      select: { key: true, displayName: true },
    }),
    prisma.leagueLevel.findMany({
      where: { metricKey: { in: [...RACE_ELIGIBLE_METRIC_KEYS] } },
      orderBy: { level: "asc" },
    }),
  ]);
  const names = new Map(metrics.map((metric) => [metric.key, metric.displayName]));
  const standings = states.map((state) => standingFromRows(
    state,
    names.get(state.metricKey) ?? state.metricKey,
    levels.find((level) => level.metricKey === state.metricKey && level.level === state.currentLevel) ?? null,
    levels.find((level) => level.metricKey === state.metricKey && level.level > state.currentLevel) ?? null,
  ));

  const primary = [...standings].sort(
    (a, b) => b.racesEntered - a.racesEntered || b.totalPoints - a.totalPoints
  )[0];

  return {
    standings,
    primaryMetricKey: primary && primary.racesEntered > 0 ? primary.metricKey : "steps",
  };
}

/** Point movements for one user, optionally narrowed to a single metric. */
export async function getPointHistory(userId: string, metricKey?: string, limit = 30) {
  return prisma.racePointEntry.findMany({
    where: { userId, ...(metricKey ? { metricKey } : {}) },
    include: { },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
