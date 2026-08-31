import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";

// Drives the race/league side's create-wizard metric grid — mobile fetches
// this once and caches it. Explicitly selected (rather than a bare
// findMany) so StreakPot-only config added to MetricTypeDefinition
// (minTarget, supportsPaceTarget, vizType, ...) never leaks into the
// race-facing response; StreakPot's own challenge-creation flow reads the
// fuller shape via /streakpot/metric-types instead.
const RACE_METRIC_FIELDS = {
  key: true,
  displayName: true,
  unit: true,
  valueType: true,
  dataSourceCategory: true,
  icon: true,
  validationRuleKey: true,
  anomalyRuleKey: true,
  isActive: true,
  createdAt: true,
} as const;

export async function metricTypeRoutes(app: FastifyInstance) {
  app.get("/metric-types", async (_req, reply) => {
    // Sleep is StreakPot-only — never offered as a race metric.
    const types = await prisma.metricTypeDefinition.findMany({
      where: { isActive: true, key: { not: "sleep" } },
      select: RACE_METRIC_FIELDS,
    });
    return reply.send({ metricTypes: types });
  });
}
