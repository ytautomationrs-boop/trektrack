import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { ensurePlatformAccount } from "../../lib/platformAccount.js";
import { getAllLeagueStates, getOrCreateLeagueState } from "./leagues.js";
import { isRaceEligibleMetric, PLATFORM_DEFAULT_TIMEZONE } from "./config.js";
import { nextMidnightInTimeZone } from "./scheduling.js";
import { notifyUsers } from "../notifications/service.js";
import { prizeScheduleForEntryFee, totalPrizeCents as sumPrizeCents } from "./pricing.js";
import { grantSponsoredCredit } from "../wallet/service.js";
import type { Race, RaceEntry, RaceType } from "@prisma/client";

/**
 * Race lifecycle: creating races from standing config, entering and
 * withdrawing from them, locking + scheduling their start the instant the
 * exact headcount is reached, and starting them at that scheduled instant.
 *
 * The one thing worth reading carefully in this file is enterRace(). The
 * "exactly N entrants" rule is the whole legal and product premise of the
 * model, so it cannot be a count-then-insert — two concurrent 10th entrants
 * would both read 9 and both insert. Every entry therefore takes a row lock
 * on the Race first (SELECT ... FOR UPDATE), which serialises entries to the
 * same race and makes the count-then-insert safe by construction. Entries to
 * *different* races never contend.
 *
 * ## Fill is indefinite
 *
 * A race waits for its exact headcount with NO deadline. There is no
 * "signup window" any more, and no automatic cancellation — a race sits in
 * FILLING for however long it takes, and an entrant can withdraw (full
 * refund) at any point while it is still FILLING. The only cancellation path
 * left is `adminCancelRace`, a manual operator action for a race that has
 * been waiting for so long it's clearly never going to fill — never
 * time-triggered.
 *
 * ## Lock, then scheduled start
 *
 * Reaching the exact headcount LOCKS the race immediately: no further
 * entrants, no more withdrawals, fees become revenue, the prize commitment
 * becomes unconditional. That is the race's existence condition, and it is
 * still met the instant the last slot fills — nothing about scheduling the
 * start changes that.
 *
 * What changes is WHEN scoring begins: rather than starting the moment it
 * locks, a race starts at the next local midnight in its `anchorTimezone`
 * (the creator's timezone for a private race, a platform default for a
 * public one — fixed at creation so it can never depend on who happens to
 * fill the last slot). `startLockedRaces` flips LOCKED → RUNNING once that
 * instant arrives.
 */

export class RaceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type PrizeSnapshotEntry = { position: number; amountCents: number };

/** Reads the frozen prize schedule off a race. Stored as JSON, so it needs one narrowing point rather than casts scattered around. */
export function prizeSnapshotOf(race: Pick<Race, "prizeSnapshot">): PrizeSnapshotEntry[] {
  const raw = race.prizeSnapshot as unknown;
  if (!Array.isArray(raw)) return [];
  return raw as PrizeSnapshotEntry[];
}

/** Total bodies a race needs: entrants for an individual race, squads × members for a squad race. */
export function requiredEntrantBodies(race: Pick<Race, "entrantCount" | "squadSize" | "format">): number {
  return race.format === "SQUAD" ? race.entrantCount * (race.squadSize ?? 1) : race.entrantCount;
}

// ─────────────────────────────────────────────────────────────────────────
// Creating races from standing config
// ─────────────────────────────────────────────────────────────────────────

export type CreateRaceOptions = {
  now?: Date;
  /** Display name. Generated from the format when omitted (platform races). */
  name?: string;
  /**
   * PUBLIC races are platform-opened and draw on the shared league pool.
   * PRIVATE races are user-created and bring their own entrants.
   */
  visibility?: "PUBLIC" | "PRIVATE";
  /** Set for user-created races. */
  createdByUserId?: string;
  /**
   * The timezone "next midnight" is computed against once this race LOCKS.
   * Defaults to the platform default — callers creating a private race
   * should pass the creator's own timezone instead.
   */
  anchorTimezone?: string;
  /** Private/user-created races may snapshot a host-chosen entry fee. */
  entryFeeCents?: number;
};

/** Readable default name for a platform-opened race. */
function defaultRaceName(metricKey: string, durationDays: number, format: "INDIVIDUAL" | "SQUAD"): string {
  const metric = metricKey.charAt(0).toUpperCase() + metricKey.slice(1);
  return `${metric} · ${durationDays}-day ${format === "SQUAD" ? "squad" : "solo"}`;
}

/**
 * Creates one race of `raceTypeKey` in `leagueLevel`, snapshotting the fee
 * and prize schedule up front. Platform-created races use the standing
 * schedule. Private races can carry a host-chosen entry fee, with prizes
 * calculated from that fee and frozen onto the race row.
 */
export async function createRace(
  raceTypeKey: string,
  leagueLevel: number,
  opts: CreateRaceOptions | Date = {}
) {
  // Callers used to pass a bare Date; keep that working.
  const options: CreateRaceOptions = opts instanceof Date ? { now: opts } : opts;
  const now = options.now ?? new Date();
  const visibility = options.visibility ?? "PUBLIC";

  const schedule = await prisma.racePrizeSchedule.findUnique({
    where: { raceTypeKey_leagueLevel: { raceTypeKey, leagueLevel } },
    include: { raceType: true, tiers: { orderBy: { position: "asc" } }, league: true },
  });
  if (!schedule) {
    throw new RaceError("no_schedule", `No prize schedule for race type "${raceTypeKey}" in league ${leagueLevel}.`);
  }
  if (!schedule.league.isOpen) {
    throw new RaceError("league_closed", `League ${leagueLevel} is not open.`);
  }
  // isActive governs whether the PLATFORM runs this format publicly.
  // allowUserCreated governs whether a host may create it, whether they make
  // that hosted race public or invite-only.
  if (visibility === "PUBLIC" && !options.createdByUserId && !schedule.raceType.isActive) {
    throw new RaceError("race_type_inactive", `Race type "${raceTypeKey}" is not active.`);
  }
  if (options.createdByUserId && !schedule.raceType.allowUserCreated) {
    throw new RaceError("race_type_not_user_creatable", `Race type "${raceTypeKey}" can't be created by users.`);
  }
  if (!isRaceEligibleMetric(schedule.raceType.metricKey)) {
    // Belt and braces against a config row for a metric the model excludes —
    // the seed validates this too, but a race is where it would matter.
    throw new RaceError("metric_not_race_eligible", `"${schedule.raceType.metricKey}" is not eligible for races.`);
  }

  const entryFeeCents = options.entryFeeCents ?? schedule.entryFeeCents;
  const prizeSnapshot: PrizeSnapshotEntry[] =
    options.entryFeeCents == null
      ? schedule.tiers.map((t) => ({ position: t.position, amountCents: t.amountCents }))
      : prizeScheduleForEntryFee(entryFeeCents, schedule.raceType.entrantCount);
  const totalPrizeCents = sumPrizeCents(prizeSnapshot);

  return prisma.race.create({
    data: {
      name: options.name?.trim() || defaultRaceName(schedule.raceType.metricKey, schedule.raceType.durationDays, schedule.raceType.format),
      raceTypeKey,
      leagueLevel,
      scheduleId: schedule.id,
      status: "FILLING",
      visibility,
      createdByUserId: options.createdByUserId ?? null,
      anchorTimezone: options.anchorTimezone ?? PLATFORM_DEFAULT_TIMEZONE,
      // Private races are joined by code; public ones are found by browsing.
      inviteCode: visibility === "PRIVATE" ? generateInviteCode() : null,
      metricKey: schedule.raceType.metricKey,
      format: schedule.raceType.format,
      durationDays: schedule.raceType.durationDays,
      entrantCount: schedule.raceType.entrantCount,
      squadSize: schedule.raceType.squadSize,
      entryFeeCents,
      currency: schedule.currency,
      prizeSnapshot: prizeSnapshot as unknown as Prisma.InputJsonValue,
      totalPrizeCents,
      signupOpensAt: now,
      // No signupClosesAt — fill is indefinite, there is no deadline.
    },
  });
}

/**
 * Creates a PRIVATE race and enters its creator as the first entrant, in one
 * transaction-ish flow.
 *
 * The creator is charged the race's entry fee immediately. That is
 * deliberate: it stops drive-by race creation from burying the few real
 * races in empty ones nobody committed to, and it makes the creator
 * entrant 1 of N rather than an organiser standing outside their own race.
 *
 * The race's `anchorTimezone` is the creator's own timezone — the one
 * meaningful, unambiguous choice available for a private race, since there
 * is exactly one person deciding to create it.
 *
 * If the creation succeeds but the entry fails (most likely: insufficient
 * balance), the empty race is removed rather than left orphaned.
 */
export async function createPrivateRaceAndEnter(params: {
  userId: string;
  raceTypeKey: string;
  name: string;
  visibility?: "PUBLIC" | "PRIVATE";
  entryFeeCents?: number;
  squadName?: string;
  squadJoinPolicy?: "INVITE_ONLY" | "OPEN";
}) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { timezone: true, isAdmin: true, walletBalanceCents: true },
  });

  // The race runs in the creator's league FOR THIS RACE'S METRIC — someone
  // deep in the running leagues still creates a swimming race at their
  // swimming level, which for a first-time swimmer is League 1.
  const raceType = await prisma.raceType.findUnique({ where: { key: params.raceTypeKey } });
  if (!raceType) {
    throw new RaceError("unknown_race_type", `No race type "${params.raceTypeKey}".`);
  }
  const leagueState = await getOrCreateLeagueState(params.userId, raceType.metricKey);

  const race = await createRace(params.raceTypeKey, leagueState.currentLevel, {
    name: params.name,
    visibility: params.visibility ?? "PRIVATE",
    createdByUserId: params.userId,
    anchorTimezone: user.timezone,
    entryFeeCents: params.entryFeeCents,
  });

  try {
    if (user.isAdmin && user.walletBalanceCents < race.entryFeeCents) {
      await grantSponsoredCredit({
        userId: params.userId,
        amountCents: race.entryFeeCents - user.walletBalanceCents,
        grantRef: `admin-race-create:${race.id}`,
        note: "Automatic admin race creation credit",
        grantedByUserId: params.userId,
      });
    }
    const entry = await enterRace({
      userId: params.userId,
      raceId: race.id,
      // A squad race needs its creator to found the first squad.
      squadName: race.format === "SQUAD" ? params.squadName?.trim() || params.name : undefined,
      squadJoinPolicy: race.format === "SQUAD" ? params.squadJoinPolicy ?? "INVITE_ONLY" : undefined,
    });
    // Decorated, like every other race the API hands back — the client
    // reads prizes/entrantsNow/squads off it, and returning the raw row here
    // would ship a race object missing all of them.
    const decorated = await getRaceForUser(race.id, params.userId);
    return { race: decorated, entry: entry.entry, inviteCode: race.inviteCode };
  } catch (err) {
    await prisma.race.delete({ where: { id: race.id } }).catch(() => {});
    throw err;
  }
}

/**
 * Makes sure every (active race type × open league) has exactly one race
 * currently accepting entrants.
 *
 * One at a time on purpose. Running two FILLING races of the same type in
 * the same league splits the available entrants between them and can leave
 * both short of their exact headcount — at low volume, concentrating signups
 * into a single race is the difference between a race that runs and one that
 * sits waiting forever. A replacement is created as soon as the current one
 * locks (this job runs frequently).
 */
export async function ensureOpenRaces(now = new Date()) {
  const schedules = await prisma.racePrizeSchedule.findMany({
    where: { raceType: { isActive: true }, league: { isOpen: true } },
    include: { raceType: true },
  });

  const created: string[] = [];
  for (const schedule of schedules) {
    const existing = await prisma.race.count({
      where: { raceTypeKey: schedule.raceTypeKey, leagueLevel: schedule.leagueLevel, status: "FILLING" },
    });
    if (existing > 0) continue;
    const race = await createRace(schedule.raceTypeKey, schedule.leagueLevel, {
      now,
      anchorTimezone: PLATFORM_DEFAULT_TIMEZONE,
    });
    created.push(race.id);
  }
  return { created: created.length, raceIds: created };
}

// ─────────────────────────────────────────────────────────────────────────
// Entering / withdrawing
// ─────────────────────────────────────────────────────────────────────────

export type EnterRaceParams = {
  userId: string;
  raceId: string;
  /**
   * Squad races: join this existing squad. Only sufficient on its own for an
   * OPEN squad — an INVITE_ONLY squad also needs squadInviteCode.
   */
  squadId?: string;
  /**
   * Squad races: join whichever squad this code belongs to. The code alone is
   * enough; the joiner does not need to know the squad's id. This is how an
   * invite-only squad is actually joined.
   */
  squadInviteCode?: string;
  /** Squad races: found a new squad with this name and captain it. */
  squadName?: string;
  /**
   * Only meaningful when founding a squad. Defaults to INVITE_ONLY — a
   * captain has to opt in to letting strangers take a seat.
   */
  squadJoinPolicy?: "INVITE_ONLY" | "OPEN";
  /**
   * Explicit opt-in to enter a race in a league BELOW the user's own current
   * league for this metric — the fallback for "nobody else is in my league
   * right now". Without this flag, a lower-league race is refused with
   * `lower_league_available` rather than a flat `wrong_league`, so the
   * client can offer the opt-in rather than dead-ending. A HIGHER-league
   * race is always refused regardless of this flag — there is no equivalent
   * "opt up" path.
   */
  acceptLowerLeague?: boolean;
};

export type EnterRaceResult = {
  entry: RaceEntry;
  race: Race;
  /** True when this entry was the one that completed the headcount and LOCKED the race. */
  lockedRace: boolean;
  entrantsNow: number;
  entrantsRequired: number;
};

/**
 * Enters a user into a race, debiting the entry fee from their wallet.
 *
 * Money: the fee leaves the wallet immediately but is recorded PENDING, not
 * as revenue. It only becomes revenue when the race locks (lockRace below).
 * Until then the race does not exist and the fee is fully refundable —
 * either by the race never filling, or by the entrant withdrawing themselves
 * (see cancelRaceEntry) — which is the ledger expressing the same thing the
 * status enum does.
 *
 * Re-entering after a withdrawal reuses the same row (raceId+userId is
 * unique) rather than erroring — a WITHDRAWN or REFUNDED entry is not an
 * active claim on a slot, so there is nothing stopping the same user from
 * entering again.
 */
export async function enterRace(params: EnterRaceParams): Promise<EnterRaceResult> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: params.userId }, select: { timezone: true } });

  return prisma.$transaction(async (tx) => {
    // Serialises every concurrent entry to THIS race behind one lock, so the
    // headcount check below cannot be raced. Entries to other races proceed
    // in parallel — the lock is per-row, not per-table.
    await tx.$queryRaw`SELECT id FROM "Race" WHERE id = ${params.raceId} FOR UPDATE`;

    const race = await tx.race.findUnique({ where: { id: params.raceId } });
    if (!race) throw new RaceError("not_found", "Race not found.");
    if (race.status !== "FILLING") {
      const messages: Record<string, string> = {
        LOCKED: "This race just reached its headcount and is locked, waiting to start.",
        RUNNING: "This race is already full and under way.",
        RESOLVING: "This race has finished and is being scored.",
        COMPLETED: "This race is already finished.",
        CANCELLED_UNFILLED: "This race was cancelled.",
      };
      throw new RaceError("race_not_open", messages[race.status] ?? "This race is no longer accepting entrants.");
    }

    // League is checked against this user's standing IN THIS RACE'S METRIC.
    // Their running level has no bearing on whether they can enter a
    // swimming race.
    const leagueState = await getOrCreateLeagueState(params.userId, race.metricKey, tx);
    let lowerLeagueOptIn = false;
    if (race.leagueLevel > leagueState.currentLevel) {
      // Jumping UP is never allowed — there is no equivalent opt-in for it.
      throw new RaceError(
        "wrong_league",
        `This race is in ${race.metricKey} league ${race.leagueLevel}; you're in ${race.metricKey} league ${leagueState.currentLevel}.`
      );
    }
    if (race.leagueLevel < leagueState.currentLevel) {
      if (!params.acceptLowerLeague) {
        // A dead-end "wrong_league" here would hide the real option. This
        // code tells the client there IS a way in, just not the default one.
        throw new RaceError(
          "lower_league_available",
          `This race is in a lower ${race.metricKey} league than yours. You can enter it anyway — it pays and can win that league's fixed prize, but it won't earn or cost you any ${race.metricKey} league points.`
        );
      }
      lowerLeagueOptIn = true;
    }

    // Reuse an existing WITHDRAWN/REFUNDED row rather than erroring — those
    // statuses mean the user does not currently hold a slot, so there is
    // nothing to conflict with. Anything else (ENTERED/SCORED/DISQUALIFIED)
    // is an active or resolved claim and blocks a second entry.
    const existing = await tx.raceEntry.findUnique({
      where: { raceId_userId: { raceId: params.raceId, userId: params.userId } },
    });
    if (existing && existing.status !== "WITHDRAWN" && existing.status !== "REFUNDED") {
      throw new RaceError("already_entered", "You're already in this race.");
    }

    const squadId = race.format === "SQUAD" ? await resolveSquadSlot(tx, race, params) : null;

    // Conditional debit — the balance is re-checked inside the UPDATE rather
    // than against the value read above, same pattern as joinChallenge, so
    // two concurrent entries can't both spend the same balance.
    const debited = await tx.user.updateMany({
      where: { id: params.userId, walletBalanceCents: { gte: race.entryFeeCents } },
      data: { walletBalanceCents: { decrement: race.entryFeeCents } },
    });
    if (debited.count === 0) {
      throw new RaceError("insufficient_balance", "Not enough wallet balance to enter — top up your wallet first.");
    }

    const entryData = {
      squadId,
      timezone: user.timezone,
      entryFeeCents: race.entryFeeCents,
      status: "ENTERED" as const,
      lowerLeagueOptIn,
      aggregateValue: null,
      finishPosition: null,
      pointsAwarded: null,
      prizeCents: null,
    };
    const entry = existing
      ? await tx.raceEntry.update({ where: { id: existing.id }, data: entryData })
      : await tx.raceEntry.create({ data: { raceId: params.raceId, userId: params.userId, ...entryData } });

    await tx.ledgerEntry.create({
      data: {
        userId: params.userId,
        raceId: params.raceId,
        type: "RACE_ENTRY_FEE",
        // PENDING, not COMPLETED: the race does not exist yet, so this is
        // not revenue and is fully refundable. lockRace() completes it.
        status: "PENDING",
        amountCents: -race.entryFeeCents,
        currency: race.currency,
        description: lowerLeagueOptIn
          ? `Race entry — ${race.metricKey}, league ${race.leagueLevel} (lower league — no points either way)`
          : `Race entry — ${race.metricKey}, league ${race.leagueLevel}`,
      },
    });

    await tx.userLeagueState.update({
      where: { userId_metricKey: { userId: params.userId, metricKey: race.metricKey } },
      data: { racesEntered: { increment: 1 } },
    });

    const entrantsNow = await tx.raceEntry.count({ where: { raceId: params.raceId, status: "ENTERED" } });
    const entrantsRequired = requiredEntrantBodies(race);

    // Strictly equal, never >=. Reaching the exact number is the race's
    // existence condition; overshooting it should be impossible, and if it
    // somehow happened we would rather leave the race FILLING than lock a
    // race with the wrong field size.
    let lockedRace = false;
    let currentRace = race;
    if (entrantsNow === entrantsRequired) {
      currentRace = await lockRace(tx, race);
      lockedRace = true;
    }

    return { entry, race: currentRace, lockedRace, entrantsNow, entrantsRequired };
  });
}

/** 8 hex characters. Used for both race and squad invite codes. */
function generateInviteCode(): string {
  return randomBytes(4).toString("hex");
}
const generateSquadCode = generateInviteCode;

/**
 * Squad races: place the entrant into a squad, or found a new one.
 *
 * Three ways in, and the access rule is the whole point of this function:
 *
 *   1. `squadInviteCode` — the code the captain shared. Works for any squad
 *      whatever its policy, and does not require knowing the squad id.
 *   2. `squadId` — only admits the joiner if that squad is OPEN. An
 *      INVITE_ONLY squad rejects a bare id, which is what stops someone
 *      reading squad ids off the race listing and dropping into a team of
 *      strangers.
 *   3. `squadName` — founds a new squad, INVITE_ONLY unless the founder
 *      explicitly opts into OPEN.
 *
 * The default is closed rather than open because the cost of the two mistakes
 * is not symmetric: a captain who wanted an open squad and got a private one
 * shares a code, while a captain who wanted a private squad and got an open
 * one has already lost a seat — and in a squad race a passenger costs the
 * other three the prize.
 */
async function resolveSquadSlot(tx: Prisma.TransactionClient, race: Race, params: EnterRaceParams): Promise<string> {
  const squadSize = race.squadSize ?? 1;

  const assertHasRoom = (squad: { id: string; name: string }, memberCount: number) => {
    if (memberCount >= squadSize) {
      throw new RaceError("squad_full", `"${squad.name}" already has all ${squadSize} of its members.`);
    }
  };

  // 1. Joining by invite code — the code is the permission.
  if (params.squadInviteCode) {
    const squad = await tx.raceSquad.findUnique({
      where: { inviteCode: params.squadInviteCode.trim().toLowerCase() },
      include: { entries: { where: { status: "ENTERED" } } },
    });
    if (!squad) throw new RaceError("invalid_squad_code", "That squad code doesn't match any squad.");
    if (squad.raceId !== race.id) {
      throw new RaceError("squad_wrong_race", "That squad code is for a different race.");
    }
    assertHasRoom(squad, squad.entries.length);
    return squad.id;
  }

  // 2. Joining by id — permitted only for a squad its captain opened.
  if (params.squadId) {
    const squad = await tx.raceSquad.findUnique({
      where: { id: params.squadId },
      include: { entries: { where: { status: "ENTERED" } } },
    });
    if (!squad || squad.raceId !== race.id) throw new RaceError("squad_not_found", "That squad isn't in this race.");
    if (squad.joinPolicy !== "OPEN") {
      throw new RaceError(
        "squad_invite_only",
        `"${squad.name}" is invite-only — you need a code from whoever started it.`
      );
    }
    assertHasRoom(squad, squad.entries.length);
    return squad.id;
  }

  // 3. Founding a new squad.
  if (params.squadName) {
    const squadCount = await tx.raceSquad.count({ where: { raceId: race.id } });
    if (squadCount >= race.entrantCount) {
      throw new RaceError("no_squad_slots", `This race already has its ${race.entrantCount} squads — join one of them instead.`);
    }
    const created = await tx.raceSquad.create({
      data: {
        raceId: race.id,
        name: params.squadName,
        slotIndex: squadCount,
        captainUserId: params.userId,
        joinPolicy: params.squadJoinPolicy ?? "INVITE_ONLY",
        inviteCode: generateSquadCode(),
      },
    });
    return created.id;
  }

  throw new RaceError(
    "squad_required",
    "Squad races need a squad: pass squadName to start one, squadInviteCode to accept an invite, or squadId for a squad that's open to anyone."
  );
}

/**
 * Flips a filled race to LOCKED, recognises its entry fees as revenue, and
 * schedules the actual start.
 *
 * This is the moment the model's commercial semantics change, and the reason
 * the ledger needs its own entry types. Before this call the fees are a
 * refundable holding; after it they are platform revenue, and the prize
 * schedule is an unconditional platform obligation whose size has nothing to
 * do with how much revenue this particular race brought in.
 *
 * Revenue is recognised HERE, at lock, not at the later RUNNING transition —
 * reaching the exact headcount is the existence condition, and that is
 * already true the instant this runs. The wait for `scheduledStartAt` is
 * purely about when scoring begins, not about whether the race is real.
 */
async function lockRace(tx: Prisma.TransactionClient, race: Race): Promise<Race> {
  const now = new Date();
  const scheduledStartAt = nextMidnightInTimeZone(now, race.anchorTimezone);

  const locked = await tx.race.update({
    where: { id: race.id },
    data: { status: "LOCKED", lockedAt: now, scheduledStartAt },
  });

  // Entry fees become revenue.
  await tx.ledgerEntry.updateMany({
    where: { raceId: race.id, type: "RACE_ENTRY_FEE", status: "PENDING" },
    data: { status: "COMPLETED" },
  });

  const entries = await tx.raceEntry.findMany({ where: { raceId: race.id, status: "ENTERED" } });
  const revenueCents = entries.reduce((sum, e) => sum + e.entryFeeCents, 0);

  const platform = await ensurePlatformAccount(tx);
  await tx.user.update({ where: { id: platform.id }, data: { walletBalanceCents: { increment: revenueCents } }, select: { id: true } });
  await tx.ledgerEntry.create({
    data: {
      userId: platform.id,
      raceId: race.id,
      type: "RACE_ENTRY_REVENUE",
      status: "COMPLETED",
      amountCents: revenueCents,
      currency: race.currency,
      // Spelled out in the description because this is the distinction the
      // whole restructure turns on, and the ledger is where an auditor looks.
      description: `Race entry revenue (${entries.length} entrants) — not held against this race's ${race.totalPrizeCents / 100} prize commitment`,
    },
  });

  // Fires once — lockRace only runs inside the entry transaction that
  // completed the headcount. Queued rather than awaited inside the
  // transaction: holding a DB transaction open across a network call to
  // Expo would be a bad trade, and a missed notification must never roll
  // back a lock that has already recognised revenue.
  void notifyRaceLocked(locked);

  return locked;
}

/**
 * Tells everyone in a just-filled race that it's happening, and when.
 *
 * This is the moment the commitment becomes real — entries stop being
 * refundable at exactly this point — so it is the one race notification
 * that genuinely changes what the user can still do about it.
 */
async function notifyRaceLocked(race: Race): Promise<void> {
  try {
    const entries = await prisma.raceEntry.findMany({
      where: { raceId: race.id, status: "ENTERED" },
      select: { userId: true },
    });
    const startsAt = race.scheduledStartAt
      ? new Date(race.scheduledStartAt).toLocaleString("en-ZA", { timeZone: race.anchorTimezone, weekday: "long", hour: "numeric", minute: "2-digit" })
      : "soon";
    await notifyUsers(
      entries.map((e) => e.userId),
      "race_locked",
      {
        title: "Your race is full",
        body: `All ${race.entrantCount} in. It starts ${startsAt} — entries are final from now.`,
        data: { raceId: race.id },
      }
    );
  } catch (err) {
    console.error(`[push] race_locked notify failed for ${race.id}:`, err);
  }
}

/**
 * Flips every race whose scheduled start has arrived from LOCKED to RUNNING.
 *
 * `startedAt` is set to the INTENDED instant (`scheduledStartAt`), not to
 * "now" — this job runs on a tick, so it may fire a few minutes after
 * midnight, and a race should still run for exactly `durationDays` from the
 * moment it was meant to start, not from whenever the tick happened to land.
 */
export async function startLockedRaces(now = new Date()) {
  const due = await prisma.race.findMany({
    where: { status: "LOCKED", scheduledStartAt: { lte: now } },
    select: { id: true, durationDays: true, scheduledStartAt: true },
  });

  const started: string[] = [];
  for (const race of due) {
    const startedAt = race.scheduledStartAt!;
    const endsAt = new Date(startedAt.getTime() + race.durationDays * 86_400_000);
    // Conditional claim — a concurrent tick must not double-process.
    const claimed = await prisma.race.updateMany({
      where: { id: race.id, status: "LOCKED" },
      data: { status: "RUNNING", startedAt, endsAt },
    });
    if (claimed.count > 0) started.push(race.id);
  }
  return { started: started.length, raceIds: started };
}

/**
 * A user withdraws their own entry while the race is still FILLING —
 * full refund, no penalty. Once a race LOCKS this is no longer possible; the
 * headcount is exact and locking is the moment the prize commitment becomes
 * unconditional, so there is no partial-field state to un-commit from.
 */
export async function cancelRaceEntry(params: { userId: string; raceId: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Race" WHERE id = ${params.raceId} FOR UPDATE`;

    const race = await tx.race.findUnique({ where: { id: params.raceId } });
    if (!race) throw new RaceError("not_found", "Race not found.");

    const entry = await tx.raceEntry.findUnique({
      where: { raceId_userId: { raceId: params.raceId, userId: params.userId } },
    });
    if (!entry || entry.status !== "ENTERED") {
      throw new RaceError("not_entered", "You don't have an active entry in this race.");
    }
    if (race.status !== "FILLING") {
      throw new RaceError(
        "cannot_withdraw",
        "This race already reached its headcount and locked — entries are final from that point on."
      );
    }

    await tx.user.update({
      where: { id: params.userId },
      data: { walletBalanceCents: { increment: entry.entryFeeCents } },
      select: { id: true },
    });
    await tx.raceEntry.update({ where: { id: entry.id }, data: { status: "WITHDRAWN" } });
    // Reverse the original debit rather than leaving it COMPLETED, so a
    // ledger reader never sees a recognised fee for an entry that was pulled
    // before the race even existed.
    await tx.ledgerEntry.updateMany({
      where: { raceId: params.raceId, userId: params.userId, type: "RACE_ENTRY_FEE", status: "PENDING" },
      data: { status: "REVERSED" },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: params.userId,
        raceId: params.raceId,
        type: "RACE_ENTRY_REFUND",
        status: "COMPLETED",
        amountCents: entry.entryFeeCents,
        currency: race.currency,
        description: "You withdrew before the race filled — entry fee refunded in full.",
      },
    });
    await tx.userLeagueState.update({
      where: { userId_metricKey: { userId: params.userId, metricKey: race.metricKey } },
      data: { racesEntered: { decrement: 1 } },
    });

    // Squad races: an empty squad frees its slot for someone else to found a
    // new one, rather than sitting as a permanent zero-member placeholder.
    if (entry.squadId) {
      const remaining = await tx.raceEntry.count({
        where: { squadId: entry.squadId, status: "ENTERED" },
      });
      if (remaining === 0) {
        await tx.raceSquad.delete({ where: { id: entry.squadId } });
      }
    }

    return { withdrawn: true, refundedCents: entry.entryFeeCents };
  });
}

/**
 * Manually cancels a race that is still FILLING and refunds every entry fee
 * in full — the operator escape hatch for a race that has clearly been
 * waiting too long and is never going to reach its headcount.
 *
 * Deliberately not automatic or time-triggered: fill has no deadline, so
 * nothing here runs on a schedule. This is a human decision about one
 * specific race, made through /admin.
 *
 * No platform fee is retained. That race never existed, so there was never a
 * service to charge for.
 */
export async function adminCancelRace(raceId: string, reason: string, cancelledByUserId: string) {
  return prisma.$transaction(async (tx) => {
    const race = await tx.race.findUnique({
      where: { id: raceId },
      include: { entries: { where: { status: "ENTERED" } } },
    });
    if (!race) throw new RaceError("not_found", "Race not found.");
    if (race.status !== "FILLING") {
      throw new RaceError("cannot_cancel", `Only a FILLING race can be cancelled this way (this one is ${race.status}).`);
    }

    await tx.race.update({
      where: { id: raceId },
      data: { status: "CANCELLED_UNFILLED", cancelledAt: new Date(), cancelReason: reason },
    });

    let refundedCents = 0;
    for (const entry of race.entries) {
      await tx.user.update({ where: { id: entry.userId }, data: { walletBalanceCents: { increment: entry.entryFeeCents } }, select: { id: true } });
      await tx.raceEntry.update({ where: { id: entry.id }, data: { status: "REFUNDED" } });
      await tx.ledgerEntry.updateMany({
        where: { raceId, userId: entry.userId, type: "RACE_ENTRY_FEE", status: "PENDING" },
        data: { status: "REVERSED" },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: entry.userId,
          raceId,
          type: "RACE_ENTRY_REFUND",
          status: "COMPLETED",
          amountCents: entry.entryFeeCents,
          currency: race.currency,
          description: `Full refund — race cancelled: ${reason}`,
          // Same reasoning as disqualifyEntry / forfeitHeldPrize: a real,
          // deliberate operator decision refunding real money, with nothing
          // recording who made it until now.
          performedByUserId: cancelledByUserId,
        },
      });
      refundedCents += entry.entryFeeCents;
    }
    return { cancelled: true, refundedEntrants: race.entries.length, refundedCents };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────

const raceListInclude = {
  // metricType comes along so the client can render the right glyph and
  // format totals in the metric's own units. Without it the mobile side only
  // has metricKey ("steps"), which is not the icon token ("footprints") the
  // theme registry is keyed by — see mobile/src/theme/metricIcons.ts.
  raceType: {
    select: {
      key: true,
      displayName: true,
      metricKey: true,
      format: true,
      metricType: { select: { key: true, displayName: true, unit: true, valueType: true, icon: true } },
    },
  },
  league: { select: { level: true, name: true } },
  entries: { select: { id: true, userId: true, squadId: true, status: true } },
  squads: { select: { id: true, name: true, slotIndex: true, captainUserId: true, joinPolicy: true, inviteCode: true } },
} as const;

/**
 * Public races this user can currently enter — their own league for each
 * metric, PLUS, for any metric where their own league has nothing FILLING,
 * the closest lower league that does. The second half is the "my league is
 * empty" fallback: rather than a dead end, the browse list itself surfaces
 * the opt-in option, flagged so the client can show it distinctly and
 * require the explicit accept before entering.
 *
 * Private races are excluded: they are joined by code, not browsed.
 */
export async function listOpenRacesForUser(userId: string) {
  const states = await getAllLeagueStates(userId);

  const ownLevelRaces = await prisma.race.findMany({
    where: {
      status: "FILLING",
      visibility: "PUBLIC",
      OR: states.map((s) => ({ metricKey: s.metricKey, leagueLevel: s.currentLevel })),
    },
    include: raceListInclude,
    orderBy: { signupOpensAt: "asc" },
  });

  const metricsWithARace = new Set(ownLevelRaces.map((r) => r.metricKey));
  const emptyMetrics = states.filter((s) => !metricsWithARace.has(s.metricKey) && s.currentLevel > 1);

  const fallbackRaces = [];
  for (const state of emptyMetrics) {
    const lower = await prisma.race.findFirst({
      where: {
        status: "FILLING",
        visibility: "PUBLIC",
        metricKey: state.metricKey,
        leagueLevel: { lt: state.currentLevel },
      },
      include: raceListInclude,
      orderBy: [{ leagueLevel: "desc" }, { signupOpensAt: "asc" }],
    });
    if (lower) fallbackRaces.push(lower);
  }

  return [
    ...ownLevelRaces.map((race) => ({ ...decorateRace(race, userId), isLowerLeagueOption: false })),
    ...fallbackRaces.map((race) => ({ ...decorateRace(race, userId), isLowerLeagueOption: true })),
  ];
}

type DecoratableSquad = {
  id: string;
  name: string;
  slotIndex: number;
  captainUserId: string;
  joinPolicy?: "INVITE_ONLY" | "OPEN";
  inviteCode?: string;
};

/**
 * Adds the derived fields every client surface needs — the frozen prize list,
 * fill counts, and per-squad membership — to a raw race row.
 *
 * Both the list and the detail endpoint go through here. They used to
 * diverge, with the detail endpoint returning the raw row; since `prizes` is
 * derived rather than a column, that shipped a race object with no prize list
 * at all and crashed the detail screen on `race.prizes.map`.
 *
 * A squad's inviteCode is only included for someone already in that squad.
 * Returning it to every viewer would make "invite-only" decorative — anyone
 * could read a code off the listing and let themselves in.
 *
 * `entries` here is expected to already be narrowed to ENTERED status where
 * that matters for a count (fill counts must never include a withdrawn
 * slot) — see raceListInclude, which selects only what's needed and callers
 * that fetch entries separately (getRaceForUser) filtering explicitly.
 */
export function decorateRace(
  race: Race & {
    entries: Array<{ id: string; userId: string; squadId: string | null; status?: string }>;
    squads?: DecoratableSquad[];
  },
  userId: string
) {
  const activeEntries = race.entries.filter((e) => e.status === undefined || e.status === "ENTERED" || e.status === "SCORED" || e.status === "DISQUALIFIED");
  const required = requiredEntrantBodies(race);
  const myEntry = race.entries.find((e) => e.userId === userId && (e.status === undefined || e.status === "ENTERED"));
  return {
    ...race,
    prizes: prizeSnapshotOf(race),
    entrantsNow: activeEntries.length,
    entrantsRequired: required,
    slotsRemaining: Math.max(0, required - activeEntries.length),
    hasEntered: myEntry != null,
    mySquadId: myEntry?.squadId ?? null,
    squads: (race.squads ?? []).map((squad) => {
      const isMine = myEntry?.squadId === squad.id;
      return {
        id: squad.id,
        name: squad.name,
        slotIndex: squad.slotIndex,
        captainUserId: squad.captainUserId,
        joinPolicy: squad.joinPolicy ?? "INVITE_ONLY",
        memberCount: activeEntries.filter((e) => e.squadId === squad.id).length,
        capacity: race.squadSize ?? 1,
        isMine,
        isCaptain: squad.captainUserId === userId,
        // Members only — see the note above.
        inviteCode: isMine ? squad.inviteCode ?? null : null,
      };
    }),
  };
}

export async function getRaceForUser(raceId: string, userId: string) {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    include: {
      ...raceListInclude,
      entries: {
        include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
        orderBy: [{ aggregateValue: "desc" }, { joinedAt: "asc" }],
      },
    },
  });
  if (!race) throw new RaceError("not_found", "Race not found.");
  // Decorated, exactly like the list endpoint. Returning the raw row here is
  // what previously shipped a race with no `prizes` array and blank-screened
  // the detail view.
  return { ...decorateRace(race, userId), entries: race.entries };
}

/**
 * Resolves a shared squad code to what the invitee is being asked to join.
 *
 * Deliberately read-only and deliberately generous with detail: someone
 * handed a code should be able to see the squad, the race, the entry fee and
 * the prize schedule before committing money, rather than discovering them
 * after the debit. Mirrors GET /invites/:code in the pooled model.
 */
export async function resolveSquadByCode(code: string, userId: string) {
  const squad = await prisma.raceSquad.findUnique({
    where: { inviteCode: code.trim().toLowerCase() },
    include: {
      race: { include: raceListInclude },
      entries: { where: { status: "ENTERED" }, select: { id: true, userId: true } },
      captain: { select: { id: true, displayName: true } },
    },
  });
  if (!squad) throw new RaceError("invalid_squad_code", "That squad code doesn't match any squad.");

  const capacity = squad.race.squadSize ?? 1;
  const alreadyIn = squad.entries.some((e) => e.userId === userId);
  const raceOpen = squad.race.status === "FILLING";

  return {
    squad: {
      id: squad.id,
      name: squad.name,
      joinPolicy: squad.joinPolicy,
      captain: squad.captain,
      memberCount: squad.entries.length,
      capacity,
    },
    race: decorateRace(squad.race, userId),
    alreadyIn,
    // One field the client can trust rather than re-deriving the rules.
    joinable: raceOpen && !alreadyIn && squad.entries.length < capacity,
    reason: !raceOpen
      ? ("race_not_open" as const)
      : alreadyIn
        ? ("already_in_squad" as const)
        : squad.entries.length >= capacity
          ? ("squad_full" as const)
          : null,
  };
}

/** A user's own race history, for the profile. */
export async function listUserRaceEntries(userId: string, limit = 30) {
  const entries = await prisma.raceEntry.findMany({
    where: { userId },
    include: {
      race: { include: { raceType: { select: { displayName: true } }, league: { select: { level: true, name: true } } } },
      squad: { select: { id: true, name: true, finishPosition: true } },
    },
    orderBy: { joinedAt: "desc" },
    take: limit,
  });

  return entries.map((entry) => ({
    ...entry,
    race: {
      ...entry.race,
      inviteCode: entry.race.createdByUserId === userId ? entry.race.inviteCode : null,
    },
  }));
}

export type { Race, RaceEntry, RaceType };
