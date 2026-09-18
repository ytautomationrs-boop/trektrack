import { prisma } from "./prisma.js";
import { ensurePlatformAccount } from "./platformAccount.js";
import {
  LEAGUE_LEVELS_SEEDED,
  LEAGUE_POINT_BAND,
  MAX_PRIZE_TO_REVENUE_RATIO,
  RACE_ELIGIBLE_METRIC_KEYS,
  isRaceEligibleMetric,
} from "../modules/races/config.js";
import { prizeScheduleForEntryFee } from "../modules/races/pricing.js";

const METRIC_TYPES = [
  {
    key: "steps",
    displayName: "Steps",
    unit: "steps",
    valueType: "COUNT" as const,
    dataSourceCategory: "STEPS" as const,
    icon: "footprints",
    validationRuleKey: "steps.pedometer_corroboration",
    anomalyRuleKey: "steps.baseline_spike",
  },
  {
    key: "running",
    displayName: "Running",
    unit: "km",
    valueType: "DISTANCE_METERS" as const,
    dataSourceCategory: "RUNNING_WORKOUT" as const,
    icon: "running",
    validationRuleKey: "workout.gps_route_required_running",
    anomalyRuleKey: "workout.pace_plausibility",
  },
  {
    key: "cycling",
    displayName: "Cycling",
    unit: "km",
    valueType: "DISTANCE_METERS" as const,
    dataSourceCategory: "CYCLING_WORKOUT" as const,
    icon: "bike",
    validationRuleKey: "workout.gps_route_required",
    anomalyRuleKey: "workout.pace_plausibility",
  },
  {
    key: "swimming",
    displayName: "Swimming",
    unit: "m",
    valueType: "DISTANCE_METERS" as const,
    dataSourceCategory: "SWIMMING_WORKOUT" as const,
    icon: "waves",
    validationRuleKey: "workout.session_required",
    anomalyRuleKey: "workout.pace_plausibility",
  },
];

const LEAGUE_NAMES = ["Bronze", "Iron", "Steel", "Silver", "Gold", "Platinum", "Diamond", "Champion"];
const INDIVIDUAL_ENTRANTS = 10;
const SQUAD_COUNT = 2;
const SQUAD_SIZE = 4;
const LAUNCH_PUBLIC_FORMATS = new Set(["running_1d_individual", "running_7d_individual", "cycling_7d_individual"]);

type RaceTypeSeed = {
  key: string;
  displayName: string;
  format: "INDIVIDUAL" | "SQUAD";
  metricKey: string;
  durationDays: number;
  entrantCount: number;
  squadSize: number | null;
  isActive: boolean;
  allowUserCreated: boolean;
};

type ScheduleSeed = { entryFeeCents: number; prizes: Array<{ position: number; amountCents: number }> };

const INDIVIDUAL_7D_ENTRY_FEE_CENTS = 5000;
const INDIVIDUAL_1D_ENTRY_FEE_CENTS = 2500;
const SQUAD_7D_ENTRY_FEE_CENTS = 5000;
const SQUAD_1D_ENTRY_FEE_CENTS = 2500;

let catalogPromise: Promise<void> | null = null;

export function ensureCompetitionCatalog() {
  catalogPromise ??= seedCompetitionCatalog().catch((err) => {
    catalogPromise = null;
    throw err;
  });
  return catalogPromise;
}

export function getCompetitionRaceTypesPayload() {
  return buildRaceTypes().map((type) => ({
    ...type,
    createdAt: new Date(0).toISOString(),
    totalEntrants: type.entrantCount * (type.squadSize ?? 1),
    metricType: metricTypePayload(type.metricKey),
    schedules: Array.from({ length: LEAGUE_LEVELS_SEEDED }, (_, index) => {
      const leagueLevel = index + 1;
      const scaled = scaleSchedule(baseScheduleFor(type), leagueLevel, type.entrantCount);
      return {
        leagueLevel,
        leagueName: LEAGUE_NAMES[index] ?? `League ${leagueLevel}`,
        leagueIsOpen: leagueLevel === 1,
        entryFeeCents: scaled.entryFeeCents,
        currency: "zar",
        prizes: scaled.prizes,
        totalPrizeCents: scaled.prizes.reduce((sum, prize) => sum + prize.amountCents, 0),
      };
    }),
  }));
}

function metricTypePayload(metricKey: string) {
  const metric = METRIC_TYPES.find((item) => item.key === metricKey);
  if (!metric) throw new Error(`Unknown race metric "${metricKey}".`);
  return {
    key: metric.key,
    displayName: metric.displayName,
    unit: metric.unit,
    valueType: metric.valueType,
    icon: metric.icon,
  };
}

function buildRaceTypes(): RaceTypeSeed[] {
  const types: RaceTypeSeed[] = [];
  for (const metric of RACE_ELIGIBLE_METRIC_KEYS) {
    for (const durationDays of [1, 7] as const) {
      for (const format of ["INDIVIDUAL", "SQUAD"] as const) {
        const key = `${metric}_${durationDays}d_${format === "SQUAD" ? "squad" : "individual"}`;
        const label = metric.charAt(0).toUpperCase() + metric.slice(1);
        types.push({
          key,
          displayName: `${label} · ${durationDays} day${durationDays === 1 ? "" : "s"} · ${format === "SQUAD" ? "Squad" : "Solo"}`,
          format,
          metricKey: metric,
          durationDays,
          entrantCount: format === "SQUAD" ? SQUAD_COUNT : INDIVIDUAL_ENTRANTS,
          squadSize: format === "SQUAD" ? SQUAD_SIZE : null,
          isActive: LAUNCH_PUBLIC_FORMATS.has(key),
          allowUserCreated: true,
        });
      }
    }
  }
  return types;
}

function raceTypeSeedFor(metricKey: string, durationDays: number, format: "INDIVIDUAL" | "SQUAD"): RaceTypeSeed {
  if (!isRaceEligibleMetric(metricKey)) {
    throw new Error(`Metric "${metricKey}" is not race-eligible.`);
  }
  const normalizedDays = Math.trunc(durationDays);
  if (normalizedDays < 1 || normalizedDays > 30) {
    throw new Error("Race duration must be between 1 and 30 days.");
  }
  const key = `${metricKey}_${normalizedDays}d_${format === "SQUAD" ? "squad" : "individual"}`;
  const label = metricKey.charAt(0).toUpperCase() + metricKey.slice(1);
  return {
    key,
    displayName: `${label} · ${normalizedDays} day${normalizedDays === 1 ? "" : "s"} · ${format === "SQUAD" ? "Squad" : "Solo"}`,
    format,
    metricKey,
    durationDays: normalizedDays,
    entrantCount: format === "SQUAD" ? SQUAD_COUNT : INDIVIDUAL_ENTRANTS,
    squadSize: format === "SQUAD" ? SQUAD_SIZE : null,
    isActive: false,
    allowUserCreated: true,
  };
}

function baseScheduleFor(type: RaceTypeSeed): ScheduleSeed {
  const entryFeeCents =
    type.format === "SQUAD"
      ? type.durationDays === 1
        ? SQUAD_1D_ENTRY_FEE_CENTS
        : SQUAD_7D_ENTRY_FEE_CENTS
      : type.durationDays === 1
        ? INDIVIDUAL_1D_ENTRY_FEE_CENTS
        : INDIVIDUAL_7D_ENTRY_FEE_CENTS;
  return { entryFeeCents, prizes: prizeScheduleForEntryFee(entryFeeCents, type.entrantCount) };
}

function scaleSchedule(base: ScheduleSeed, level: number, rankedPositions = 10): ScheduleSeed {
  const entryFeeCents = base.entryFeeCents + (level - 1) * 500;
  return {
    entryFeeCents,
    prizes: prizeScheduleForEntryFee(entryFeeCents, rankedPositions),
  };
}

function assertViable(type: RaceTypeSeed, schedule: ScheduleSeed) {
  const bodies = type.entrantCount * (type.squadSize ?? 1);
  const revenueCents = bodies * schedule.entryFeeCents;
  const prizeCents = schedule.prizes.reduce((sum, p) => sum + p.amountCents, 0);
  if (prizeCents / revenueCents > MAX_PRIZE_TO_REVENUE_RATIO) {
    throw new Error(`Prize schedule for ${type.key} exceeds the fixed-prize margin guardrail.`);
  }
}

async function seedCompetitionCatalog() {
  const [metricCount, leagueCount, raceTypeCount, scheduleCount] = await Promise.all([
    prisma.metricTypeDefinition.count({ where: { key: { in: METRIC_TYPES.map((metric) => metric.key) } } }),
    prisma.leagueLevel.count(),
    prisma.raceType.count(),
    prisma.racePrizeSchedule.count(),
  ]);
  const expectedSchedules = buildRaceTypes().length * LEAGUE_LEVELS_SEEDED;
  const expectedLeagues = METRIC_TYPES.length * LEAGUE_LEVELS_SEEDED;
  if (metricCount >= METRIC_TYPES.length && leagueCount >= expectedLeagues && raceTypeCount >= buildRaceTypes().length && scheduleCount >= expectedSchedules) {
    return;
  }

  await ensurePlatformAccount(prisma);

  for (const metric of METRIC_TYPES) {
    if (!isRaceEligibleMetric(metric.key)) {
      throw new Error(`Metric "${metric.key}" is not race-eligible.`);
    }
    await prisma.metricTypeDefinition.upsert({
      where: { key: metric.key },
      update: metric,
      create: metric,
    });
  }

  for (const metric of METRIC_TYPES) {
    for (let level = 1; level <= LEAGUE_LEVELS_SEEDED; level++) {
      const name = LEAGUE_NAMES[level - 1] ?? `League ${level}`;
      const minPoints = (level - 1) * LEAGUE_POINT_BAND;
      await prisma.leagueLevel.upsert({
        where: { metricKey_level: { metricKey: metric.key, level } },
        update: {
          name,
          minPoints,
          ...(level === 1 ? { isOpen: true, openedAt: new Date() } : {}),
        },
        create: {
          metricKey: metric.key,
          level,
          name,
          minPoints,
          isOpen: level === 1,
          openedAt: level === 1 ? new Date() : null,
        },
      });
    }
  }

  for (const type of buildRaceTypes()) {
    await prisma.raceType.upsert({ where: { key: type.key }, update: type, create: type });

    const base = baseScheduleFor(type);
    for (let level = 1; level <= LEAGUE_LEVELS_SEEDED; level++) {
      const scaled = scaleSchedule(base, level, type.entrantCount);
      assertViable(type, scaled);

      const schedule = await prisma.racePrizeSchedule.upsert({
        where: { raceTypeKey_leagueLevel: { raceTypeKey: type.key, leagueLevel: level } },
        update: { metricKey: type.metricKey, entryFeeCents: scaled.entryFeeCents },
        create: {
          raceTypeKey: type.key,
          metricKey: type.metricKey,
          leagueLevel: level,
          entryFeeCents: scaled.entryFeeCents,
        },
      });

      await prisma.racePrizeTier.deleteMany({ where: { scheduleId: schedule.id } });
      await prisma.racePrizeTier.createMany({
        data: scaled.prizes.map((p) => ({ scheduleId: schedule.id, position: p.position, amountCents: p.amountCents })),
      });
    }
  }
}

export async function ensureRaceTypeForUserCreatedRace(metricKey: string, durationDays: number, format: "INDIVIDUAL" | "SQUAD") {
  await ensureCompetitionCatalog();
  const type = raceTypeSeedFor(metricKey, durationDays, format);

  await prisma.raceType.upsert({ where: { key: type.key }, update: type, create: type });

  const base = baseScheduleFor(type);
  for (let level = 1; level <= LEAGUE_LEVELS_SEEDED; level++) {
    const scaled = scaleSchedule(base, level, type.entrantCount);
    assertViable(type, scaled);
    const schedule = await prisma.racePrizeSchedule.upsert({
      where: { raceTypeKey_leagueLevel: { raceTypeKey: type.key, leagueLevel: level } },
      update: { metricKey: type.metricKey, entryFeeCents: scaled.entryFeeCents },
      create: {
        raceTypeKey: type.key,
        metricKey: type.metricKey,
        leagueLevel: level,
        entryFeeCents: scaled.entryFeeCents,
      },
    });
    await prisma.racePrizeTier.deleteMany({ where: { scheduleId: schedule.id } });
    await prisma.racePrizeTier.createMany({
      data: scaled.prizes.map((p) => ({ scheduleId: schedule.id, position: p.position, amountCents: p.amountCents })),
    });
  }

  return type;
}
