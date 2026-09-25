import { beforeEach, describe, expect, it, vi } from "vitest";
import { RACE_ELIGIBLE_METRIC_KEYS } from "./config.js";

const db = vi.hoisted(() => ({
  userLeagueState: { findMany: vi.fn(), upsert: vi.fn() },
  metricTypeDefinition: { findMany: vi.fn() },
  leagueLevel: { findMany: vi.fn() },
}));
vi.mock("../../lib/prisma.js", () => ({ prisma: db }));
import { getAllLeagueStates, getLeagueStandings } from "./leagues.js";

const states = RACE_ELIGIBLE_METRIC_KEYS.map((metricKey) => ({
  userId: "viewer", metricKey, totalPoints: metricKey === "running" ? 31 : 0,
  currentLevel: metricKey === "running" ? 2 : 1, qualifiedLevel: metricKey === "running" ? 3 : 1,
  racesEntered: metricKey === "running" ? 8 : 0, racesWon: metricKey === "running" ? 3 : 0,
}));

beforeEach(() => {
  vi.resetAllMocks();
  // Deliberately different order from the UI's four metric tracks.
  db.userLeagueState.findMany.mockResolvedValue([...states].reverse());
  db.metricTypeDefinition.findMany.mockResolvedValue(RACE_ELIGIBLE_METRIC_KEYS.map((key) => ({ key, displayName: key.toUpperCase() })));
  db.leagueLevel.findMany.mockResolvedValue([1, 2, 3].flatMap((level) => RACE_ELIGIBLE_METRIC_KEYS.map((metricKey) => ({
    metricKey, level, name: `League ${level}`, minPoints: (level - 1) * 15, isOpen: level <= 2,
  }))));
});

describe("league reads", () => {
  it("uses one read and no writes for an existing user's four standings", async () => {
    expect(await getAllLeagueStates("viewer")).toEqual(states);
    expect(db.userLeagueState.findMany).toHaveBeenCalledTimes(1);
    expect(db.userLeagueState.upsert).not.toHaveBeenCalled();
  });

  it("uses the atomic upsert only for missing tracks", async () => {
    db.userLeagueState.findMany.mockResolvedValue(states.slice(1));
    db.userLeagueState.upsert.mockResolvedValue(states[0]);
    expect(await getAllLeagueStates("viewer")).toEqual(states);
    expect(db.userLeagueState.upsert).toHaveBeenCalledTimes(1);
    expect(db.userLeagueState.upsert.mock.calls[0]![0]).toMatchObject({
      where: { userId_metricKey: { userId: "viewer", metricKey: "steps" } },
      update: { userId: "viewer" },
    });
  });

  it("builds the profile in three reads while preserving independent points and closed-level qualification", async () => {
    const result = await getLeagueStandings("viewer");
    expect(result.primaryMetricKey).toBe("running");
    expect(result.standings[1]).toMatchObject({
      metricKey: "running", totalPoints: 31, currentLeague: { level: 2 },
      nextLeague: { level: 3, isOpen: false }, qualifiedForUnopenedLevel: 3, pointsToNextLeague: 0, bandProgress: 1,
    });
    expect(result.standings[0]).toMatchObject({
      metricKey: "steps", totalPoints: 0, currentLeague: { level: 1 }, pointsToNextLeague: 15, bandProgress: 0,
    });
    expect(db.userLeagueState.findMany).toHaveBeenCalledTimes(1);
    expect(db.metricTypeDefinition.findMany).toHaveBeenCalledTimes(1);
    expect(db.leagueLevel.findMany).toHaveBeenCalledTimes(1);
    expect(db.userLeagueState.upsert).not.toHaveBeenCalled();
  });
});
