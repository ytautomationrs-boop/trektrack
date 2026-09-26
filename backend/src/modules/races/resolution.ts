import { stepSyncClosesAt } from "../health/syncWindow.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ensurePlatformAccount } from "../../lib/platformAccount.js";
import { pointsForPosition, RACE_PRIZE_REVIEW_HOLD_HOURS } from "./config.js";
import { applyRaceResult } from "./leagues.js";
import { aggregateForEntries } from "./scoring.js";
import { prizeSnapshotOf, RaceError } from "./service.js";
import { notifyUser } from "../notifications/service.js";
import type { Race, RaceEntry } from "@prisma/client";

/**
 * Resolving a finished race: rank the field, pay the fixed prize schedule,
 * award league points.
 *
 * The prize side of this file is where the model differs most from
 * modules/payouts/service.ts, and the difference is the point of the whole
 * restructure:
 *
 *   The pooled model computes what to pay FROM the entrants — pot =
 *   participants × stake, minus fees, split among finishers. Change who
 *   entered and you change every payout.
 *
 *   This model reads what to pay off `Race.prizeSnapshot`, frozen before
 *   anyone entered. The number of entrants is fixed by construction and the
 *   prize is identical whether the platform made money on this instance or
 *   lost money on it. Nothing here divides anything by a headcount, and
 *   there is no pot variable to be found in this file.
 */

type Ranked = {
  entry: RaceEntry;
  total: number;
  position: number;
};

/**
 * Orders a field, highest total first, with disqualified entries forced to
 * the bottom.
 *
 * Ties break by who entered first. Some deterministic rule is required
 * because positions carry both money and points, and entry order is the one
 * field guaranteed to differ — the same tiebreak the pooled model uses for
 * its roster placement.
 */
function rankByTotal<T extends { entry: { status: string; joinedAt: Date }; total: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aOut = a.entry.status === "DISQUALIFIED" ? 1 : 0;
    const bOut = b.entry.status === "DISQUALIFIED" ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;
    if (b.total !== a.total) return b.total - a.total;
    return a.entry.joinedAt.getTime() - b.entry.joinedAt.getTime();
  });
}

/** Fixed prize for a finishing position, straight off the frozen snapshot. Positions with no tier pay nothing. */
function prizeForPosition(race: Race, position: number): number {
  return prizeSnapshotOf(race).find((p) => p.position === position)?.amountCents ?? 0;
}

/**
 * Resolves one race. Idempotent and safe against concurrent job ticks — the
 * RUNNING → RESOLVING transition is claimed with a conditional UPDATE, so a
 * second caller bails instead of paying the schedule twice.
 */
export async function resolveRace(raceId: string, now = new Date()) {
  const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });

  if (race.status !== "RUNNING") return { skipped: true as const, reason: race.status };
  if (!race.endsAt || now < stepSyncClosesAt(race.metricKey, race.endsAt)) return { skipped: true as const, reason: "not_ended_yet" };

  const claimed = await prisma.race.updateMany({
    where: { id: raceId, status: "RUNNING" },
    data: { status: "RESOLVING" },
  });
  if (claimed.count === 0) return { skipped: true as const, reason: "already_resolving" };

  const entries = await prisma.raceEntry.findMany({ where: { raceId } });
  // One grouped query for the whole field rather than two per entrant.
  // DISQUALIFIED is forced to -1 so rankByTotal sorts it below a genuine
  // zero — a disqualified entrant ranks last, not merely joint-last.
  const sums = await aggregateForEntries(race, entries.map((e) => e.id));
  const totals = entries.map((entry) => ({
    entry,
    total: entry.status === "DISQUALIFIED" ? -1 : (sums.get(entry.id) ?? 0),
  }));

  const ranked: Ranked[] =
    race.format === "SQUAD" ? await rankSquadRace(race, totals) : rankIndividualRace(totals);

  let prizesPaidCents = 0;
  let prizesHeldCents = 0;
  // Collected here rather than read back off row.entry: those objects were
  // loaded before awardEntry ran, so their prizeCents is still null.
  const outcomes: Array<{ row: Ranked; paidCents: number; heldCents: number }> = [];

  for (const row of ranked) {
    const outcome = await awardEntry(race, row, now);
    prizesPaidCents += outcome.paidCents;
    prizesHeldCents += outcome.heldCents;
    outcomes.push({ row, ...outcome });
  }

  await prisma.race.update({ where: { id: raceId }, data: { status: "COMPLETED", resolvedAt: now } });

  // Fires once: reaching here means this caller won the RUNNING -> RESOLVING
  // claim above, so no dedupe guard is needed. notifyUser swallows its own
  // failures — a push outage must not leave a race stuck unresolved after
  // prizes have already been paid.
  await notifyRaceResolved(race, outcomes);

  return {
    skipped: false as const,
    entrants: ranked.length,
    prizesPaidCents,
    prizesHeldCents,
    // The platform's actual result on this instance. Negative is a real
    // possibility and not an error — a fixed purse means the downside sits
    // with the platform (see config.ts MAX_PRIZE_TO_REVENUE_RATIO).
    netCents: entries.reduce((sum, e) => sum + e.entryFeeCents, 0) - race.totalPrizeCents,
  };
}

/**
 * Tells each entrant where they finished, and what they won.
 *
 * Deliberately tells the people who won nothing too. A race result is the
 * thing they staked an entry fee on; going silent unless there's money
 * attached would make the app feel like it only talks to you when it's good
 * news, and leaves everyone else refreshing to find out.
 */
async function notifyRaceResolved(
  race: Race,
  outcomes: Array<{ row: Ranked; paidCents: number; heldCents: number }>
): Promise<void> {
  const label = race.format === "SQUAD" ? "squad race" : "race";
  await Promise.all(
    outcomes.map(({ row, paidCents, heldCents }) => {
      // A held prize is deliberately NOT reported as won — it is pending an
      // anti-fraud review that can still forfeit it, and telling someone
      // they won money we might not pay is worse than saying nothing yet.
      const body =
        paidCents > 0
          ? `You finished ${ordinal(row.position)} and won R${(paidCents / 100).toLocaleString()}.`
          : heldCents > 0
            ? `You finished ${ordinal(row.position)}. Your prize is being checked before it's paid out.`
            : `You finished ${ordinal(row.position)} of ${race.entrantCount}.`;
      return notifyUser(row.entry.userId, "race_resolved", {
        title: `Your ${race.metricKey} ${label} is done`,
        body,
        data: { raceId: race.id },
      });
    })
  );
}

function rankIndividualRace(totals: Array<{ entry: RaceEntry; total: number }>): Ranked[] {
  return rankByTotal(totals).map((row, i) => ({ ...row, position: i + 1 }));
}

/**
 * Squad races rank SQUADS, not people. Each squad's aggregate is the sum of
 * its members' individual totals (each member's own activity measured by the
 * existing verification stack), and every member of a squad receives that
 * squad's finishing position — and therefore that squad's points.
 */
async function rankSquadRace(race: Race, totals: Array<{ entry: RaceEntry; total: number }>): Promise<Ranked[]> {
  const squads = await prisma.raceSquad.findMany({ where: { raceId: race.id } });

  const squadRows = squads.map((squad) => {
    const members = totals.filter((t) => t.entry.squadId === squad.id);
    return {
      squad,
      members,
      total: members.reduce((sum, m) => sum + Math.max(0, m.total), 0),
      // A squad's "entry" for tiebreak purposes is its earliest member.
      entry: {
        status: members.every((m) => m.entry.status === "DISQUALIFIED") ? "DISQUALIFIED" : "ENTERED",
        joinedAt: members.reduce(
          (earliest, m) => (m.entry.joinedAt < earliest ? m.entry.joinedAt : earliest),
          members[0]?.entry.joinedAt ?? new Date()
        ),
      },
    };
  });

  const ordered = rankByTotal(squadRows);
  const ranked: Ranked[] = [];
  for (const [i, row] of ordered.entries()) {
    const position = i + 1;
    await prisma.raceSquad.update({
      where: { id: row.squad.id },
      data: { aggregateValue: row.total, finishPosition: position },
    });
    for (const member of row.members) {
      ranked.push({ entry: member.entry, total: member.total, position });
    }
  }
  return ranked;
}

/**
 * Records one entrant's result: their position, their points, and their
 * prize — paid straight to the wallet, or held if their evidence carries an
 * unresolved anomaly flag.
 *
 * Points are awarded unconditionally, including to entrants whose prize is
 * held and to entrants who finished last for a negative score. Points are
 * standing, not money; withholding them pending a fraud review would leave a
 * user's league position silently wrong in the meantime.
 */
async function awardEntry(race: Race, row: Ranked, now: Date): Promise<{ paidCents: number; heldCents: number }> {
  // Ranked slots, not people: entrantCount is the number of ENTRANTS for an
  // individual race and the number of SQUADS for a squad race, which is
  // exactly what the points scale spreads across in both cases. (A 4-squad
  // race has 4 positions and 16 people; every member takes their squad's.)
  const nominalPoints = pointsForPosition(row.position, race.entrantCount);
  // A voluntary lower-league entry pays and can win that league's fixed
  // prize normally, but earns ZERO points either way — winning an easier
  // field should not let a stronger racer pad their real league standing,
  // and losing one should not cost them anything there either.
  const points = row.entry.lowerLeagueOptIn ? 0 : nominalPoints;

  const grossPrize = prizeForPosition(race, row.position);
  // Squad races carry ONE prize for the winning squad; it is split evenly
  // among that squad's members, with any rounding remainder going to the
  // first member rather than silently vanishing.
  const prizeCents = race.format === "SQUAD" ? await squadMemberShare(race, row, grossPrize) : grossPrize;

  const openFlags = await prisma.raceAnomalyFlag.count({
    where: { raceEntryId: row.entry.id, status: "OPEN", severity: { in: ["MEDIUM", "HIGH"] } },
  });
  const holdPrize = prizeCents > 0 && openFlags > 0;

  const platform = await ensurePlatformAccount(prisma);

  await prisma.$transaction(async (tx) => {
    await tx.raceEntry.update({
      where: { id: row.entry.id },
      data: {
        status: row.entry.status === "DISQUALIFIED" ? "DISQUALIFIED" : "SCORED",
        aggregateValue: Math.max(0, row.total),
        finishPosition: row.position,
        pointsAwarded: points,
        prizeCents,
      },
    });

    // Points land on this race's metric only. A running result never
    // touches the entrant's cycling, swimming or steps standing.
    await applyRaceResult(tx, {
      userId: row.entry.userId,
      metricKey: race.metricKey,
      raceId: race.id,
      raceEntryId: row.entry.id,
      points,
      position: row.position,
      lowerLeagueOptIn: row.entry.lowerLeagueOptIn,
    });

    if (prizeCents <= 0) return;

    if (holdPrize) {
      // No wallet credit yet. A PENDING entry so the user can see the prize
      // exists and is under review, rather than it silently not arriving.
      await tx.ledgerEntry.create({
        data: {
          userId: row.entry.userId,
          raceId: race.id,
          type: "RACE_PRIZE",
          status: "PENDING",
          amountCents: prizeCents,
          currency: race.currency,
          description: `Prize held for review — ${ordinal(row.position)} place`,
        },
      });
      return;
    }

    await tx.user.update({
      where: { id: row.entry.userId },
      data: { walletBalanceCents: { increment: prizeCents } },
      select: { id: true },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: row.entry.userId,
        raceId: race.id,
        type: "RACE_PRIZE",
        status: "COMPLETED",
        amountCents: prizeCents,
        currency: race.currency,
        description: `${ordinal(row.position)} place prize — fixed schedule`,
      },
    });
    // The platform's side of the same movement. Recorded as an expense
    // against the platform account rather than as a draw-down of a pot,
    // because there is no pot: this amount was owed the moment the race
    // started, independent of what the entry fees came to.
    await tx.user.update({
      where: { id: platform.id },
      data: { walletBalanceCents: { decrement: prizeCents } },
      select: { id: true },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: platform.id,
        raceId: race.id,
        type: "RACE_PRIZE_EXPENSE",
        status: "COMPLETED",
        amountCents: -prizeCents,
        currency: race.currency,
        description: `Fixed prize paid — ${ordinal(row.position)} place`,
      },
    });
  });

  return { paidCents: holdPrize ? 0 : prizeCents, heldCents: holdPrize ? prizeCents : 0 };
}

/** Even split of a squad's single prize, remainder to the earliest-joined member. */
async function squadMemberShare(race: Race, row: Ranked, squadPrizeCents: number): Promise<number> {
  if (squadPrizeCents <= 0 || !row.entry.squadId) return 0;
  const members = await prisma.raceEntry.findMany({
    where: { squadId: row.entry.squadId },
    orderBy: { joinedAt: "asc" },
  });
  if (members.length === 0) return 0;

  const share = Math.floor(squadPrizeCents / members.length);
  const dust = squadPrizeCents - share * members.length;
  return members[0]!.id === row.entry.id ? share + dust : share;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** Every race whose window has elapsed. Driven by jobs/raceLifecycle.ts. */
export async function resolveDueRaces(now = new Date()) {
  const due = await prisma.race.findMany({
    where: { status: "RUNNING", endsAt: { lte: now } },
    select: { id: true },
  });

  let resolved = 0;
  for (const race of due) {
    const result = await resolveRace(race.id, now);
    if (!result.skipped) resolved++;
  }
  return { resolved, considered: due.length };
}

/**
 * Releases prizes that were held for anti-fraud review and have since been
 * cleared — every flag on the entry dismissed, or the hold window elapsed
 * with no reviewer action.
 *
 * The timeout release is deliberate. A flag is a signal for a human to look,
 * not a finding; leaving a legitimately-won fixed prize unpaid forever
 * because nobody worked the queue would be the worse failure. A flag that is
 * actually confirmed routes to forfeitHeldPrize() instead.
 */
export async function releaseHeldRacePrizes(now = new Date()) {
  const held = await prisma.ledgerEntry.findMany({
    where: { type: "RACE_PRIZE", status: "PENDING" },
    include: { race: true },
  });

  const platform = await ensurePlatformAccount(prisma);
  let released = 0;
  let stillHeld = 0;

  for (const entry of held) {
    if (!entry.raceId || !entry.race?.resolvedAt) continue;

    // RaceAnomalyFlag.raceEntryId is a plain column, not a relation (the
    // flag hangs off the sample), so the entry is resolved first rather than
    // filtered through.
    const raceEntry = await prisma.raceEntry.findUnique({
      where: { raceId_userId: { raceId: entry.raceId, userId: entry.userId } },
      select: { id: true },
    });
    const openFlags = raceEntry
      ? await prisma.raceAnomalyFlag.count({
          where: { raceEntryId: raceEntry.id, status: "OPEN", severity: { in: ["MEDIUM", "HIGH"] } },
        })
      : 0;
    const holdExpired = now.getTime() - entry.race.resolvedAt.getTime() >= RACE_PRIZE_REVIEW_HOLD_HOURS * 3_600_000;
    if (openFlags > 0 && !holdExpired) {
      stillHeld++;
      continue;
    }

    // Conditional claim so two overlapping job runs can't both credit it.
    const claimedRows = await prisma.ledgerEntry.updateMany({
      where: { id: entry.id, status: "PENDING" },
      data: { status: "COMPLETED" },
    });
    if (claimedRows.count === 0) continue;

    const winner = await prisma.user.findUnique({ where: { id: entry.userId }, select: { id: true } });
    if (!winner) {
      await prisma.ledgerEntry.update({
        where: { id: entry.id },
        data: { status: "FAILED", description: `${entry.description} (not released: user missing)` },
      });
      console.error(`[race-prizes] held prize ${entry.id} referenced missing user ${entry.userId}`);
      continue;
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: entry.userId }, data: { walletBalanceCents: { increment: entry.amountCents } }, select: { id: true } }),
      prisma.user.update({ where: { id: platform.id }, data: { walletBalanceCents: { decrement: entry.amountCents } }, select: { id: true } }),
      prisma.ledgerEntry.create({
        data: {
          userId: platform.id,
          raceId: entry.raceId,
          type: "RACE_PRIZE_EXPENSE",
          status: "COMPLETED",
          amountCents: -entry.amountCents,
          currency: entry.currency,
          description: "Fixed prize paid after review hold",
        },
      }),
    ]);
    released++;
  }
  return { released, stillHeld };
}

/**
 * Disqualifies an entry on a confirmed-cheat finding.
 *
 * Mid-race removal does NOT void the race. The race's existence condition
 * was reaching its exact headcount, and it did — nine honest entrants should
 * not lose their contest because a tenth cheated. The disqualified entrant is
 * ranked last, takes the corresponding negative points, and forfeits their
 * entry fee (which was already recognised as revenue at start).
 */
export async function disqualifyEntry(raceEntryId: string, reason: string, reviewerId: string) {
  const entry = await prisma.raceEntry.findUniqueOrThrow({ where: { id: raceEntryId }, include: { race: true } });
  if (entry.race.status === "COMPLETED") {
    throw new RaceError("race_completed", "This race is already resolved — reverse the prize instead.");
  }

  await prisma.$transaction([
    prisma.raceEntry.update({ where: { id: raceEntryId }, data: { status: "DISQUALIFIED" } }),
    prisma.raceAnomalyFlag.updateMany({
      where: { raceEntryId, status: "OPEN" },
      data: { status: "CONFIRMED_CHEAT", reviewedByUserId: reviewerId, reviewedAt: new Date() },
    }),
    prisma.ledgerEntry.create({
      data: {
        userId: entry.userId,
        raceId: entry.raceId,
        type: "RACE_ENTRY_FEE",
        status: "COMPLETED",
        amountCents: 0, // marker only — the fee was already taken at entry
        currency: entry.race.currency,
        description: `Disqualified — ${reason}. Entry fee forfeited.`,
      },
    }),
  ]);

  return { disqualified: true, raceStillRunning: entry.race.status === "RUNNING" };
}

/** Cancels a held prize outright on a confirmed finding. */
/**
 * Forfeits a prize that was held for anti-fraud review, on a confirmed
 * finding. `reviewerId` is required for the same reason
 * disqualifyEntry's is: this is real money someone was provisionally
 * awarded and then does not receive, and it had no attribution of any kind
 * until this parameter existed — required rather than optional so a future
 * caller that forgets to pass it fails to compile instead of silently
 * forfeiting a prize with nobody on record for the decision.
 */
export async function forfeitHeldPrize(ledgerEntryId: string, reason: string, reviewerId: string) {
  const updated = await prisma.ledgerEntry.updateMany({
    where: { id: ledgerEntryId, type: "RACE_PRIZE", status: "PENDING" },
    data: { status: "FAILED", description: `Prize forfeited — ${reason}`, performedByUserId: reviewerId },
  });
  if (updated.count === 0) throw new RaceError("not_held", "That prize isn't currently held.");
  return { forfeited: true };
}

export type { Prisma };
