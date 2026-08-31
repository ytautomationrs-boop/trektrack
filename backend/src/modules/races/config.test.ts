import { describe, expect, it } from "vitest";
import {
  LEAGUE_POINT_BAND,
  POINTS_FIRST_PLACE,
  POINTS_LAST_PLACE,
  isRaceEligibleMetric,
  pointsForPosition,
} from "./config.js";

/**
 * The points scale is worth pinning down precisely because a mistake in it
 * is invisible at runtime: nothing throws, users just quietly end up in the
 * wrong league forever (points are permanent and there is no demotion to
 * correct an over-promotion). These are the two scales the spec states
 * literally, plus the invariants the generalised formula has to preserve for
 * any future field size.
 */

describe("pointsForPosition", () => {
  it("reproduces the 10-entrant individual scale exactly", () => {
    const scale = Array.from({ length: 10 }, (_, i) => pointsForPosition(i + 1, 10));
    expect(scale).toEqual([5, 4, 3, 2, 1, 0, -1, -2, -3, -4]);
  });

  it("reproduces the 4-squad scale exactly", () => {
    const scale = Array.from({ length: 4 }, (_, i) => pointsForPosition(i + 1, 4));
    expect(scale).toEqual([5, 2, -1, -4]);
  });

  it("always awards +5 for a win and -4 for last, whatever the field size", () => {
    for (const size of [4, 6, 8, 10, 12, 20]) {
      expect(pointsForPosition(1, size)).toBe(POINTS_FIRST_PLACE);
      expect(pointsForPosition(size, size)).toBe(POINTS_LAST_PLACE);
    }
  });

  it("never rewards a worse position with more points", () => {
    for (const size of [4, 6, 8, 10, 12, 20]) {
      for (let position = 2; position <= size; position++) {
        expect(pointsForPosition(position, size)).toBeLessThanOrEqual(pointsForPosition(position - 1, size));
      }
    }
  });

  it("rejects a position outside the field", () => {
    expect(() => pointsForPosition(0, 10)).toThrow();
    expect(() => pointsForPosition(11, 10)).toThrow();
  });
});

describe("promotion cadence", () => {
  /**
   * The stated design intent was "roughly two first-place finishes plus a
   * few top-4 results". These pin that cadence from both sides, so re-banding
   * the leagues has to be a deliberate choice about how often people promote
   * rather than an accidental one.
   */
  it("promotes on two wins plus two top-4 finishes", () => {
    const earned = pointsForPosition(1, 10) * 2 + pointsForPosition(3, 10) + pointsForPosition(4, 10);
    expect(earned).toBeGreaterThanOrEqual(LEAGUE_POINT_BAND); // 5 + 5 + 3 + 2 = 15
  });

  it("does not promote on two wins alone", () => {
    expect(pointsForPosition(1, 10) * 2).toBeLessThan(LEAGUE_POINT_BAND);
  });

  it("takes a full band to recover from a bottom finish", () => {
    // A last place is -4, so the floor-at-zero rule matters most for new
    // users: this is the size of the hole a bad race digs.
    expect(Math.abs(pointsForPosition(10, 10))).toBeLessThan(LEAGUE_POINT_BAND);
  });
});

describe("race-eligible metrics", () => {
  it("excludes sleep from the race and league model", () => {
    expect(isRaceEligibleMetric("sleep")).toBe(false);
  });

  it("includes the four movement metrics", () => {
    for (const key of ["steps", "running", "cycling", "swimming"]) {
      expect(isRaceEligibleMetric(key)).toBe(true);
    }
  });
});
