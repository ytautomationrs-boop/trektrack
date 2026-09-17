import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "@prisma/client";
import type { CreateChallengeInput } from "./schemas.js";

/**
 * StreakPot — pooled-stake challenges.
 *
 * The core difference from modules/races/service.ts, worth stating once: a
 * race's prize is fixed before anyone enters and never depends on who
 * shows up. A challenge's payout is the OPPOSITE by design — every cent
 * staked either comes back to the person who staked it or moves to another
 * finisher, with zero platform cut anywhere (see LedgerEntryType in
 * schema.prisma). That is what "pooled" means, and it's why this model
 * stays fully separate from races' fixed-prize machinery rather than
 * sharing any of it.
 */

export class ChallengeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function randomCode(): string {
  return randomBytes(5).toString("hex");
}

/**
 * Creates a challenge in DRAFT, immediately advanced to OPEN — there is no
 * separate "publish" step at pilot scale. Admin-only (enforced at the route
 * layer); everyone can still join a PUBLIC one or redeem an invite into an
 * INVITE_ONLY one.
 */
export async function createChallenge(params: { creatorId: string; input: CreateChallengeInput }) {
  const { input } = params;
  const startDate = new Date(input.startDate);
  if (startDate.getTime() <= Date.now()) {
    throw new ChallengeError("start_date_in_past", "A challenge's start date must be in the future.");
  }

  return prisma.challenge.create({
    data: {
      title: input.title,
      durationDays: input.durationDays,
      startDate,
      stakeCents: input.stakeCents,
      currency: input.currency,
      visibility: input.visibility,
      inviteCode: input.visibility === "INVITE_ONLY" ? randomCode() : null,
      status: "OPEN",
      mode: input.mode,
      maxParticipants: input.maxParticipants,
      eliminationScope: input.mode === "SQUAD" ? input.eliminationScope : null,
      tier: input.tier,
      creatorId: params.creatorId,
      metricRequirements: {
        create: input.metricRequirements.map((r) => ({
          metricKey: r.metricKey,
          dailyTarget: r.dailyTarget,
          paceTargetSecPerKm: r.paceTargetSecPerKm,
          startTimeMinutes: r.startTimeMinutes,
          endTimeMinutes: r.endTimeMinutes,
        })),
      },
    },
    include: { metricRequirements: true },
  });
}

/**
 * Joins a challenge, staking the fixed amount. Same conditional-debit
 * pattern as races' enterRace: the balance check is re-evaluated inside the
 * UPDATE itself, so two concurrent joins can't both spend the same balance.
 */
export async function joinChallenge(params: { userId: string; challengeId: string; inviteCode?: string; timezone: string }) {
  return prisma.$transaction(async (tx) => {
    // Serialises concurrent joins to THIS challenge behind one row lock —
    // needed because maxParticipants is a real cap being checked below.
    await tx.$queryRaw`SELECT id FROM "Challenge" WHERE id = ${params.challengeId} FOR UPDATE`;

    const challenge = await tx.challenge.findUnique({ where: { id: params.challengeId } });
    if (!challenge) throw new ChallengeError("not_found", "Challenge not found.");
    if (challenge.status !== "OPEN") {
      throw new ChallengeError("challenge_not_open", "This challenge is no longer accepting participants.");
    }

    if (challenge.visibility === "INVITE_ONLY") {
      if (!params.inviteCode || challenge.inviteCode !== params.inviteCode) {
        throw new ChallengeError("invalid_invite_code", "That invite code doesn't match this challenge.");
      }
    }

    const existing = await tx.challengeParticipant.findUnique({
      where: { challengeId_userId: { challengeId: params.challengeId, userId: params.userId } },
    });
    if (existing && existing.status !== "WITHDRAWN") {
      throw new ChallengeError("already_joined", "You're already in this challenge.");
    }

    if (challenge.maxParticipants != null) {
      const count = await tx.challengeParticipant.count({
        where: { challengeId: params.challengeId, status: { not: "WITHDRAWN" } },
      });
      if (count >= challenge.maxParticipants) {
        throw new ChallengeError("challenge_full", "This challenge has already reached its participant cap.");
      }
    }

    const debited = await tx.user.updateMany({
      where: { id: params.userId, walletBalanceCents: { gte: challenge.stakeCents } },
      data: { walletBalanceCents: { decrement: challenge.stakeCents } },
    });
    if (debited.count === 0) {
      throw new ChallengeError("insufficient_balance", "Not enough wallet balance to stake — top up your wallet first.");
    }

    const participantData = {
      status: "ACTIVE" as const,
      timezone: params.timezone,
      eliminatedOnDay: null,
      currentStreak: 0,
      priority: 1,
      stakeCents: challenge.stakeCents,
      escrowStatus: "HELD" as const,
      redemptionPurchased: false,
      redemptionUsed: false,
      redemptionFeeCents: null,
    };
    const participant = existing
      ? await tx.challengeParticipant.update({ where: { id: existing.id }, data: participantData })
      : await tx.challengeParticipant.create({ data: { challengeId: params.challengeId, userId: params.userId, ...participantData } });

    await tx.ledgerEntry.create({
      data: {
        userId: params.userId,
        challengeId: params.challengeId,
        type: "STAKE_HOLD",
        // PENDING, not COMPLETED — the stake isn't genuinely at risk until
        // the challenge actually starts. startDueChallenges() completes it.
        status: "PENDING",
        amountCents: -challenge.stakeCents,
        currency: challenge.currency,
        description: `Staked "${challenge.title}"`,
      },
    });

    return { challenge, participant };
  });
}

/**
 * Withdraws from a challenge before it starts, refunding the stake in full.
 * Once ACTIVE, there is no withdrawal — same reasoning as races locking:
 * other participants' odds (their share of the pool) depend on who's still
 * in, so leaving mid-challenge would need to be modelled as an elimination,
 * not a clean exit. Use the redemption flow if a day gets missed instead.
 */
export async function withdrawFromChallenge(params: { userId: string; challengeId: string }) {
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.challenge.findUnique({ where: { id: params.challengeId } });
    if (!challenge) throw new ChallengeError("not_found", "Challenge not found.");
    if (challenge.status !== "OPEN") {
      throw new ChallengeError("cannot_withdraw", "This challenge has already started — entries are final.");
    }

    const participant = await tx.challengeParticipant.findUnique({
      where: { challengeId_userId: { challengeId: params.challengeId, userId: params.userId } },
    });
    if (!participant || participant.status === "WITHDRAWN") {
      throw new ChallengeError("not_participant", "You're not currently in this challenge.");
    }

    await tx.challengeParticipant.update({ where: { id: participant.id }, data: { status: "WITHDRAWN" } });
    await tx.user.update({ where: { id: params.userId }, data: { walletBalanceCents: { increment: participant.stakeCents } }, select: { id: true } });
    await tx.ledgerEntry.updateMany({
      where: { userId: params.userId, challengeId: params.challengeId, type: "STAKE_HOLD", status: "PENDING" },
      data: { status: "REVERSED" },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: params.userId,
        challengeId: params.challengeId,
        type: "STAKE_REFUND",
        status: "COMPLETED",
        amountCents: participant.stakeCents,
        currency: challenge.currency,
        description: `Withdrew from "${challenge.title}" before it started`,
      },
    });

    return { withdrawn: true as const, refundedCents: participant.stakeCents };
  });
}

/** A shareable invite into an INVITE_ONLY challenge, distinct from the challenge's own top-level code so a specific person's invite can be tracked/expired individually. */
export async function createChallengeInvite(params: { challengeId: string; inviterId: string; inviteeEmail?: string }) {
  const challenge = await prisma.challenge.findUnique({ where: { id: params.challengeId } });
  if (!challenge) throw new ChallengeError("not_found", "Challenge not found.");
  return prisma.challengeInvite.create({
    data: { challengeId: params.challengeId, inviterId: params.inviterId, inviteeEmail: params.inviteeEmail, code: randomCode() },
  });
}

/** Resolves a challenge's own top-level invite code (not a per-person ChallengeInvite) — the code IS the invitation, same pattern as Race. */
export async function resolveChallengeByCode(code: string) {
  const challenge = await prisma.challenge.findUnique({
    where: { inviteCode: code.trim().toLowerCase() },
    include: { metricRequirements: { include: { metricType: true } } },
  });
  if (!challenge) throw new ChallengeError("not_found", "That invite code doesn't match any challenge.");
  return challenge;
}

/** Decorates a challenge with the fields the mobile/web client needs: participant count, whether the caller has joined, days remaining. */
export async function decorateChallenge(challenge: Prisma.ChallengeGetPayload<{ include: { metricRequirements: { include: { metricType: true } } } }>, userId: string) {
  const [participantCount, mine] = await Promise.all([
    prisma.challengeParticipant.count({ where: { challengeId: challenge.id, status: { not: "WITHDRAWN" } } }),
    prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId: challenge.id, userId } } }),
  ]);

  return {
    id: challenge.id,
    title: challenge.title,
    durationDays: challenge.durationDays,
    startDate: challenge.startDate,
    stakeCents: challenge.stakeCents,
    currency: challenge.currency,
    visibility: challenge.visibility,
    status: challenge.status,
    mode: challenge.mode,
    maxParticipants: challenge.maxParticipants,
    eliminationScope: challenge.eliminationScope,
    tier: challenge.tier,
    metricRequirements: challenge.metricRequirements.map((r) => ({
      metricKey: r.metricKey,
      displayName: r.metricType.displayName,
      unit: r.metricType.unit,
      dailyTarget: r.dailyTarget,
      paceTargetSecPerKm: r.paceTargetSecPerKm,
      startTimeMinutes: r.startTimeMinutes,
      endTimeMinutes: r.endTimeMinutes,
    })),
    participantCount,
    hasJoined: !!mine && mine.status !== "WITHDRAWN",
    myStatus: mine?.status ?? null,
    // Consecutive days passed so far — informational only, resets to 0 on
    // elimination (see resolution.ts eliminateParticipant). Null rather than
    // 0 when the caller was never a participant, so the client can tell
    // "not staking" apart from "staking, day one".
    myCurrentStreak: mine?.currentStreak ?? null,
    inviteCode: mine ? challenge.inviteCode : null, // only shown to people already in it, like Race
  };
}

/** PUBLIC challenges still OPEN, plus (mine=true) every challenge — any status — this user has ever joined. */
export async function listChallengesForUser(userId: string, scope: "mine" | "discover", limit: number) {
  const challenges =
    scope === "discover"
      ? await prisma.challenge.findMany({
          where: { visibility: "PUBLIC", status: "OPEN" },
          include: { metricRequirements: { include: { metricType: true } } },
          orderBy: { startDate: "asc" },
          take: limit,
        })
      : await prisma.challenge
          .findMany({
            where: { participants: { some: { userId, status: { not: "WITHDRAWN" } } } },
            include: { metricRequirements: { include: { metricType: true } } },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
          .then((rows) => rows);

  return Promise.all(challenges.map((c) => decorateChallenge(c, userId)));
}

export async function getChallengeForUser(challengeId: string, userId: string) {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: { metricRequirements: { include: { metricType: true } } },
  });
  if (!challenge) throw new ChallengeError("not_found", "Challenge not found.");
  return decorateChallenge(challenge, userId);
}
