import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

/**
 * A user's own money and record.
 *
 * Replaces what modules/payouts served under the pooled model. The shape
 * changed with the model: there is no "challenges played", no "streak", and
 * deliberately no global rank of any kind — progress is league standing and
 * points, which live in modules/races.
 */
export async function accountRoutes(app: FastifyInstance) {
  // Full wallet transaction history — shared across both models. `model` is
  // computed here, not stored (see the comment on LedgerEntry in
  // schema.prisma): raceId set means "race", challengeId set means
  // "streakpot", neither means a wallet-level movement (deposit/withdrawal/
  // adjustment) that belongs to no competition model.
  app.get("/me/ledger", { preHandler: requireAuth }, async (req, reply) => {
    const entries = await prisma.ledgerEntry.findMany({
      where: { userId: req.userId },
      include: {
        race: { select: { id: true, name: true, metricKey: true, format: true, durationDays: true } },
        challenge: { select: { id: true, title: true, mode: true, durationDays: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return reply.send({
      entries: entries.map((e) => ({ ...e, model: e.raceId ? ("race" as const) : e.challengeId ? ("streakpot" as const) : null })),
    });
  });

  /**
   * Profile stat row.
   *
   * No `rank` field. The pooled version computed a global position by total
   * earned and the profile rendered it as "#412"; it was removed on purpose,
   * because a number that sits flat or slides backwards through a bad run is
   * the one progress signal a user cannot improve by trying harder in the
   * short term. League standing (GET /me/league) carries progress instead.
   */
  app.get("/me/stats", { preHandler: requireAuth }, async (req, reply) => {
    const [entries, prizeEntries, samples] = await Promise.all([
      prisma.raceEntry.findMany({
        where: { userId: req.userId },
        select: { status: true, finishPosition: true, race: { select: { metricKey: true, status: true } } },
      }),
      prisma.ledgerEntry.aggregate({
        where: { userId: req.userId, type: "RACE_PRIZE", status: "COMPLETED" },
        _sum: { amountCents: true },
      }),
      prisma.raceHealthSample.groupBy({
        by: ["metricKey"],
        where: { raceEntry: { userId: req.userId } },
        _sum: { value: true },
        _count: { _all: true },
      }),
    ]);

    const racesEntered = entries.length;
    const racesFinished = entries.filter((e) => e.status === "SCORED").length;
    const wins = entries.filter((e) => e.finishPosition === 1).length;
    const podiums = entries.filter((e) => e.finishPosition != null && e.finishPosition <= 3).length;

    // "Primary metric" — whichever metric this user has logged the most
    // samples against. Not a user setting; the simplest honest read of
    // "the thing you actually do".
    const top = [...samples].sort((a, b) => b._count._all - a._count._all)[0];
    const primaryMetricDef = top
      ? await prisma.metricTypeDefinition.findUnique({ where: { key: top.metricKey } })
      : null;

    return reply.send({
      racesEntered,
      racesFinished,
      wins,
      podiums,
      totalWonCents: prizeEntries._sum.amountCents ?? 0,
      primaryMetric: primaryMetricDef
        ? {
            key: primaryMetricDef.key,
            displayName: primaryMetricDef.displayName,
            unit: primaryMetricDef.unit,
            valueType: primaryMetricDef.valueType,
            total: top?._sum.value ?? 0,
          }
        : null,
    });
  });
}
