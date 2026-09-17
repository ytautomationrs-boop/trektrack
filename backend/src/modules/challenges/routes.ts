import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import {
  CreateChallengeInviteSchema,
  CreateChallengeSchema,
  JoinChallengeSchema,
  ListChallengesQuerySchema,
  SubmitCheckInSamplesSchema,
} from "./schemas.js";
import {
  ChallengeError,
  createChallenge,
  createChallengeInvite,
  getChallengeForUser,
  joinChallenge,
  listChallengesForUser,
  resolveChallengeByCode,
  withdrawFromChallenge,
} from "./service.js";
import { ingestChallengeCheckIn } from "./scoring.js";
import { parseWorkoutFile, workoutToSample, WorkoutFileError } from "../imports/workoutFile.js";
import { formatInTimeZone } from "date-fns-tz";
import { purchaseRedemption } from "./resolution.js";

function sendChallengeError(reply: FastifyReply, err: unknown) {
  if (err instanceof ChallengeError) {
    const status =
      err.code === "insufficient_balance" ? 402 : err.code === "not_found" ? 404 : err.code === "invalid_invite_code" ? 403 : 400;
    return reply.code(status).send({ error: err.code, message: err.message });
  }
  throw err;
}

export async function challengeRoutes(app: FastifyInstance) {
  /**
   * StreakPot's own view of the metric registry — the counterpart to
   * /metric-types, which is deliberately race-only.
   *
   * Two differences, both from the model: this one INCLUDES sleep (fine as a
   * personal daily target, unfair as a ranked race), and it exposes the
   * target-configuration columns (min/max/default/step, pace support) that a
   * race has no concept of but a challenge's creation flow needs.
   */
  app.get("/streakpot/metric-types", { preHandler: requireAuth }, async (_req, reply) => {
    const metricTypes = await prisma.metricTypeDefinition.findMany({
      where: { isActive: true },
      select: {
        key: true,
        displayName: true,
        unit: true,
        valueType: true,
        icon: true,
        minTarget: true,
        maxTarget: true,
        defaultTarget: true,
        beginnerTarget: true,
        advancedTarget: true,
        stepSize: true,
        supportsPaceTarget: true,
        vizType: true,
      },
      orderBy: { key: "asc" },
    });
    return reply.send({ metricTypes });
  });

  /**
   * Open anomaly flags raised against challenge evidence — the StreakPot
   * counterpart to /admin/races/review-queue.
   *
   * Note what it deliberately does NOT include: a "held payouts" list. A
   * held race prize is a platform liability that simply isn't paid, so
   * holding it is unambiguous. A pool share is other participants' money
   * that has already been divided, so holding one raises a question with no
   * obvious answer — does a forfeited share return to the other finishers,
   * or to whoever staked it? Until that's decided, flags are surfaced for a
   * human to act on through disqualification rather than silently gating
   * money. See modules/challenges/README.md.
   */
  app.get("/admin/challenges/review-queue", { preHandler: [requireAuth, requireAdmin] }, async (_req, reply) => {
    const flags = await prisma.challengeAnomalyFlag.findMany({
      where: { status: "OPEN" },
      include: {
        sample: {
          include: {
            participant: {
              include: {
                user: { select: { id: true, displayName: true } },
                challenge: { select: { id: true, title: true, stakeCents: true, status: true } },
              },
            },
          },
        },
      },
      orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
      take: 100,
    });
    return reply.send({ flags });
  });

  // ── Browse ───────────────────────────────────────────────────────────────

  app.get("/challenges", { preHandler: requireAuth }, async (req, reply) => {
    const query = ListChallengesQuerySchema.parse(req.query);
    const challenges = await listChallengesForUser(req.userId, query.scope, query.limit);
    return reply.send({ challenges });
  });

  app.get("/challenges/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.send(await getChallengeForUser(id, req.userId));
    } catch (err) {
      return sendChallengeError(reply, err);
    }
  });

  app.get("/challenges/by-code/:code", { preHandler: requireAuth }, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      const challenge = await resolveChallengeByCode(code);
      return reply.send({ challenge: await getChallengeForUser(challenge.id, req.userId) });
    } catch (err) {
      return sendChallengeError(reply, err);
    }
  });

  // ── Creation — pilot: admin-flagged accounts only ───────────────────────

  app.post("/challenges", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const body = CreateChallengeSchema.parse(req.body);
    try {
      const challenge = await createChallenge({ creatorId: req.userId, input: body });
      return reply.code(201).send({ challenge });
    } catch (err) {
      return sendChallengeError(reply, err);
    }
  });

  // ── Joining / leaving ────────────────────────────────────────────────────

  app.post("/challenges/:id/join", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = JoinChallengeSchema.parse(req.body ?? {});
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { timezone: true } });
    try {
      const { participant } = await joinChallenge({ userId: req.userId, challengeId: id, inviteCode: body.inviteCode, timezone: user.timezone });
      return reply.code(201).send({ participant, challenge: await getChallengeForUser(id, req.userId) });
    } catch (err) {
      return sendChallengeError(reply, err);
    }
  });

  app.post("/challenges/:id/withdraw", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.send(await withdrawFromChallenge({ userId: req.userId, challengeId: id }));
    } catch (err) {
      return sendChallengeError(reply, err);
    }
  });

  // Anyone already in an INVITE_ONLY challenge (creator or participant) can
  // pull others in — same "the code is the invitation" model as Race, plus
  // a per-person tracked variant for knowing who invited whom.
  app.post("/challenges/:id/invites", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = CreateChallengeInviteSchema.parse(req.body ?? {});

    const challenge = await prisma.challenge.findUnique({ where: { id } });
    if (!challenge) return reply.code(404).send({ error: "not_found" });
    const participant = await prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId: id, userId: req.userId } } });
    if (challenge.creatorId !== req.userId && (!participant || participant.status === "WITHDRAWN")) {
      return reply.code(403).send({ error: "forbidden", message: "Only the creator or a current participant can invite others." });
    }

    try {
      const invite = await createChallengeInvite({ challengeId: id, inviterId: req.userId, inviteeEmail: body.inviteeEmail });
      return reply.code(201).send({ invite });
    } catch (err) {
      return sendChallengeError(reply, err);
    }
  });

  // ── Daily check-in ───────────────────────────────────────────────────────

  app.post("/challenge-participants/:id/check-in", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = SubmitCheckInSamplesSchema.parse(req.body);

    const participant = await prisma.challengeParticipant.findUnique({ where: { id } });
    if (!participant) return reply.code(404).send({ error: "not_found" });
    if (participant.userId !== req.userId) return reply.code(403).send({ error: "forbidden" });

    const result = await ingestChallengeCheckIn(id, body.localDate, body.samples);
    return reply.send(result);
  });

  /**
   * Imports a workout file against one day of a challenge.
   *
   * The StreakPot counterpart to the race import route. Without it a browser
   * had no way to check in at all: syncChallengeCheckIn reads the device
   * health store, and there isn't one on the web — so a web participant
   * would have staked money into a challenge they could never pass a day of.
   *
   * The day is derived from when the activity happened, in the participant's
   * own timezone, rather than taken from the request. A run at 23:40 belongs
   * to the day it was run, and letting the client name the date would let
   * someone move a workout onto whichever day they still needed.
   */
  app.post("/challenge-participants/:id/import", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const participant = await prisma.challengeParticipant.findUnique({
      where: { id },
      include: { challenge: { include: { metricRequirements: true } } },
    });
    if (!participant) return reply.code(404).send({ error: "not_found" });
    if (participant.userId !== req.userId) return reply.code(403).send({ error: "forbidden" });

    const upload = await req.file();
    if (!upload) return reply.code(400).send({ error: "no_file", message: "Attach a GPX, TCX or FIT file." });

    let buffer: Buffer;
    try {
      buffer = await upload.toBuffer();
    } catch {
      return reply.code(413).send({ error: "file_too_large", message: "That file is over 8MB — larger than any single activity should be." });
    }
    if (upload.file.truncated) {
      return reply.code(413).send({ error: "file_too_large", message: "That file is over 8MB — larger than any single activity should be." });
    }

    let parsed;
    try {
      parsed = parseWorkoutFile(buffer, upload.filename ?? "activity");
    } catch (err) {
      if (err instanceof WorkoutFileError) return reply.code(400).send({ error: err.code, message: err.message });
      throw err;
    }

    // A multi-metric challenge has several requirements; the file only
    // counts if it is for one of them.
    const wanted = participant.challenge.metricRequirements.map((r) => r.metricKey);
    if (!wanted.includes(parsed.metricKey)) {
      return reply.code(400).send({
        error: "wrong_sport",
        message: `That file is a ${parsed.metricKey} activity, and this challenge is scored on ${wanted.join(" and ")}.`,
      });
    }

    // Which local day this belongs to, in the participant's timezone.
    const localDate = formatInTimeZone(parsed.startTime, participant.timezone, "yyyy-MM-dd");

    const result = await ingestChallengeCheckIn(id, localDate, [workoutToSample(parsed)]);
    return reply.send({
      ...result,
      imported: {
        format: parsed.format,
        metricKey: parsed.metricKey,
        distanceMeters: Math.round(parsed.distanceMeters),
        localDate,
        source: parsed.sourceName,
      },
    });
  });

  app.post("/challenge-participants/:id/redemption", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const participant = await prisma.challengeParticipant.findUnique({ where: { id } });
    if (!participant) return reply.code(404).send({ error: "not_found" });
    if (participant.userId !== req.userId) return reply.code(403).send({ error: "forbidden" });

    try {
      return reply.send(await purchaseRedemption(id));
    } catch (err) {
      return sendChallengeError(reply, err);
    }
  });

  // ── The user's own history ───────────────────────────────────────────────

  app.get("/me/challenge-history", { preHandler: requireAuth }, async (req, reply) => {
    const participations = await prisma.challengeParticipant.findMany({
      where: { userId: req.userId },
      include: { challenge: { include: { metricRequirements: { include: { metricType: true } } } } },
      orderBy: { joinedAt: "desc" },
    });
    return reply.send({
      entries: participations.map((p) => ({
        id: p.id,
        challengeId: p.challengeId,
        status: p.status,
        stakeCents: p.stakeCents,
        currentStreak: p.currentStreak,
        eliminatedOnDay: p.eliminatedOnDay,
        redemptionPurchased: p.redemptionPurchased,
        redemptionUsed: p.redemptionUsed,
        joinedAt: p.joinedAt,
        challenge: {
          id: p.challenge.id,
          title: p.challenge.title,
          status: p.challenge.status,
          durationDays: p.challenge.durationDays,
          mode: p.challenge.mode,
          metricRequirements: p.challenge.metricRequirements.map((r) => ({ metricKey: r.metricKey, dailyTarget: r.dailyTarget })),
        },
      })),
    });
  });
}
