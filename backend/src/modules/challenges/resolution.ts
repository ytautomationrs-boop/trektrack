import { prisma } from "../../lib/prisma.js";
import { REDEMPTION_FEE_CENTS } from "../../lib/constants.js";
import { ChallengeError } from "./service.js";
import { notifyUser, notifyUsers } from "../notifications/service.js";
import type { ChallengeParticipant } from "@prisma/client";

/**
 * StreakPot lifecycle: OPEN -> ACTIVE at startDate, ACTIVE -> COMPLETED once
 * the window elapses, with the zero-commission pool split at the end.
 *
 * There is deliberately no platform-side ledger entry anywhere in this
 * file — every cent staked either comes back to the person who staked it
 * (STAKE_REFUND) or moves to a finisher (POOL_PAYOUT). Compare with
 * modules/races/resolution.ts, which posts a platform RACE_PRIZE_EXPENSE
 * for every prize paid — that pairing is exactly the platform cut StreakPot
 * doesn't take.
 */

/**
 * Moves every OPEN challenge whose startDate has arrived to ACTIVE, and
 * recognises every participant's stake as genuinely at risk (PENDING ->
 * COMPLETED on their STAKE_HOLD entry — no balance movement, the debit
 * already happened at join time; this only marks it non-refundable).
 *
 * A challenge with zero participants when its start arrives is cancelled
 * outright rather than run empty.
 */
export async function startDueChallenges(now = new Date()) {
  const due = await prisma.challenge.findMany({
    where: { status: "OPEN", startDate: { lte: now } },
    select: { id: true },
  });

  let started = 0;
  let cancelled = 0;
  for (const { id } of due) {
    const participantCount = await prisma.challengeParticipant.count({ where: { challengeId: id, status: { not: "WITHDRAWN" } } });
    const targetStatus = participantCount === 0 ? "CANCELLED" : "ACTIVE";

    // Conditional claim, same idiom as resolveDueChallenges below: only a
    // caller that actually flips OPEN -> targetStatus proceeds to the
    // side-effects, so two overlapping ticks can't both start/cancel it.
    const claimed = await prisma.challenge.updateMany({ where: { id, status: "OPEN" }, data: { status: targetStatus } });
    if (claimed.count === 0) continue;

    if (targetStatus === "CANCELLED") {
      cancelled++;
      continue;
    }
    await prisma.ledgerEntry.updateMany({
      where: { challengeId: id, type: "STAKE_HOLD", status: "PENDING" },
      data: { status: "COMPLETED" },
    });

    // Fires once — only the caller that won the OPEN -> ACTIVE claim gets
    // here. This is the moment stakes stop being refundable, so it is worth
    // telling people about rather than letting them discover it.
    const challenge = await prisma.challenge.findUnique({ where: { id }, select: { title: true, durationDays: true } });
    const participants = await prisma.challengeParticipant.findMany({
      where: { challengeId: id, status: "ACTIVE" },
      select: { userId: true },
    });
    await notifyUsers(
      participants.map((p) => p.userId),
      "challenge_starting",
      {
        title: `"${challenge?.title ?? "Your challenge"}" has started`,
        body: `Hit your target every day for ${challenge?.durationDays ?? 0} days to take a share of the pool. Your stake is now committed.`,
        data: { challengeId: id },
      }
    );
    started++;
  }
  return { started, cancelled, considered: due.length };
}

/**
 * Eliminates a participant on a failed/missed day — UNLESS they have an
 * unused purchased redemption, in which case this one miss is absorbed
 * instead (see purchaseRedemption below).
 *
 * WHOLE_GROUP squad challenges cascade: one person's miss eliminates every
 * currently-ACTIVE participant in the challenge, not just them. INDIVIDUAL
 * scope (and every SOLO challenge) only ever eliminates the one person.
 */
export async function eliminateParticipant(participantId: string, day: number) {
  const participant = await prisma.challengeParticipant.findUniqueOrThrow({
    where: { id: participantId },
    include: { challenge: true },
  });
  if (participant.status !== "ACTIVE") return; // already resolved somehow — nothing to do

  if (participant.redemptionPurchased && !participant.redemptionUsed) {
    await prisma.$transaction([
      prisma.challengeParticipant.update({ where: { id: participantId }, data: { redemptionUsed: true, currentStreak: 0 } }),
      prisma.dailyCheckIn.updateMany({
        where: { participantId, challengeDay: day },
        data: { redemptionApplied: true },
      }),
    ]);
    return;
  }

  // WHOLE_GROUP elimination is NOT implementable yet, and quietly guessing
  // would be much worse than refusing.
  //
  // Unlike races (which have a real RaceSquad entity with slots, a captain
  // and an invite code), a Challenge carries only `mode` and
  // `eliminationScope` — there is no squad table, so there is no way to ask
  // "who is on this person's squad". Cascading over every ACTIVE participant
  // in the challenge, which is the only thing the data supports, would
  // eliminate the ENTIRE challenge because one stranger missed a day.
  //
  // So this falls back to eliminating just the individual and logs loudly.
  // Creation already refuses SQUAD (see schemas.ts), so reaching this branch
  // means a challenge was seeded straight into the database; treating it as
  // INDIVIDUAL is the conservative reading, since it takes exactly one
  // person's stake rather than everyone's.
  if (participant.challenge.mode === "SQUAD" && participant.challenge.eliminationScope === "WHOLE_GROUP") {
    console.error(
      `[challenges] challenge ${participant.challengeId} is SQUAD/WHOLE_GROUP, but squads are not implemented — ` +
        `eliminating only participant ${participantId} instead of cascading. Squad challenges should not be created yet.`
    );
  }

  await prisma.challengeParticipant.update({
    where: { id: participantId },
    data: { status: "ELIMINATED", eliminatedOnDay: day, currentStreak: 0 },
  });
  await notifyUser(participant.userId, "challenge_eliminated", {
    title: `You missed day ${day}`,
    body: `You're out of "${participant.challenge.title}". Your stake goes to whoever finishes.`,
    data: { challengeId: participant.challengeId },
  });
}

/**
 * Buys back one otherwise-disqualifying missed day. One per participant per
 * challenge (the schema's redemptionPurchased/redemptionUsed pair is a
 * single slot, not a counter) — charged immediately, and the fee is folded
 * straight into the pool at resolution, never kept by the platform.
 */
export async function purchaseRedemption(participantId: string) {
  return prisma.$transaction(async (tx) => {
    const participant = await tx.challengeParticipant.findUniqueOrThrow({ where: { id: participantId }, include: { challenge: true } });
    if (participant.status !== "ACTIVE") {
      throw new ChallengeError("not_active", "Redemptions are only available while you're still active in the challenge.");
    }
    if (participant.redemptionPurchased) {
      throw new ChallengeError("already_purchased", "You've already bought a redemption for this challenge.");
    }

    const debited = await tx.user.updateMany({
      where: { id: participant.userId, walletBalanceCents: { gte: REDEMPTION_FEE_CENTS } },
      data: { walletBalanceCents: { decrement: REDEMPTION_FEE_CENTS } },
    });
    if (debited.count === 0) {
      throw new ChallengeError("insufficient_balance", "Not enough wallet balance to buy a redemption.");
    }

    await tx.challengeParticipant.update({
      where: { id: participantId },
      data: { redemptionPurchased: true, redemptionFeeCents: REDEMPTION_FEE_CENTS },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: participant.userId,
        challengeId: participant.challengeId,
        type: "REDEMPTION_FEE",
        status: "COMPLETED",
        amountCents: -REDEMPTION_FEE_CENTS,
        currency: participant.challenge.currency,
        description: `Redemption bought — "${participant.challenge.title}" (added to the pool, not kept by Streak)`,
      },
    });

    return { purchased: true as const, feeCents: REDEMPTION_FEE_CENTS };
  });
}

/**
 * Resolves every ACTIVE challenge whose window has elapsed: split the full
 * pool — every non-withdrawn participant's stake, plus any redemption fees
 * charged — evenly among whoever is still ACTIVE at the end (i.e. never
 * missed an uncovered day). Zero platform cut anywhere in this function.
 *
 * If nobody finishes, there's no one to pay the pool to — everyone gets
 * their own stake back instead, which is the only fair outcome when the
 * pool has no recipient.
 */
export async function resolveDueChallenges(now = new Date()) {
  const due = await prisma.challenge.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, startDate: true, durationDays: true },
  });
  const readyIds = due.filter((c) => now.getTime() >= c.startDate.getTime() + c.durationDays * 86_400_000).map((c) => c.id);

  let resolved = 0;
  for (const id of readyIds) {
    const claimed = await prisma.challenge.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "COMPLETED" } });
    if (claimed.count === 0) continue; // another tick already claimed it

    const challenge = await prisma.challenge.findUniqueOrThrow({ where: { id } });
    const participants = await prisma.challengeParticipant.findMany({
      where: { challengeId: id, status: { not: "WITHDRAWN" } },
      orderBy: { joinedAt: "asc" },
    });

    const finishers = participants.filter((p) => p.status === "ACTIVE");
    const poolCents = participants.reduce((sum, p) => sum + p.stakeCents + (p.redemptionFeeCents ?? 0), 0);

    if (finishers.length === 0) {
      await refundEveryone(challenge.id, challenge.currency, participants);
    } else {
      await payFinishers(challenge.id, challenge.title, challenge.currency, finishers, poolCents);
      await markForfeited(challenge.id, challenge.currency, participants.filter((p) => p.status === "ELIMINATED"));
    }
    resolved++;
  }
  return { resolved, considered: readyIds.length };
}

async function refundEveryone(challengeId: string, currency: string, participants: ChallengeParticipant[]) {
  for (const p of participants) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: p.userId }, data: { walletBalanceCents: { increment: p.stakeCents } } }),
      prisma.challengeParticipant.update({ where: { id: p.id }, data: { escrowStatus: "RELEASED" } }),
      prisma.ledgerEntry.create({
        data: {
          userId: p.userId,
          challengeId,
          type: "STAKE_REFUND",
          status: "COMPLETED",
          amountCents: p.stakeCents,
          currency,
          description: "Nobody finished this challenge — stake refunded in full",
        },
      }),
    ]);
  }
}

/** Even split of the pool among finishers, remainder cents to whoever joined earliest — same dust-handling rule as races' squad prize split. */
async function payFinishers(challengeId: string, title: string, currency: string, finishers: ChallengeParticipant[], poolCents: number) {
  const share = Math.floor(poolCents / finishers.length);
  const dust = poolCents - share * finishers.length;

  for (const [i, p] of finishers.entries()) {
    const payoutCents = share + (i === 0 ? dust : 0);
    await prisma.$transaction([
      prisma.user.update({ where: { id: p.userId }, data: { walletBalanceCents: { increment: payoutCents } } }),
      prisma.challengeParticipant.update({ where: { id: p.id }, data: { escrowStatus: "RELEASED", status: "FINISHED" } }),
      prisma.ledgerEntry.create({
        data: {
          userId: p.userId,
          challengeId,
          type: "POOL_PAYOUT",
          status: "COMPLETED",
          amountCents: payoutCents,
          currency,
          description: `Finished "${title}" — share of the pool (${finishers.length} finisher${finishers.length === 1 ? "" : "s"}, zero platform cut)`,
        },
      }),
    ]);

    await notifyUser(p.userId, "challenge_resolved", {
      title: `You finished "${title}"`,
      body: `R${(payoutCents / 100).toLocaleString()} is in your wallet — your share of the pool, with nothing taken by Streak.`,
      data: { challengeId },
    });
  }
}

/** Audit marker only — the stake was already debited at join time; this just records where it went. */
async function markForfeited(challengeId: string, currency: string, eliminated: ChallengeParticipant[]) {
  for (const p of eliminated) {
    await prisma.$transaction([
      prisma.challengeParticipant.update({ where: { id: p.id }, data: { escrowStatus: "FORFEITED" } }),
      prisma.ledgerEntry.create({
        data: {
          userId: p.userId,
          challengeId,
          type: "STAKE_FORFEITED",
          status: "COMPLETED",
          amountCents: 0, // marker only — the debit already happened at join time
          currency,
          description: `Missed a required day (day ${p.eliminatedOnDay}) — stake moved into the finishers' pool`,
        },
      }),
    ]);
  }
}
