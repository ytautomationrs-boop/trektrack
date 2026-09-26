import { stepSyncClosesAt } from "./syncWindow.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { liveStandings } from "../races/scoring.js";

export const SnapshotSchema = z.object({
  entryId: z.string().min(1), steps: z.number().int().min(0).max(10_000_000),
  windowStart: z.string().datetime(), windowEnd: z.string().datetime(), observedAt: z.string().datetime(),
});
export function snapshotError(s: z.infer<typeof SnapshotSchema>, start: Date, end: Date, now: Date): string | null {
  const from = new Date(s.windowStart), to = new Date(s.windowEnd), observed = new Date(s.observedAt);
  if (+from !== +start || to > end || to <= from || to.getTime() > now.getTime() + 60_000 || observed < to || observed.getTime() > now.getTime() + 60_000) return "Invalid competition time window.";
  if (s.steps > Math.ceil((+to - +from) / 60_000) * 250) return "Step count exceeds a plausible rate.";
  return null;
}

export async function healthCompetitionRoutes(app: FastifyInstance) {
  app.get("/health/competitions", { preHandler: requireAuth }, async (req) => {
    const entries = await prisma.raceEntry.findMany({
      where: { userId: req.userId, status: "ENTERED", race: { metricKey: "steps", status: { in: ["FILLING", "LOCKED", "RUNNING"] } } },
      include: { race: true, healthSteps: true }, orderBy: { joinedAt: "desc" },
    });
    const windowsOnly = (req.query as { windowsOnly?: string }).windowsOnly === "true";
    return { competitions: await Promise.all(entries.map(async (entry) => {
      const { race } = entry;
      if (windowsOnly) return {entryId:entry.id,raceId:race.id,status:race.endsAt && new Date() > stepSyncClosesAt(race.metricKey,race.endsAt) ? "SYNC_CLOSED" : race.status,windowStart:race.startedAt,windowEnd:race.endsAt};
      const standing = await liveStandings(race.id);
      const own = standing.individuals.find(r => r.entryId === entry.id);
      const squad = standing.squads.find(s => s.members.some(m => m.entryId === entry.id));
      const ranked = own ?? squad;
      return { entryId: entry.id, raceId: race.id, name: race.name, status: race.status,
        windowStart: race.startedAt, windowEnd: race.endsAt, scheduledStartAt: race.scheduledStartAt,
        syncClosesAt: race.endsAt ? stepSyncClosesAt(race.metricKey, race.endsAt) : null,
        windowEnded: !!race.endsAt && race.endsAt < new Date(),
        steps: own?.total ?? squad?.members.find(m => m.entryId === entry.id)?.total ?? 0,
        position: race.status === "RUNNING" ? ranked?.position ?? null : null,
        participants: standing.format === "INDIVIDUAL" ? standing.individuals.length : standing.squads.length,
        squad: !!squad, lastSyncedAt: entry.healthSteps?.updatedAt ?? null,
      };
    })) };
  });
  app.post("/health/competitions/steps", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = SnapshotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: "Invalid step snapshot." });
    const s = parsed.data;
    return prisma.$transaction(async tx => {
      // Lock race before entry, matching resolution. No uploads after payout.
      const entry = await tx.raceEntry.findUnique({ where: { id: s.entryId }, include: { race: true } });
      if (!entry || entry.userId !== req.userId) return reply.code(404).send({ message: "Competition entry not found." });
      await tx.$queryRaw`SELECT id FROM "Race" WHERE id = ${entry.raceId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "RaceEntry" WHERE id = ${entry.id} FOR UPDATE`;
      const current = await tx.raceEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { race: true } });
      const r = current.race;
      if (r.status !== "RUNNING" || current.status !== "ENTERED" || r.metricKey !== "steps" || !r.startedAt || !r.endsAt) return reply.code(409).send({ message: "This step competition is not running." });
      if (new Date() > stepSyncClosesAt(r.metricKey, r.endsAt)) return reply.code(409).send({message:"The final sync window has closed."});
      const error = snapshotError(s, r.startedAt, r.endsAt, new Date());
      if (error) return reply.code(400).send({ message: error });
      const previous = await tx.healthStepSnapshot.findUnique({ where: { raceEntryId: entry.id } });
      // Late/offline requests cannot overwrite a newer reading. Lower totals
      // with a newer observation are valid when Health removes a sample.
      if (previous && (previous.observedAt >= new Date(s.observedAt) || previous.windowEnd > new Date(s.windowEnd))) return { saved: true, stale: true };
      const data = { steps: s.steps, windowStart: new Date(s.windowStart), windowEnd: new Date(s.windowEnd), observedAt: new Date(s.observedAt) };
      await tx.healthStepSnapshot.upsert({ where: { raceEntryId: entry.id }, create: { raceEntryId: entry.id, ...data }, update: data });
      return { saved: true };
    });
  });
}
