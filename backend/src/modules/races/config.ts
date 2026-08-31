// Fixed-prize races — tunable constants.
//
// Anything that varies per race type, per league, or per prize position is
// DATA (RaceType / RacePrizeSchedule / RacePrizeTier rows, seeded by
// prisma/seedRaces.ts), not a constant here. What lives in this file is the
// stuff that is genuinely platform-wide policy.

/**
 * Metrics a race may be run on. Sleep is deliberately absent: it stays
 * available to the pooled-payout model, but is excluded from races and
 * leagues entirely.
 *
 * This is the enforcement point — RaceType rows are validated against it at
 * seed time and at admin-create time, rather than relying on nobody ever
 * typing "sleep" into a config row.
 */
export const RACE_ELIGIBLE_METRIC_KEYS = ["steps", "running", "cycling", "swimming"] as const;
export type RaceEligibleMetricKey = (typeof RACE_ELIGIBLE_METRIC_KEYS)[number];

export function isRaceEligibleMetric(key: string): key is RaceEligibleMetricKey {
  return (RACE_ELIGIBLE_METRIC_KEYS as readonly string[]).includes(key);
}

/**
 * A race is SINGLE-METRIC by construction — RaceType carries one metricKey,
 * not a list. There is no fair, non-arbitrary way to weight (say) swum
 * metres against run metres in one ranked ordering, so the model simply
 * cannot express a mixed-metric race. Exported as a named constant so the
 * intent is greppable rather than implicit in the schema shape.
 */
export const RACE_METRICS_PER_RACE = 1;

// ─────────────────────────────────────────────────────────────────────────
// League points
// ─────────────────────────────────────────────────────────────────────────

/** Points for finishing first, in any race format. */
export const POINTS_FIRST_PLACE = 5;
/** Points for finishing last, in any race format. */
export const POINTS_LAST_PLACE = -4;

/**
 * Position → points, spread linearly from POINTS_FIRST_PLACE down to
 * POINTS_LAST_PLACE across however many finishing positions the race has.
 *
 * This one formula reproduces both scales in the spec exactly:
 *   10 positions → 5, 4, 3, 2, 1, 0, -1, -2, -3, -4
 *    4 positions → 5, 2, -1, -4          (squad races, ranked among 4 squads)
 * so a future 6-entrant or 20-entrant format needs no new table of numbers,
 * and the endpoints stay meaningful: winning is always +5, coming last is
 * always -4, regardless of field size.
 *
 * `positionCount` is the number of RANKED SLOTS, which for a squad race is
 * the number of squads (4), not the number of people (16) — every member of
 * a squad receives that squad's points.
 */
export function pointsForPosition(position: number, positionCount: number): number {
  if (position < 1 || position > positionCount) {
    throw new Error(`position ${position} out of range for a ${positionCount}-slot race`);
  }
  if (positionCount === 1) return POINTS_FIRST_PLACE;
  const span = POINTS_FIRST_PLACE - POINTS_LAST_PLACE;
  const raw = POINTS_FIRST_PLACE - (span * (position - 1)) / (positionCount - 1);
  return Math.round(raw);
}

/**
 * Lifetime point totals are floored at zero.
 *
 * Points still move down from bad results — a 10th place is a real -4
 * against the total — but a user's visible number never goes negative. Same
 * reasoning as removing the global rank: a new entrant staring at "-4" after
 * one bad week is the discouragement the league system exists to avoid. The
 * un-floored delta is preserved in RacePointEntry for audit.
 */
export const POINTS_FLOOR = 0;

/**
 * Width of a league band, in points. Narrow and closely spaced on purpose:
 * frequent visible promotions beat one slowly-moving number (see README
 * "Why narrow leagues").
 *
 * At 15: two wins (10) plus a 2nd and a 3rd (4 + 3) promotes. Only used by
 * the seed to generate LeagueLevel.minPoints — once seeded, the thresholds
 * are the rows, and re-banding is an UPDATE rather than a redeploy.
 */
export const LEAGUE_POINT_BAND = 15;

/** Number of league levels the seed creates. Only level 1 is open at launch. */
export const LEAGUE_LEVELS_SEEDED = 6;

// ─────────────────────────────────────────────────────────────────────────
// Fill-rate protection
// ─────────────────────────────────────────────────────────────────────────

/**
 * How many qualified users a league needs before it can be opened.
 *
 * The failure mode this guards is specific and severe: a league whose races
 * cannot reach their exact headcount produces nothing but cancelled races
 * and refunds, and it strands exactly the users who earned their way there.
 * A level is only worth opening once enough people can fill its largest
 * format more than once over — hence the multiplier rather than a bare
 * headcount.
 *
 * Advisory, not a hard lock: openLeagueLevel() reports the shortfall and
 * requires an explicit force flag to open under it.
 */
export const LEAGUE_OPEN_FILL_MULTIPLIER = 2.5;

/**
 * Guardrail on prize schedules. Unlike a pooled payout, a fixed prize is
 * owed at the same amount regardless of turnout, so the platform carries the
 * downside: a full race whose prizes exceed its entry-fee revenue loses
 * money every single time it runs, by design rather than by accident.
 *
 * Schedules over this ratio of expected revenue are rejected unless
 * explicitly marked as a deliberate loss-leader. 1.0 would be exactly
 * break-even; 0.85 leaves a 15% margin.
 */
export const MAX_PRIZE_TO_REVENUE_RATIO = 0.85;

/**
 * Prize money for a winning entrant whose evidence carries an unresolved
 * anomaly flag is held rather than paid, for this long, to give review a
 * window before the money moves.
 */
export const RACE_PRIZE_REVIEW_HOLD_HOURS = 48;

/**
 * A race always scores a user's FULL, unsplit total for its metric. Being in
 * two concurrent steps races means the same steps count toward both.
 *
 * That is deliberate, not an oversight. Each race's prize is fixed and
 * independent, so there is no shared pot to double-dip: what one entrant
 * scores never reduces what another can win. Splitting a user's real activity
 * across their concurrent races would instead rank them on a partial total
 * against rivals scored on full ones — a structural disadvantage invisible to
 * the user. And the alternative rule, one active race per metric, would cut
 * fill rates at exactly the volume where filling is already the binding
 * constraint.
 */
export const RACES_SCORE_FULL_UNSPLIT_TOTAL = true;

// ─────────────────────────────────────────────────────────────────────────
// Race start scheduling
// ─────────────────────────────────────────────────────────────────────────

/**
 * Anchor timezone for a PUBLIC (platform-opened) race's "next midnight"
 * start. A race can have up to sixteen entrants, each with their own locked
 * timezone, so the start moment cannot depend on any one of them — it is
 * fixed once, at race creation, and never revisited.
 *
 * A PRIVATE race uses its creator's timezone instead (see
 * createPrivateRaceAndEnter in service.ts). Matches the platform account's
 * timezone from the seed and the wallet's ZAR currency.
 */
export const PLATFORM_DEFAULT_TIMEZONE = "Africa/Johannesburg";
