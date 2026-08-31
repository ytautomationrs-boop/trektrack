// Mirrors DataSourceCategory in backend/prisma/schema.prisma. SLEEP is
// StreakPot-only — never accepted as a race metric (see races/config.ts
// isRaceEligibleMetric on the backend).
export type DataSourceCategory = "STEPS" | "CYCLING_WORKOUT" | "RUNNING_WORKOUT" | "SWIMMING_WORKOUT" | "SLEEP" | "GENERIC_WORKOUT";

export type LocalDayWindow = {
  /** "YYYY-MM-DD" in the device's current local timezone */
  localDate: string;
  startUtc: Date;
  endUtc: Date;
};

// Mirrors backend/src/modules/health/schemas.ts HealthSampleInputSchema —
// keep these in sync by hand (see mobile/src/api/types.ts header comment).
export type RawSample = {
  metricKey: string;
  value: number;
  unit: string;
  startTime: string;
  endTime: string;
  deviceId?: string;
  sourceBundleId: string;
  sourceName: string;
  wasManualEntry: boolean;
  isWearableSourced: boolean;
  corroboration?: Record<string, unknown>;
};

export type PermissionResult = {
  granted: DataSourceCategory[];
  denied: DataSourceCategory[];
};

export interface HealthAdapter {
  readonly providerName: "HEALTHKIT" | "HEALTH_CONNECT";

  isAvailable(): Promise<boolean>;

  requestPermissions(categories: DataSourceCategory[]): Promise<PermissionResult>;

  /** For cumulative metrics: steps. */
  readDailyAggregate(category: DataSourceCategory, metricKey: string, window: LocalDayWindow): Promise<RawSample[]>;

  /** For session-based metrics: cycling, running, swimming — requires a full workout/exercise session, not a bare number (spec 3c). */
  readWorkoutSessions(category: DataSourceCategory, metricKey: string, window: LocalDayWindow): Promise<RawSample[]>;
}
