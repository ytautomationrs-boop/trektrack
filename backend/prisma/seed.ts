import { PrismaClient } from "@prisma/client";
import {
  LEAGUE_LEVELS_SEEDED,
  LEAGUE_POINT_BAND,
  MAX_PRIZE_TO_REVENUE_RATIO,
  RACE_ELIGIBLE_METRIC_KEYS,
  isRaceEligibleMetric,
} from "../src/modules/races/config.js";
import { PLATFORM_ACCOUNT_EMAIL } from "../src/lib/constants.js";

/**
 * Seeds everything the app needs to run: the platform account, the metric
 * registry, league levels, race formats, and the standing prize schedules.
 *
 *   npm run seed
 *
 * Idempotent — re-running upserts rather than duplicating, so editing a
 * prize schedule here and re-seeding is a supported way to change config.
 * That only affects FUTURE races: every race snapshots its schedule at
 * creation, so re-seeding can never change what an open or finished race
 * pays the people already in it.
 */

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────
// Metrics
//
// Four RACE-ELIGIBLE metrics below, seeded through isRaceEligibleMetric —
// none of them carry a min/max/default target, step size, beginner/advanced
// preset or pace-target flag, because a race ranks on a cumulative total and
// has no daily target to configure.
//
// `sleep`, further down (STREAKPOT_ONLY_METRIC_TYPES), is the opposite case:
// it CANNOT be raced fairly (more sleep is not a better performance), but is
// exactly the shape StreakPot's personal-target format wants, so it carries
// the full target-config columns and is seeded through its own loop that
// skips the race-eligibility check entirely.
// ─────────────────────────────────────────────────────────────────────────
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
    // Every DISTANCE_METERS metric is stored and compared in metres. `unit`
    // is a display label only — "km" reads better for running/cycling,
    // raw metres for swimming.
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

// StreakPot-only. Recovered from the pre-cleanup DB backup — see
// prisma/migrations/20260826210000_streakpot_and_pilot_gating for the
// schema side of this restoration.
const STREAKPOT_ONLY_METRIC_TYPES = [
  {
    key: "sleep",
    displayName: "Sleep",
    unit: "hours",
    valueType: "HOURS" as const,
    dataSourceCategory: "SLEEP" as const,
    icon: "moon",
    validationRuleKey: "sleep.wearable_stage_preferred",
    anomalyRuleKey: "sleep.stationary_only_flag",
    minTarget: 5,
    maxTarget: 10,
    defaultTarget: 7.5,
    beginnerTarget: 6.5,
    advancedTarget: 8,
    stepSize: 0.5,
    supportsPaceTarget: false,
    vizType: "BAR" as const,
  },
];

// Starter badges — StreakPot gamification, restored alongside the model
// that awards them. Awarding logic lives with the challenge resolution
// code; this is just the registry of what CAN be earned.
const BADGES = [
  { key: "first_finish", displayName: "First Finish", description: "Completed your first StreakPot challenge.", icon: "flag" },
  { key: "seven_day_streak", displayName: "7-Day Streak", description: "Passed 7 check-ins in a row without a miss.", icon: "flame" },
  { key: "perfect_pool", displayName: "Perfect Pool", description: "Finished a challenge with zero missed days and no redemption used.", icon: "trophy" },
];

const LEAGUE_NAMES = ["Bronze", "Iron", "Steel", "Silver", "Gold", "Platinum", "Diamond", "Champion"];

// ─────────────────────────────────────────────────────────────────────────
// Race formats
//
// The full grid: 4 metrics × 2 durations (1 or 7 days) × 2 formats
// (individual / squad) = 16.
//
// `isActive` = the platform auto-opens a PUBLIC race of this format per open
// league. Deliberately only three at launch: each active format is another
// pool competing for the same entrants, and a pool that cannot reach its
// exact headcount produces nothing but cancelled races and refunds.
//
// `allowUserCreated` = a user may create a PRIVATE race of this format. All
// sixteen, because a private race brings its own entrants — the creator
// recruits them — so it never competes for the shared public pool.
// ─────────────────────────────────────────────────────────────────────────
const INDIVIDUAL_ENTRANTS = 10; // exactly ten racers
const SQUAD_COUNT = 4; // exactly four squads
const SQUAD_SIZE = 4; // of exactly four members each

// Running and cycling, NOT steps — and that is the whole point.
//
// Evidence now comes from a workout file the user exports from a watch or
// training app (see modules/imports/workoutFile.ts). A workout file describes
// an ACTIVITY: running, cycling and swimming have one, steps and sleep do
// not, because those are daily totals a phone accumulates rather than
// something a watch writes a file for.
//
// So a steps race is currently unscoreable — every entrant would finish on
// zero however far they actually walked. Auto-opening steps races would take
// entry fees for competitions nobody can win. This list previously held the
// three steps formats, from when HealthKit and Health Connect were the
// evidence path and steps was the flagship metric.
//
// Still deliberately short: each active format is another pool competing for
// the same entrants, and a pool that cannot reach its exact headcount
// produces nothing but cancelled races and refunds. Three formats, one
// metric-and-duration each, so the pilot's ~50 people can actually fill one.
//
// Put steps back the moment there is a way to verify it — a native build
// reading Health Connect, or a health-app export importer.
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

function buildRaceTypes(): RaceTypeSeed[] {
  const types: RaceTypeSeed[] = [];
  for (const metric of RACE_ELIGIBLE_METRIC_KEYS) {
    for (const durationDays of [1, 7]) {
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

// ─────────────────────────────────────────────────────────────────────────
// Prize schedules — league 1 baseline, scaled per league. Cents (ZAR).
//
// Individual races pay 1st–5th out of 10: half the field wins something,
// which keeps the negative half of the points scale from feeling like the
// default outcome. Squad races pay one prize to the winning squad, split
// evenly among its members at payout.
//
// Every amount is a whole multiple of R5 on purpose — scaleSchedule() rounds
// to the nearest R5, and a base with half-rand amounts would be rounded up
// even at league 1, quietly eroding the intended margin.
// ─────────────────────────────────────────────────────────────────────────
type ScheduleSeed = { entryFeeCents: number; prizes: Array<{ position: number; amountCents: number }> };

const INDIVIDUAL_7D: ScheduleSeed = {
  entryFeeCents: 5000, // R50 × 10 = R500 revenue
  prizes: [
    { position: 1, amountCents: 15000 },
    { position: 2, amountCents: 10000 },
    { position: 3, amountCents: 7500 },
    { position: 4, amountCents: 5000 },
    { position: 5, amountCents: 2500 },
  ], // R400 — 20% margin
};

const INDIVIDUAL_1D: ScheduleSeed = {
  entryFeeCents: 2500, // R25 × 10 = R250 revenue
  prizes: [
    { position: 1, amountCents: 7500 },
    { position: 2, amountCents: 5000 },
    { position: 3, amountCents: 3500 },
    { position: 4, amountCents: 2500 },
    { position: 5, amountCents: 1500 },
  ], // R200 — 20% margin
};

// 4 squads × 4 members = 16 entrants.
const SQUAD_7D: ScheduleSeed = {
  entryFeeCents: 5000, // R50 × 16 = R800 revenue
  prizes: [{ position: 1, amountCents: 60000 }], // R600 — 25% margin, R150 each
};

const SQUAD_1D: ScheduleSeed = {
  entryFeeCents: 2500, // R25 × 16 = R400 revenue
  prizes: [{ position: 1, amountCents: 30000 }], // R300 — 25% margin, R75 each
};

function baseScheduleFor(type: RaceTypeSeed): ScheduleSeed {
  if (type.format === "SQUAD") return type.durationDays === 1 ? SQUAD_1D : SQUAD_7D;
  return type.durationDays === 1 ? INDIVIDUAL_1D : INDIVIDUAL_7D;
}

/**
 * Higher leagues are higher stakes. Fee and prizes scale by the same factor,
 * so the platform margin is identical at every level — a league changes how
 * much is at risk, never how good a deal it is.
 */
/**
 * Flat, additive entry-fee curve: +R5 per league level, same absolute step
 * for every format. Prizes scale PROPORTIONALLY to how far the entry fee has
 * moved from its League 1 base, which is what keeps the margin percentage
 * roughly constant across levels without hand-tuning every prize tier
 * separately — a flat fee bump alone, with prizes held constant, would erode
 * margin at every level up.
 *
 * Both numbers are still fixed, pre-announced constants read from a config
 * table at race-creation time — never derived from a specific race's actual
 * entrants. The correlation between league and price is tiering (a
 * "premium" bracket costs and pays more), not pool redistribution: a given
 * league's race always pays the same fixed prize regardless of how long it
 * took to fill.
 */
function scaleSchedule(base: ScheduleSeed, level: number): ScheduleSeed {
  const FLAT_INCREMENT_CENTS = 500; // R5 per level, every format
  const entryFeeCents = base.entryFeeCents + (level - 1) * FLAT_INCREMENT_CENTS;
  const ratio = entryFeeCents / base.entryFeeCents;
  const round = (cents: number) => Math.round(cents / 500) * 500; // nearest R5
  return {
    entryFeeCents,
    prizes: base.prizes.map((p) => ({ position: p.position, amountCents: round(p.amountCents * ratio) })),
  };
}

/**
 * Refuses to seed a schedule that would lose money on a full race.
 *
 * This guards the structural difference from a pooled payout: there, the
 * payout is bounded by the pot and the platform cannot lose. Here the prize
 * is fixed and the platform carries the downside, so an accidentally
 * generous schedule is a standing loss on every race it runs, not a one-off.
 */
function assertViable(type: RaceTypeSeed, level: number, schedule: ScheduleSeed) {
  const bodies = type.entrantCount * (type.squadSize ?? 1);
  const revenueCents = bodies * schedule.entryFeeCents;
  const prizeCents = schedule.prizes.reduce((sum, p) => sum + p.amountCents, 0);
  const ratio = prizeCents / revenueCents;

  if (ratio > MAX_PRIZE_TO_REVENUE_RATIO) {
    throw new Error(
      `Prize schedule for ${type.key} league ${level} pays R${prizeCents / 100} against R${revenueCents / 100} of entry revenue ` +
        `(${Math.round(ratio * 100)}%, limit ${Math.round(MAX_PRIZE_TO_REVENUE_RATIO * 100)}%). ` +
        `A fixed prize is owed regardless of turnout, so this loses money on every race it runs.`
    );
  }
  return { revenueCents, prizeCents, ratio };
}

async function main() {
  // ── Platform account ───────────────────────────────────────────────────
  // Entry-fee revenue and prize expense are booked against this account, so
  // the ledger balances without a separate accounting system.
  await prisma.user.upsert({
    where: { email: PLATFORM_ACCOUNT_EMAIL },
    update: {},
    create: {
      email: PLATFORM_ACCOUNT_EMAIL,
      // Not a login. No password hash will ever match this value.
      passwordHash: "!platform-account-no-login!",
      displayName: "Streak Platform",
      timezone: "Africa/Johannesburg",
    },
  });
  console.log(`Platform account ready (${PLATFORM_ACCOUNT_EMAIL}).`);

  // ── Metrics ────────────────────────────────────────────────────────────
  for (const metric of METRIC_TYPES) {
    if (!isRaceEligibleMetric(metric.key)) {
      throw new Error(`Metric "${metric.key}" is not race-eligible — it cannot be seeded.`);
    }
    await prisma.metricTypeDefinition.upsert({
      where: { key: metric.key },
      update: metric,
      create: metric,
    });
  }
  for (const metric of STREAKPOT_ONLY_METRIC_TYPES) {
    await prisma.metricTypeDefinition.upsert({
      where: { key: metric.key },
      update: metric,
      create: metric,
    });
  }
  const seededKeys = [...METRIC_TYPES, ...STREAKPOT_ONLY_METRIC_TYPES].map((m) => m.key);
  // Anything left over from an even earlier registry change is removed
  // rather than left inactive — an unreachable metric row is exactly the
  // kind of remnant that gets re-enabled by accident later.
  const removed = await prisma.metricTypeDefinition.deleteMany({ where: { key: { notIn: seededKeys } } });
  console.log(`Seeded ${seededKeys.length} metrics${removed.count ? ` (removed ${removed.count} stale)` : ""}.`);

  // ── Badges ─────────────────────────────────────────────────────────────
  for (const badge of BADGES) {
    await prisma.badge.upsert({ where: { key: badge.key }, update: badge, create: badge });
  }
  console.log(`Seeded ${BADGES.length} badges.`);

  // ── Leagues, per metric ────────────────────────────────────────────────
  //
  // Every metric gets its OWN ladder. A user's running league and swimming
  // league are independent progressions, so "League 3" is only meaningful
  // alongside the metric it belongs to.
  //
  // The bands are seeded identically across all four today — same names,
  // same 15-point thresholds — so they behave like shared configuration.
  // They are stored per metric so a single metric can be retuned later
  // (swimming promoting faster because the field is thinner, say) without a
  // migration or disturbing the others.
  for (const metric of METRIC_TYPES) {
    for (let level = 1; level <= LEAGUE_LEVELS_SEEDED; level++) {
      const name = LEAGUE_NAMES[level - 1] ?? `League ${level}`;
      const minPoints = (level - 1) * LEAGUE_POINT_BAND;
      await prisma.leagueLevel.upsert({
        where: { metricKey_level: { metricKey: metric.key, level } },
        update: { name, minPoints },
        create: {
          metricKey: metric.key,
          level,
          name,
          minPoints,
          // Only level 1 opens at launch, in every metric. Users accrue
          // points toward higher levels from day one and are promoted in
          // bulk when one opens — per metric, since readiness differs.
          isOpen: level === 1,
          openedAt: level === 1 ? new Date() : null,
        },
      });
    }
  }
  console.log(
    `Seeded ${METRIC_TYPES.length} × ${LEAGUE_LEVELS_SEEDED} leagues (${LEAGUE_POINT_BAND}-point bands, identical per metric); level 1 open in each.`
  );

  // ── Race formats + prize schedules ─────────────────────────────────────
  const raceTypes = buildRaceTypes();
  for (const type of raceTypes) {
    await prisma.raceType.upsert({ where: { key: type.key }, update: type, create: type });

    const base = baseScheduleFor(type);
    for (let level = 1; level <= LEAGUE_LEVELS_SEEDED; level++) {
      const scaled = scaleSchedule(base, level);
      assertViable(type, level, scaled);

      const schedule = await prisma.racePrizeSchedule.upsert({
        where: { raceTypeKey_leagueLevel: { raceTypeKey: type.key, leagueLevel: level } },
        update: { entryFeeCents: scaled.entryFeeCents, metricKey: type.metricKey },
        // metricKey is duplicated from the race type so the league relation
        // (metricKey, leagueLevel) has its scalar locally — see schema.
        create: {
          raceTypeKey: type.key,
          metricKey: type.metricKey,
          leagueLevel: level,
          entryFeeCents: scaled.entryFeeCents,
        },
      });

      // Replaced wholesale rather than diffed — a schedule is a small,
      // complete statement of what a race pays, and a partial update could
      // leave a stale position behind.
      await prisma.racePrizeTier.deleteMany({ where: { scheduleId: schedule.id } });
      await prisma.racePrizeTier.createMany({
        data: scaled.prizes.map((p) => ({ scheduleId: schedule.id, position: p.position, amountCents: p.amountCents })),
      });
    }
  }

  const active = raceTypes.filter((t) => t.isActive);
  console.log(`Seeded ${raceTypes.length} race formats × ${LEAGUE_LEVELS_SEEDED} leagues.`);
  console.log(`  public at launch: ${active.map((t) => t.key).join(", ")}`);
  console.log(`  user-creatable (private): all ${raceTypes.length}`);
  for (const t of active) {
    const s = baseScheduleFor(t);
    const v = assertViable(t, 1, s);
    console.log(
      `  ${t.key} L1: R${s.entryFeeCents / 100} × ${t.entrantCount * (t.squadSize ?? 1)} = R${v.revenueCents / 100} in, ` +
        `R${v.prizeCents / 100} prizes (${Math.round((1 - v.ratio) * 100)}% margin)`
    );
  }
  console.log("\nOnly league 1 is open — check GET /admin/leagues/readiness before opening level 2.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
