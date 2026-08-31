// Server-side statistical anomaly detection. These rules never reject a
// sample outright — validators/ handles hard rejection at ingestion time.
// Anomaly rules instead attach RaceAnomalyFlag rows, which hold a
// prize-winning entrant's payout for human review rather than releasing it
// automatically (see modules/races/resolution.ts).
//
// Rules that keyed off a daily TARGET (threshold hugging, pace-target
// hugging) were removed with the pooled model: a race ranks on a cumulative
// total, so there is no threshold to hug.

export type AnomalyContext = {
  metricKey: string;
  value: number;
  /** This user's own prior values for the metric — the personal baseline. */
  historicalValues: number[];
  durationSeconds?: number;
  distanceMeters?: number;
};

export type AnomalyResult = {
  score: number; // 0-1
  flags: Array<{ ruleKey: string; severity: "LOW" | "MEDIUM" | "HIGH"; details: Record<string, unknown> }>;
};

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// *.baseline_spike — flag a sudden spike inconsistent with the participant's
// own historical average (spec 3d, first bullet). Applies to steps and any
// other cumulative daily metric.
function baselineSpike(ctx: AnomalyContext): AnomalyResult["flags"] {
  if (ctx.historicalValues.length < 3) return []; // not enough baseline yet
  const avg = mean(ctx.historicalValues);
  const sd = stdDev(ctx.historicalValues, avg);
  if (sd === 0) return [];
  const zScore = (ctx.value - avg) / sd;
  if (zScore > 3) {
    return [
      {
        ruleKey: "steps.baseline_spike",
        severity: zScore > 5 ? "HIGH" : "MEDIUM",
        details: { baselineAvg: avg, observedValue: ctx.value, zScore },
      },
    ];
  }
  return [];
}

// workout.pace_plausibility — physically impossible cadence/speed given
// GPS distance/time (spec 3d, third bullet). Validators already hard-reject
// the most extreme cases pre-ingestion; this catches the "plausible on its
// own but weird for THIS person" band.
function pacePlausibility(ctx: AnomalyContext): AnomalyResult["flags"] {
  if (!ctx.durationSeconds || !ctx.distanceMeters) return [];
  const speedKmh = ctx.distanceMeters / 1000 / (ctx.durationSeconds / 3600);
  if (ctx.metricKey === "cycling" && speedKmh > 45) {
    return [{ ruleKey: "workout.pace_plausibility", severity: "MEDIUM", details: { speedKmh } }];
  }
  // Recreational-to-elite running tops out around 21 km/h sustained (world
  // marathon record pace); above that for a full day's distance is worth a
  // human look even though the hard GPS validator (26 km/h) let it through.
  if (ctx.metricKey === "running" && speedKmh > 21) {
    return [{ ruleKey: "workout.pace_plausibility", severity: "MEDIUM", details: { speedKmh } }];
  }
  return [];
}

// pacePlausibility stays: races removed the user-facing pace TARGET, not
// the pace SIGNAL. A physically impossible speed is still the strongest
// single indicator of a spoofed distance, so GPS and duration are still
// captured and still checked.
const globalRules = [baselineSpike, pacePlausibility];

export function runAnomalyDetection(ctx: AnomalyContext): AnomalyResult {
  const flags = globalRules.flatMap((rule) => rule(ctx));
  const score = flags.length === 0 ? 0 : Math.min(1, Math.max(...flags.map((f) => (f.severity === "HIGH" ? 0.9 : f.severity === "MEDIUM" ? 0.6 : 0.3))));
  return { score, flags };
}
