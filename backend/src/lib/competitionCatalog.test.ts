import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  metricTypeDefinition: { findMany: vi.fn(), upsert: vi.fn() },
  leagueLevel: { findMany: vi.fn(), upsert: vi.fn() },
  raceType: { findMany: vi.fn(), upsert: vi.fn() },
  racePrizeSchedule: { findMany: vi.fn(), upsert: vi.fn() },
  racePrizeTier: { deleteMany: vi.fn(), createMany: vi.fn() },
  user: { upsert: vi.fn() },
}));
vi.mock("./prisma.js", () => ({ prisma: db }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
});

async function completeCatalog() {
  const catalog = await import("./competitionCatalog.js");
  const payload = catalog.getCompetitionRaceTypesPayload();
  const sources = { steps: "STEPS", running: "RUNNING_WORKOUT", cycling: "CYCLING_WORKOUT", swimming: "SWIMMING_WORKOUT" };
  const rules = {
    steps: "steps.pedometer_corroboration", running: "workout.gps_route_required_running",
    cycling: "workout.gps_route_required", swimming: "workout.session_required",
  };
  const metrics = Object.keys(sources).map((key) => ({
    ...payload.find((type) => type.metricKey === key)!.metricType,
    dataSourceCategory: sources[key as keyof typeof sources],
    validationRuleKey: rules[key as keyof typeof rules],
    anomalyRuleKey: key === "steps" ? "steps.baseline_spike" : "workout.pace_plausibility",
  }));
  const types = payload.map(({ createdAt, totalEntrants, metricType, schedules, ...seed }) => seed);
  const levels = metrics.flatMap((metric) => payload[0]!.schedules.map((schedule) => ({ metricKey: metric.key, level: schedule.leagueLevel })));
  const schedules = payload.flatMap((type) => type.schedules.map((schedule) => ({
    raceTypeKey: type.key, leagueLevel: schedule.leagueLevel, _count: { tiers: schedule.prizes.length },
  })));
  db.metricTypeDefinition.findMany.mockResolvedValue(metrics);
  db.raceType.findMany.mockResolvedValue(types);
  db.leagueLevel.findMany.mockResolvedValue(levels);
  db.racePrizeSchedule.findMany.mockResolvedValue(schedules);
  db.racePrizeSchedule.upsert.mockResolvedValue({ id: "repaired-schedule" });
  return { ...catalog, types, metrics, schedules };
}

describe("competition catalog read path", () => {
  it("serves a complete catalog with no writes and shares initialization across requests", async () => {
    const catalog = await completeCatalog();
    const first = catalog.ensureCompetitionCatalog();
    expect(catalog.ensureCompetitionCatalog()).toBe(first);
    await first;
    await catalog.ensureCompetitionCatalog();
    for (const table of Object.values(db)) {
      if ("upsert" in table) expect(table.upsert).not.toHaveBeenCalled();
      if ("findMany" in table) expect(table.findMany).toHaveBeenCalledTimes(1);
    }
    expect(db.racePrizeTier.deleteMany).not.toHaveBeenCalled();
  });

  it("repairs a missing schedule without replacing existing configured prizes", async () => {
    const catalog = await completeCatalog();
    const missing = catalog.schedules[0]!;
    db.racePrizeSchedule.findMany.mockResolvedValue([
      ...catalog.schedules.slice(1),
      { raceTypeKey: "custom_3d_individual", leagueLevel: 1, _count: { tiers: 10 } },
    ]);
    await catalog.ensureCompetitionCatalog();
    expect(db.racePrizeSchedule.upsert).toHaveBeenCalledTimes(1);
    expect(db.racePrizeSchedule.upsert.mock.calls[0]![0].where).toEqual({
      raceTypeKey_leagueLevel: { raceTypeKey: missing.raceTypeKey, leagueLevel: missing.leagueLevel },
    });
    expect(db.racePrizeTier.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.racePrizeTier.createMany).toHaveBeenCalledTimes(1);
    expect(db.raceType.upsert).not.toHaveBeenCalled();
  });

  it("updates stale definitions even when every expected row exists", async () => {
    const catalog = await completeCatalog();
    db.metricTypeDefinition.findMany.mockResolvedValue(catalog.metrics.map((metric) => metric.key === "steps" ? { ...metric, displayName: "Steps" } : metric));
    db.raceType.findMany.mockResolvedValue(catalog.types.map((type, index) => index === 0 ? { ...type, isActive: !type.isActive } : type));
    await catalog.ensureCompetitionCatalog();
    expect(db.metricTypeDefinition.upsert).toHaveBeenCalledTimes(1);
    expect(db.raceType.upsert).toHaveBeenCalledTimes(1);
    expect(db.racePrizeSchedule.upsert).not.toHaveBeenCalled();
    expect(db.racePrizeTier.deleteMany).not.toHaveBeenCalled();
  });

  it("allows retry after a failed catalog read instead of caching failure", async () => {
    const catalog = await completeCatalog();
    db.metricTypeDefinition.findMany.mockRejectedValueOnce(new Error("temporary connection loss"));
    await expect(catalog.ensureCompetitionCatalog()).rejects.toThrow("temporary connection loss");
    await expect(catalog.ensureCompetitionCatalog()).resolves.toBeUndefined();
    expect(db.metricTypeDefinition.findMany).toHaveBeenCalledTimes(2);
  });
});
