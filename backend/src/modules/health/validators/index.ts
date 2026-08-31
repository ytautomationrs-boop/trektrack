import type { HealthSampleInput } from "../schemas.js";

export type ValidationResult =
  | { accepted: true }
  | { accepted: false; reasonCode: string; reason: string };

export type Validator = (sample: HealthSampleInput) => ValidationResult;

// Rule 3b — reject manual entry outright, unconditionally, for every metric
// type. This runs before any per-metric rule below.
function rejectManualEntry(sample: HealthSampleInput): ValidationResult | null {
  if (sample.wasManualEntry) {
    return {
      accepted: false,
      reasonCode: "manual_entry_rejected",
      reason: "Manually entered health data is not accepted for races.",
    };
  }
  return null;
}

// steps.pedometer_corroboration — 3c: cross-check the aggregate step count
// against CMPedometer (iOS) / on-device step-detector corroboration data
// the mobile adapter attaches. A bare HealthKit step total with no
// corroborating gait signal is treated as unverifiable.
const validateSteps: Validator = (sample) => {
  const manual = rejectManualEntry(sample);
  if (manual) return manual;

  const c = sample.corroboration as { pedometerStepCount?: number; gaitConfidence?: number } | undefined;
  if (!c || typeof c.pedometerStepCount !== "number" || typeof c.gaitConfidence !== "number") {
    return { accepted: false, reasonCode: "missing_pedometer_corroboration", reason: "No motion-coprocessor corroboration attached." };
  }
  // Aggregate HealthKit total and raw pedometer count should roughly agree;
  // a large divergence suggests the HealthKit value was written by
  // something other than the phone's own sensor pipeline (e.g. a spoofing
  // tool writing directly to HealthKit).
  const divergence = Math.abs(sample.value - c.pedometerStepCount) / Math.max(sample.value, 1);
  if (divergence > 0.15) {
    return { accepted: false, reasonCode: "pedometer_divergence", reason: `Step count diverges ${Math.round(divergence * 100)}% from pedometer corroboration.` };
  }
  if (c.gaitConfidence < 0.5) {
    return { accepted: false, reasonCode: "low_gait_confidence", reason: "Motion signature doesn't resemble a plausible gait pattern." };
  }
  return { accepted: true };
};

// workout.gps_route_required(_running) — 3c: cycling/running require a full
// workout session with GPS route + duration + distance + elevation, not a
// bare distance number. Reject missing GPS, impossible pacing, or
// teleporting routes. One parameterized validator shared by both metrics
// (and by Strava-sourced samples — see modules/integrations/strava —
// which are shaped identically) rather than near-duplicate copies, since
// the only real difference between them is what pace is physically
// plausible for a human.
function makeGpsWorkoutValidator(activityLabel: string, maxPlausibleSpeedKmh: number): Validator {
  return (sample) => {
    const manual = rejectManualEntry(sample);
    if (manual) return manual;

    const c = sample.corroboration as
      | { gpsRoute?: Array<{ lat: number; lng: number; t: string }>; elevationGainMeters?: number; hasHeartRate?: boolean }
      | undefined;
    if (!c || !c.gpsRoute || c.gpsRoute.length < 2) {
      return { accepted: false, reasonCode: "missing_gps_route", reason: `${activityLabel} workout has no GPS route attached.` };
    }

    const durationSeconds = (new Date(sample.endTime).getTime() - new Date(sample.startTime).getTime()) / 1000;
    const distanceMeters = sample.value; // value is always stored in meters for GPS-workout metrics
    const speedKmh = distanceMeters / 1000 / (durationSeconds / 3600);
    if (speedKmh > maxPlausibleSpeedKmh) {
      return { accepted: false, reasonCode: "implausible_pace", reason: `Average speed ${speedKmh.toFixed(1)} km/h exceeds plausible ${activityLabel.toLowerCase()} pace.` };
    }

    if (hasTeleportJump(c.gpsRoute)) {
      return { accepted: false, reasonCode: "gps_teleport", reason: "GPS route contains an impossible jump between consecutive points." };
    }

    return { accepted: true };
  };
}

const validateCyclingWorkout = makeGpsWorkoutValidator("Cycling", 60);
// Elite marathon pace is ~20.9 km/h sustained; 26 leaves headroom for short
// bursts without accepting a spoofed/implausible full-day average.
const validateRunningWorkout = makeGpsWorkoutValidator("Running", 26);

// workout.session_required — swimming: require a full workout session
// (distance/duration data from HealthKit swim metadata or Health Connect),
// not a hand-typed number. Distance is metres, same as running/cycling —
// see prisma/seed.ts's swimming entry for why laps were dropped.
const validateSwimmingWorkout: Validator = (sample) => {
  const manual = rejectManualEntry(sample);
  if (manual) return manual;

  const c = sample.corroboration as { strokeCount?: number; poolLengthMeters?: number } | undefined;
  if (!c || typeof c.strokeCount !== "number" || typeof c.poolLengthMeters !== "number") {
    return { accepted: false, reasonCode: "missing_swim_session_data", reason: "No structured swim workout session data attached." };
  }
  const durationSeconds = (new Date(sample.endTime).getTime() - new Date(sample.startTime).getTime()) / 1000;
  const distanceMeters = sample.value; // value is always stored in meters for swimming, same as GPS-workout metrics
  const speedMps = distanceMeters / Math.max(durationSeconds, 1);
  // 50m freestyle world record pace is ~2.4 m/s; 2.5 leaves no headroom for
  // an ordinary swimmer while still hard-rejecting an obviously spoofed number.
  if (speedMps > 2.5) {
    return { accepted: false, reasonCode: "implausible_pace", reason: `Average swim speed ${speedMps.toFixed(2)} m/s exceeds plausible pace.` };
  }
  return { accepted: true };
};

function hasTeleportJump(route: Array<{ lat: number; lng: number; t: string }>): boolean {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const dtSeconds = (new Date(b.t).getTime() - new Date(a.t).getTime()) / 1000;
    if (dtSeconds <= 0) continue;
    const distMeters = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    const speedKmh = distMeters / dtSeconds * 3.6;
    if (speedKmh > 120) return true; // faster than any plausible cycling burst between two GPS pings
  }
  return false;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const validatorRegistry: Record<string, Validator> = {
  "steps.pedometer_corroboration": validateSteps,
  "workout.gps_route_required": validateCyclingWorkout,
  "workout.gps_route_required_running": validateRunningWorkout,
  "workout.session_required": validateSwimmingWorkout,
};

export function runValidation(ruleKey: string, sample: HealthSampleInput): ValidationResult {
  const validator = validatorRegistry[ruleKey];
  if (!validator) {
    return { accepted: false, reasonCode: "no_validator_registered", reason: `No validator registered for rule "${ruleKey}".` };
  }
  return validator(sample);
}
