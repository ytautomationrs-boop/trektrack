import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";

// Human review + reporting backstop.
//
// The /admin routes here are gated by requireAdmin (User.isAdmin), same as
// the ones in modules/races. They were previously wide open, which mattered
// more than it might look: /admin/reports exposes who reported whom and why,
// and resolving a flag as DISMISSED RELEASES A HELD PRIZE — so an
// unauthenticated caller could clear their own anti-fraud flags and collect.

const ReportSchema = z.object({
  reportedUserId: z.string().min(1),
  raceId: z.string().optional(),
  reason: z.string().min(3).max(500),
});

const ReviewDecisionSchema = z.object({
  decision: z.enum(["DISMISSED", "CONFIRMED_CHEAT"]),
  // `reviewedBy` used to be here — a free-text, client-supplied, OPTIONAL
  // field the caller could set to anything, or leave blank, on the single
  // most sensitive action in this file: DISMISSED releases a held prize.
  // Who reviewed it now comes from the verified admin's own session
  // (req.userId below), the same as every other admin-action attribution
  // added this session — never something the client gets to assert.
});

export async function anomalyRoutes(app: FastifyInstance) {
  app.post("/reports", { preHandler: requireAuth }, async (req, reply) => {
    const body = ReportSchema.parse(req.body);
    const report = await prisma.report.create({
      data: {
        reporterId: req.userId,
        reportedUserId: body.reportedUserId,
        raceId: body.raceId,
        reason: body.reason,
      },
    });
    return reply.code(201).send(report);
  });

  app.get("/admin/reports", { preHandler: [requireAuth, requireAdmin] }, async (_req, reply) => {
    const reports = await prisma.report.findMany({
      where: { status: "OPEN" },
      include: {
        reporter: { select: { id: true, displayName: true } },
        reported: { select: { id: true, displayName: true } },
        race: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return reply.send({ reports });
  });

  /**
   * Resolve one anomaly flag raised against race evidence.
   *
   * DISMISSED releases any prize being held on that entry (the release job
   * picks it up on its next pass); CONFIRMED_CHEAT is acted on through
   * /admin/race-entries/:id/disqualify in modules/races, which also ranks
   * the entrant last and forfeits their fee.
   */
  app.post("/admin/race-flags/:flagId", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const { flagId } = req.params as { flagId: string };
    const body = ReviewDecisionSchema.parse(req.body);

    const updated = await prisma.raceAnomalyFlag.updateMany({
      where: { id: flagId, status: "OPEN" },
      data: { status: body.decision, reviewedByUserId: req.userId, reviewedAt: new Date() },
    });
    if (updated.count === 0) {
      return reply.code(404).send({ error: "not_found", message: "No open flag with that id." });
    }
    return reply.send({ ok: true, decision: body.decision });
  });
}
