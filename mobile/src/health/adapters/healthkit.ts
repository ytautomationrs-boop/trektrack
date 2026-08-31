import { Platform } from "react-native";
import AppleHealthKit, { HealthValue, HealthKitPermissions, HealthPermission } from "react-native-health";
import type { DataSourceCategory, HealthAdapter, LocalDayWindow, PermissionResult, RawSample } from "../types";

const PERMS = AppleHealthKit.Constants.Permissions;

const CATEGORY_TO_HK_PERMISSION: Record<DataSourceCategory, HealthPermission> = {
  STEPS: PERMS.StepCount,
  CYCLING_WORKOUT: PERMS.Workout,
  RUNNING_WORKOUT: PERMS.Workout,
  SWIMMING_WORKOUT: PERMS.Workout,
  // StreakPot only — readDailyAggregate has no SLEEP case yet (returns []),
  // so this only lets the permission be requested; actual sleep-sample
  // reading is a follow-up alongside the StreakPot check-in UI.
  SLEEP: PERMS.SleepAnalysis,
  GENERIC_WORKOUT: PERMS.Workout,
};

// GPS-route workout categories (cycling, running) share the exact same
// corroboration shape and HealthKit read path — only the activity name
// differs. Swimming is handled separately (pool session, no GPS route) but
// reports distance in the same unit (metres) — see readWorkoutSessions.
const GPS_ROUTE_CATEGORIES: Partial<Record<DataSourceCategory, string>> = {
  CYCLING_WORKOUT: "Cycling",
  RUNNING_WORKOUT: "Running",
};

const MANUAL_ENTRY_SOURCE_BUNDLE = "com.apple.Health";

function classifySource(sourceRevision: { source: { bundleIdentifier: string; name: string } }, hasDevice: boolean) {
  const wasManualEntry = sourceRevision.source.bundleIdentifier === MANUAL_ENTRY_SOURCE_BUNDLE && !hasDevice;
  return {
    sourceBundleId: sourceRevision.source.bundleIdentifier,
    sourceName: sourceRevision.source.name,
    wasManualEntry,
    isWearableSourced: hasDevice,
  };
}

export class HealthKitAdapter implements HealthAdapter {
  readonly providerName = "HEALTHKIT" as const;

  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== "ios") return false;
    return new Promise((resolve) => AppleHealthKit.isAvailable((_err, available) => resolve(!!available)));
  }

  async requestPermissions(categories: DataSourceCategory[]): Promise<PermissionResult> {
    const permissions: HealthKitPermissions = {
      permissions: {
        read: categories.map((c) => CATEGORY_TO_HK_PERMISSION[c]),
        write: [], // read-only — spec: never write to Health
      },
    };

    return new Promise((resolve) => {
      AppleHealthKit.initHealthKit(permissions, (err) => {
        if (err) {
          resolve({ granted: [], denied: categories });
        } else {
          // HealthKit's JS bridge doesn't expose granular per-type grant
          // status after the system prompt closes (Apple's own privacy
          // design) — we optimistically mark all requested as granted and
          // let the first failed read downgrade a specific category.
          resolve({ granted: categories, denied: [] });
        }
      });
    });
  }

  async readDailyAggregate(category: DataSourceCategory, metricKey: string, window: LocalDayWindow): Promise<RawSample[]> {
    if (category === "STEPS") return this.readSteps(metricKey, window);
    return [];
  }

  async readWorkoutSessions(category: DataSourceCategory, metricKey: string, window: LocalDayWindow): Promise<RawSample[]> {
    const isGpsRoute = category in GPS_ROUTE_CATEGORIES;
    if (!isGpsRoute && category !== "SWIMMING_WORKOUT") return [];
    const activityType = isGpsRoute ? GPS_ROUTE_CATEGORIES[category]! : "Swimming";

    const workouts = await new Promise<HealthValue[]>((resolve, reject) => {
      AppleHealthKit.getSamples(
        {
          startDate: window.startUtc.toISOString(),
          endDate: window.endUtc.toISOString(),
          type: "Workout" as any,
        },
        (err, results) => (err ? reject(err) : resolve(results as unknown as HealthValue[]))
      );
    }).catch(() => [] as HealthValue[]);

    const samples: RawSample[] = [];
    for (const w of workouts as any[]) {
      if (w.activityName !== activityType) continue;

      const source = classifySource(w.sourceRevision ?? { source: { bundleIdentifier: "unknown", name: "unknown" } }, !!w.device);

      // A GPS-route (cycling/running) or swimming entry MUST carry a route
      // or session detail — spec 3c. If the workout has no route/lap
      // metadata we still submit it (so it shows up rejected on the server,
      // useful for the review queue) rather than silently dropping it
      // client-side.
      const corroboration = isGpsRoute
        ? { gpsRoute: w.route ?? [], elevationGainMeters: w.elevationGain ?? 0, hasHeartRate: !!w.averageHeartRate }
        : { strokeCount: w.swimmingStrokeCount ?? 0, poolLengthMeters: w.poolLength ?? 0 };

      samples.push({
        metricKey,
        // Distance is always stored/calculated in metres, running/cycling/
        // swimming alike — HealthKit already reports real swim distance
        // (w.distance) directly, no need to derive a lap count from it.
        value: isGpsRoute ? (w.totalDistance ?? 0) : (w.distance ?? 0),
        unit: "meters",
        startTime: w.start,
        endTime: w.end,
        ...source,
        corroboration,
      });
    }
    return samples;
  }

  private async readSteps(metricKey: string, window: LocalDayWindow): Promise<RawSample[]> {
    const [aggregate, pedometer] = await Promise.all([
      new Promise<HealthValue[]>((resolve) => {
        AppleHealthKit.getDailyStepCountSamples(
          { startDate: window.startUtc.toISOString(), endDate: window.endUtc.toISOString() },
          (err, results) => resolve(err ? [] : results)
        );
      }),
      new Promise<{ numberOfSteps: number; distance: number } | null>((resolve) => {
        // CMPedometer corroboration (spec 3c) — a separate on-device motion
        // coprocessor read, independent of whatever wrote the HealthKit sample.
        AppleHealthKit.getStepCount(
          { startDate: window.startUtc.toISOString(), endDate: window.endUtc.toISOString() },
          (err, result) => resolve(err ? null : (result as any))
        );
      }),
    ]);

    return aggregate.map((s: any) => {
      const source = classifySource(s.sourceRevision ?? { source: { bundleIdentifier: "unknown", name: "unknown" } }, !!s.device);
      return {
        metricKey,
        value: s.value,
        unit: "steps",
        startTime: s.startDate,
        endTime: s.endDate,
        ...source,
        corroboration: pedometer
          ? { pedometerStepCount: pedometer.numberOfSteps, gaitConfidence: gaitConfidenceFrom(s.value, pedometer.numberOfSteps) }
          : undefined,
      };
    });
  }
}

/**
 * How closely the HealthKit aggregate agrees with the raw CMPedometer count.
 * 1 = identical, falling toward 0 as they diverge. A large divergence means
 * the HealthKit total was probably written by something other than the
 * phone's own sensor pipeline — see the server-side steps validator.
 */
function gaitConfidenceFrom(healthKitTotal: number, pedometerTotal: number): number {
  if (healthKitTotal === 0 && pedometerTotal === 0) return 1;
  const divergence = Math.abs(healthKitTotal - pedometerTotal) / Math.max(healthKitTotal, 1);
  return Math.max(0, 1 - divergence);
}
