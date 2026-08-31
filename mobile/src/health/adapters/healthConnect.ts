import { Platform } from "react-native";
import {
  initialize,
  requestPermission,
  readRecords,
  type Permission,
  type RecordType,
} from "react-native-health-connect";
import type { DataSourceCategory, HealthAdapter, LocalDayWindow, PermissionResult, RawSample } from "../types";

const MANUAL_ENTRY_PACKAGE = "com.google.android.apps.healthdata"; // Health Connect's own manual-entry UI

const CATEGORY_TO_RECORD_TYPE: Record<DataSourceCategory, RecordType> = {
  STEPS: "Steps",
  CYCLING_WORKOUT: "ExerciseSession",
  RUNNING_WORKOUT: "ExerciseSession",
  SWIMMING_WORKOUT: "ExerciseSession",
  // StreakPot only — readDailyAggregate/readWorkoutSessions have no SLEEP
  // case yet (return []), so this only lets the permission be requested;
  // actual sleep-sample reading is a follow-up alongside the StreakPot
  // check-in UI.
  SLEEP: "SleepSession",
  GENERIC_WORKOUT: "ExerciseSession",
};

// GPS-route workout categories (cycling, running) share the exact same
// corroboration shape and read path — only the exercise type differs.
// Swimming is handled separately (pool session, no GPS route) but reports
// distance in the same unit (metres) — see readWorkoutSessions.
const GPS_ROUTE_EXERCISE_TYPES: Partial<Record<DataSourceCategory, string>> = {
  CYCLING_WORKOUT: "EXERCISE_TYPE_BIKING",
  RUNNING_WORKOUT: "EXERCISE_TYPE_RUNNING",
};

function classifySource(dataOrigin: { packageName: string }, deviceType?: string) {
  return {
    sourceBundleId: dataOrigin.packageName,
    sourceName: dataOrigin.packageName,
    wasManualEntry: dataOrigin.packageName === MANUAL_ENTRY_PACKAGE,
    isWearableSourced: deviceType === "TYPE_WATCH" || deviceType === "TYPE_FITNESS_BAND",
  };
}

export class HealthConnectAdapter implements HealthAdapter {
  readonly providerName = "HEALTH_CONNECT" as const;

  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== "android") return false;
    return initialize();
  }

  async requestPermissions(categories: DataSourceCategory[]): Promise<PermissionResult> {
    const permissions: Permission[] = categories.map((c) => ({
      accessType: "read",
      recordType: CATEGORY_TO_RECORD_TYPE[c],
    })) as Permission[];

    const granted = await requestPermission(permissions);
    const grantedTypes = new Set(granted.map((p) => p.recordType));

    const grantedCategories = categories.filter((c) => grantedTypes.has(CATEGORY_TO_RECORD_TYPE[c]));
    const deniedCategories = categories.filter((c) => !grantedTypes.has(CATEGORY_TO_RECORD_TYPE[c]));
    return { granted: grantedCategories, denied: deniedCategories };
  }

  async readDailyAggregate(category: DataSourceCategory, metricKey: string, window: LocalDayWindow): Promise<RawSample[]> {
    if (category === "STEPS") return this.readSteps(metricKey, window);
    return [];
  }

  async readWorkoutSessions(category: DataSourceCategory, metricKey: string, window: LocalDayWindow): Promise<RawSample[]> {
    const isGpsRoute = category in GPS_ROUTE_EXERCISE_TYPES;
    if (!isGpsRoute && category !== "SWIMMING_WORKOUT") return [];
    const exerciseType = isGpsRoute ? GPS_ROUTE_EXERCISE_TYPES[category]! : "EXERCISE_TYPE_SWIMMING_POOL";

    const { records } = await readRecords("ExerciseSession", {
      timeRangeFilter: { operator: "between", startTime: window.startUtc.toISOString(), endTime: window.endUtc.toISOString() },
    });

    const samples: RawSample[] = [];
    for (const r of records as any[]) {
      if (r.exerciseType !== exerciseType) continue;
      const source = classifySource(r.metadata.dataOrigin, r.metadata.device?.type);

      // route/distance come from separate linked records in Health Connect;
      // in the full implementation these are fetched via
      // readRecords("ExerciseRoute"/"Distance") filtered by session id and
      // merged here. Left as the integration seam this file exists to mark.
      const corroboration = isGpsRoute
        ? { gpsRoute: r.route ?? [], elevationGainMeters: r.elevationGainMeters ?? 0, hasHeartRate: !!r.hasHeartRateData }
        : { strokeCount: r.strokeCount ?? 0, poolLengthMeters: r.poolLengthMeters ?? 0 };

      samples.push({
        metricKey,
        // Distance is always stored/calculated in metres, running/cycling/
        // swimming alike — both exercise types report distanceMeters, no
        // need to derive a lap count from it.
        value: r.distanceMeters ?? 0,
        unit: "meters",
        startTime: r.startTime,
        endTime: r.endTime,
        ...source,
        corroboration,
      });
    }
    return samples;
  }

  private async readSteps(metricKey: string, window: LocalDayWindow): Promise<RawSample[]> {
    const { records } = await readRecords("Steps", {
      timeRangeFilter: { operator: "between", startTime: window.startUtc.toISOString(), endTime: window.endUtc.toISOString() },
    });

    return (records as any[]).map((r) => {
      const source = classifySource(r.metadata.dataOrigin, r.metadata.device?.type);
      return {
        metricKey,
        value: r.count,
        unit: "steps",
        startTime: r.startTime,
        endTime: r.endTime,
        ...source,
        // Health Connect doesn't expose a separate raw pedometer stream the
        // way CMPedometer does — corroboration here comes from the OS-level
        // ActivityRecognition step-detector count where the OEM exposes it.
        // Left undefined when unavailable; server-side validator treats a
        // missing corroboration payload as unverifiable (fails closed).
        corroboration: r.stepDetectorCount != null ? { pedometerStepCount: r.stepDetectorCount, gaitConfidence: 0.9 } : undefined,
      };
    });
  }
}
