import type { FastifyInstance, FastifyReply } from "fastify";
import { ensureCompetitionCatalog, ensureRaceTypeForUserCreatedRace, getCompetitionRaceTypesPayload } from "../../lib/competitionCatalog.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import {
  CreateRaceSchema,
  DisqualifySchema,
  EnterRaceSchema,
  ListRacesQuerySchema,
  OpenLeagueSchema,
  SubmitRaceSamplesSchema,
} from "./schemas.js";
import {
  RaceError,
  adminCancelRace,
  cancelRaceEntry,
  createPrivateRaceAndEnter,
  decorateRace,
  enterRace,
  getRaceForUser,
  listOpenRacesForUser,
  listUserRaceEntries,
  resolveSquadByCode,
} from "./service.js";
import { ingestRaceSamples, liveStandings, syncStravaForEntry } from "./scoring.js";
import { parseWorkoutFile, workoutToSample, WorkoutFileError } from "../imports/workoutFile.js";
import { WalletError } from "../wallet/service.js";
import {
  LeagueError,
  getAllLeagueStates,
  getLeagueStandings,
  getMetricStanding,
  getPointHistory,
  leagueOpenReadiness,
  openLeagueLevel,
} from "./leagues.js";
import { disqualifyEntry, forfeitHeldPrize } from "./resolution.js";

function sendRaceError(reply: FastifyReply, err: unknown) {
  if (err instanceof RaceError) {
    const status = err.code === "insufficient_balance" ? 402 : err.code === "not_found" ? 404 : 400;
    return reply.code(status).send({ error: err.code, message: err.message });
  }
  if (err instanceof WalletError) {
    const status = err.code === "insufficient_balance" ? 402 : 400;
    return reply.code(status).send({ error: err.code, message: err.message });
  }
  if (err instanceof LeagueError) {
    return reply.code(400).send({ error: err.code, message: err.message });
  }
  throw err;
}

export async function raceRoutes(app: FastifyInstance) {
  // ── Config discovery ────────────────────────────────────────────────────

  // The pre-announced prize schedules, readable before entering anything.
  // "Pre-announced" is only meaningful if it is actually announced, so this
  // is deliberately available without entering a race.
  app.get("/race-types", async (_req, reply) => {
    return reply.send({ raceTypes: getCompetitionRaceTypesPayload() });
  });

  // Every metric's league ladder. A level is only meaningful within a
  // metric, so these are grouped rather than returned as one list.
  app.get("/leagues", async (_req, reply) => {
    await ensureCompetitionCatalog();
    const levels = await prisma.leagueLevel.findMany({
      orderBy: [{ metricKey: "asc" }, { level: "asc" }],
    });
    const byMetric: Record<string, typeof levels> = {};
    for (const l of levels) (byMetric[l.metricKey] ??= []).push(l);
    return reply.send({ leaguesByMetric: byMetric });
  });

  // ── Races ───────────────────────────────────────────────────────────────

  app.get("/races", { preHandler: requireAuth }, async (req, reply) => {
    await ensureCompetitionCatalog();
    const q = ListRacesQuerySchema.parse(req.query);

    if (q.scope === "my_league") {
      const races = await listOpenRacesForUser(req.userId);
      const filtered = races
        .filter((r) => (q.metricKey ? r.metricKey === q.metricKey : true))
        .filter((r) => (q.format ? r.format === q.format : true))
        .slice(0, q.limit);
      return reply.send({ races: filtered });
    }

    const races = await prisma.race.findMany({
      where: {
        status: "FILLING",
        ...(q.metricKey ? { metricKey: q.metricKey } : {}),
        ...(q.format ? { format: q.format } : {}),
      },
      include: {
        entries: { select: { id: true, userId: true, squadId: true, status: true } },
        squads: { select: { id: true, name: true, slotIndex: true, captainUserId: true, joinPolicy: true, inviteCode: true } },
        league: { select: { level: true, name: true } },
        raceType: {
          select: {
            key: true,
            displayName: true,
            metricKey: true,
            format: true,
            metricType: { select: { key: true, displayName: true, unit: true, valueType: true, icon: true } },
          },
        },
      },
      orderBy: [{ leagueLevel: "asc" }, { signupOpensAt: "asc" }],
      take: q.limit,
    });
    // One level per metric, so "can I enter this?" is answered against the
    // user's standing in THAT race's metric, not a single global level.
    const states = await getAllLeagueStates(req.userId);
    const levelByMetric = new Map(states.map((s) => [s.metricKey, s.currentLevel]));
    return reply.send({
      races: races.map((r) => ({
        ...decorateRace(r, req.userId),
        // Visible but not joinable — shown so progression is legible, never
        // presented as something the user failed to qualify for.
        enterable: levelByMetric.get(r.metricKey) === r.leagueLevel,
      })),
    });
  });

  /**
   * Create a race. Always private, always in the creator's own league, and
   * the creator is entered and charged as entrant 1 of N.
   *
   * Private races can accept a host-set entry fee; prizes are calculated
   * server-side from that fee and snapshotted onto the race.
   */
  // Pilot: only admin-flagged accounts can create races (regular users can
  // still enter/withdraw/view normally). See middleware/auth.ts requireAdmin.
  app.post("/races", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const body = CreateRaceSchema.parse(req.body);

    const raceType = await ensureRaceTypeForUserCreatedRace(body.metricKey, body.durationDays, body.format);
    try {
      const result = await createPrivateRaceAndEnter({
        userId: req.userId,
        raceTypeKey: raceType.key,
        name: body.name,
        visibility: body.visibility,
        entryFeeCents: body.entryFeeCents,
        squadName: body.squadName,
        squadJoinPolicy: body.squadJoinPolicy,
      });
      return reply.code(201).send(result);
    } catch (err) {
      return sendRaceError(reply, err);
    }
  });

  app.get("/races/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      // getRaceForUser already decorates (prizes, fill counts, squads) — the
      // client depends on those being present.
      const race = await getRaceForUser(id, req.userId);
      const standings = race.status === "FILLING" ? null : await liveStandings(id);
      return reply.send({
        race,
        standings,
        // Provisional until resolvedAt is set — the mobile client shows
        // ordering mid-race but never a final position.
        standingsAreProvisional: race.status !== "COMPLETED",
        // Lets the client pick its own row out of `standings` (via
        // race.entries[].userId) to show "your" position/gap without the
        // server having to annotate every row.
        viewerUserId: req.userId,
      });
    } catch (err) {
      return sendRaceError(reply, err);
    }
  });

  app.post("/races/:id/enter", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = EnterRaceSchema.parse(req.body ?? {});
    try {
      const result = await enterRace({
        userId: req.userId,
        raceId: id,
        squadId: body.squadId,
        squadInviteCode: body.squadInviteCode,
        squadName: body.squadName,
        squadJoinPolicy: body.squadJoinPolicy,
        acceptLowerLeague: body.acceptLowerLeague,
      });
      return reply.code(201).send(result);
    } catch (err) {
      return sendRaceError(reply, err);
    }
  });

  /**
   * Withdraws the caller's own entry — full refund — while the race is still
   * FILLING. Refused once it has LOCKED: reaching the exact headcount is
   * unconditional the instant it happens, so there is no partial-field state
   * to un-commit from past that point.
   */
  app.post("/races/:id/withdraw", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.send(await cancelRaceEntry({ userId: req.userId, raceId: id }));
    } catch (err) {
      return sendRaceError(reply, err);
    }
  });

  // Resolves a private race's invite code to the race itself, so an invitee
  // can see the format, fee and prize schedule before committing.
  app.get("/races/by-code/:code", { preHandler: requireAuth }, async (req, reply) => {
    const { code } = req.params as { code: string };
    const race = await prisma.race.findUnique({
      where: { inviteCode: code.trim().toLowerCase() },
      include: {
        entries: { select: { id: true, userId: true, squadId: true, status: true } },
        squads: { select: { id: true, name: true, slotIndex: true, captainUserId: true, joinPolicy: true, inviteCode: true } },
        league: { select: { level: true, name: true } },
        raceType: {
          select: {
            key: true,
            displayName: true,
            metricKey: true,
            format: true,
            metricType: { select: { key: true, displayName: true, unit: true, valueType: true, icon: true } },
          },
        },
      },
    });
    if (!race) return reply.code(404).send({ error: "invalid_race_code", message: "That race code doesn't match any race." });
    return reply.send({ race: decorateRace(race, req.userId) });
  });

  // Resolves a shared squad code to the squad and race it belongs to, so the
  // invitee can see what they are joining — squad, race, entry fee, prizes —
  // before any money moves. Read-only; it does not join anything.
  app.get("/race-squads/by-code/:code", { preHandler: requireAuth }, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      return reply.send(await resolveSquadByCode(code, req.userId));
    } catch (err) {
      return sendRaceError(reply, err);
    }
  });

  // ── Evidence ────────────────────────────────────────────────────────────

  app.post("/race-entries/:id/samples", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = SubmitRaceSamplesSchema.parse(req.body);

    const entry = await prisma.raceEntry.findUnique({ where: { id } });
    if (!entry) return reply.code(404).send({ error: "not_found" });
    if (entry.userId !== req.userId) return reply.code(403).send({ error: "forbidden" });

    const result = await ingestRaceSamples(id, body.samples);
    return reply.send(result);
  });

  /**
   * Imports a workout file exported from a watch or training app.
   *
   * This is the pilot's primary evidence path, replacing the Strava sync
   * below — a browser has no health store, and asking people to connect a
   * third-party account was a bigger ask than exporting a file they already
   * have. It covers running, cycling and swimming; steps and sleep are daily
   * totals rather than activities and have no file to export, which the UI
   * states rather than scoring them zero.
   *
   * Deliberately joins the SAME ingestion path as HealthKit samples and the
   * Strava sync: parse to the common sample shape, then hand to
   * ingestRaceSamples so validation, the sourceBundleId dedup guard, anomaly
   * detection and evidence retention all apply unchanged. Nothing about a
   * file import is special-cased downstream.
   *
   * A file is supplied by the person being scored, so it is not evidence the
   * way a health-store read is. What it gets is a physical-possibility check
   * here, the anomaly rules after that, and — while payouts are sent by hand
   * — a human looking at it before any money leaves.
   */
  app.post("/race-entries/:id/import", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const entry = await prisma.raceEntry.findUnique({ where: { id }, include: { race: true } });
    if (!entry) return reply.code(404).send({ error: "not_found" });
    if (entry.userId !== req.userId) return reply.code(403).send({ error: "forbidden" });

    const upload = await req.file();
    if (!upload) return reply.code(400).send({ error: "no_file", message: "Attach a GPX, TCX or FIT file." });

    let buffer: Buffer;
    try {
      buffer = await upload.toBuffer();
    } catch {
      // @fastify/multipart throws this when the 8MB limit is hit mid-stream.
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

    // The race is for one metric. Importing a ride into a running race would
    // otherwise be scored as if it counted.
    if (parsed.metricKey !== entry.race.metricKey) {
      return reply.code(400).send({
        error: "wrong_sport",
        message: `That file is a ${parsed.metricKey} activity, and this race is scored on ${entry.race.metricKey}.`,
      });
    }

    const result = await ingestRaceSamples(id, [workoutToSample(parsed)]);
    return reply.send({
      ...result,
      imported: {
        format: parsed.format,
        metricKey: parsed.metricKey,
        distanceMeters: Math.round(parsed.distanceMeters),
        startTime: parsed.startTime.toISOString(),
        source: parsed.sourceName,
      },
    });
  });

  app.post("/race-entries/:id/sync-strava", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const entry = await prisma.raceEntry.findUnique({ where: { id } });
    if (!entry) return reply.code(404).send({ error: "not_found" });
    if (entry.userId !== req.userId) return reply.code(403).send({ error: "forbidden" });

    const result = await syncStravaForEntry(id);
    return reply.send(result ?? { accepted: 0, rejected: [], flagsRaised: 0, skipped: "no_strava_connection" });
  });

  // ── The user's own standing ─────────────────────────────────────────────

  /**
   * All four league standings — one per metric — plus which to lead with.
   *
   * There is no combined total and no global rank. Summing four independent
   * progressions would invent a number that means nothing: a user's running
   * league says nothing about their swimming.
   */
  app.get("/me/leagues", { preHandler: requireAuth }, async (req, reply) => {
    await ensureCompetitionCatalog();
    return reply.send(await getLeagueStandings(req.userId));
  });

  /** One metric's standing on its own. */
  app.get("/me/leagues/:metricKey", { preHandler: requireAuth }, async (req, reply) => {
    await ensureCompetitionCatalog();
    const { metricKey } = req.params as { metricKey: string };
    return reply.send(await getMetricStanding(req.userId, metricKey));
  });

  app.get("/me/league/history", { preHandler: requireAuth }, async (req, reply) => {
    const { metricKey } = req.query as { metricKey?: string };
    return reply.send({ entries: await getPointHistory(req.userId, metricKey) });
  });

  app.get("/me/races", { preHandler: requireAuth }, async (req, reply) => {
    return reply.send({ entries: await listUserRaceEntries(req.userId) });
  });

  // ── Admin ───────────────────────────────────────────────────────────────
  // Same posture as the existing /admin/* routes: no separate admin-role
  // system exists in this demo, and in production these would sit behind an
  // internal-only auth scope rather than a regular user JWT.

  // Fill-rate report. This is the operational answer to the scalability
  // constraint: it shows, per race type and league, how often races actually
  // reach their exact headcount versus cancel unfilled — the number that
  // says whether the league structure can support subdividing further.
  app.get("/admin/races/fill-report", { preHandler: [requireAuth, requireAdmin] }, async (_req, reply) => {
    const races = await prisma.race.groupBy({
      by: ["raceTypeKey", "leagueLevel", "status"],
      _count: { _all: true },
    });

    const byBucket = new Map<string, { raceTypeKey: string; leagueLevel: number; filled: number; cancelled: number; filling: number }>();
    for (const row of races) {
      const key = `${row.raceTypeKey}:${row.leagueLevel}`;
      const bucket = byBucket.get(key) ?? { raceTypeKey: row.raceTypeKey, leagueLevel: row.leagueLevel, filled: 0, cancelled: 0, filling: 0 };
      if (row.status === "CANCELLED_UNFILLED") bucket.cancelled += row._count._all;
      else if (row.status === "FILLING") bucket.filling += row._count._all;
      else bucket.filled += row._count._all;
      byBucket.set(key, bucket);
    }

    const buckets = [...byBucket.values()].map((b) => {
      const decided = b.filled + b.cancelled;
      return { ...b, fillRate: decided === 0 ? null : b.filled / decided };
    });

    return reply.send({
      buckets,
      // A low fill rate anywhere is the signal NOT to add more leagues or
      // race types — each one splits the same entrants further.
      note: "fillRate is filled / (filled + cancelled). Adding leagues or race types divides the same entrants across more buckets.",
    });
  });

  // Readiness is per (metric, level): steps may be ready to open League 2
  // while swimming has nobody at all.
  app.get("/admin/leagues/readiness", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const { metricKey } = req.query as { metricKey?: string };
    const levels = await prisma.leagueLevel.findMany({
      where: metricKey ? { metricKey } : {},
      orderBy: [{ metricKey: "asc" }, { level: "asc" }],
    });
    const readiness = await Promise.all(levels.map((l) => leagueOpenReadiness(l.metricKey, l.level)));
    return reply.send({ levels: readiness });
  });

  app.post("/admin/leagues/:metricKey/:level/open", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const { metricKey } = req.params as { metricKey: string };
    const level = Number((req.params as { level: string }).level);
    const body = OpenLeagueSchema.parse(req.body ?? {});
    try {
      return reply.send(await openLeagueLevel(metricKey, level, { force: body.force }));
    } catch (err) {
      return sendRaceError(reply, err);
    }
  });

  app.get("/admin/races/review-queue", { preHandler: [requireAuth, requireAdmin] }, async (_req, reply) => {
    const flags = await prisma.raceAnomalyFlag.findMany({
      where: { status: "OPEN" },
      include: { sample: { include: { raceEntry: { include: { user: { select: { id: true, displayName: true } }, race: true } } } } },
      orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
      take: 100,
    });
    const heldPrizes = await prisma.ledgerEntry.findMany({
      where: { type: "RACE_PRIZE", status: "PENDING" },
      include: { user: { select: { id: true, displayName: true } }, race: true },
    });
    return reply.send({ flags, heldPrizes });
  });

  app.post("/admin/race-entries/:id/disqualify", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = DisqualifySchema.parse(req.body);
    try {
      return reply.send(await disqualifyEntry(id, body.reason, req.userId));
    } catch (err) {
      return sendRaceError(reply, err);
    }
  });

  /**
   * Manually cancels a race that has been FILLING for so long it's clearly
   * never going to reach its headcount, refunding every entry fee in full.
   * There is no automatic equivalent — fill has no deadline, so this only
   * ever happens as a deliberate operator decision about one specific race.
   */
  app.post("/admin/races/:id/cancel", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = DisqualifySchema.parse(req.body); // { reason }
    try {
      return reply.send(await adminCancelRace(id, body.reason, req.userId));
    } catch (err) {
      return sendRaceError(reply, err);
    }
  });

  app.post("/admin/race-prizes/:ledgerEntryId/forfeit", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const { ledgerEntryId } = req.params as { ledgerEntryId: string };
    const body = DisqualifySchema.parse(req.body);
    try {
      return reply.send(await forfeitHeldPrize(ledgerEntryId, body.reason, req.userId));
    } catch (err) {
      return sendRaceError(reply, err);
    }
  });
}
