import type { DataSourceCategory, HealthAdapter, LocalDayWindow, PermissionResult, RawSample } from "../types";

/**
 * Web has no HealthKit / Health Connect equivalent — a browser tab cannot
 * read device health data. For the web pilot, Strava OAuth is the primary
 * verification method instead (see integrations/strava.ts and
 * OnboardingFlow.tsx's web branch), which works via a normal redirect
 * regardless of platform.
 *
 * This adapter exists only so getHealthAdapter() always returns something —
 * every method reports "nothing available" rather than throwing, so any
 * code that still calls into it on web degrades gracefully instead of
 * crashing the page.
 */
export class WebUnavailableAdapter implements HealthAdapter {
  readonly providerName = "HEALTHKIT" as const; // never surfaced — isAvailable() is always false

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async requestPermissions(categories: DataSourceCategory[]): Promise<PermissionResult> {
    return { granted: [], denied: categories };
  }

  async readDailyAggregate(_category: DataSourceCategory, _metricKey: string, _window: LocalDayWindow): Promise<RawSample[]> {
    return [];
  }

  async readWorkoutSessions(_category: DataSourceCategory, _metricKey: string, _window: LocalDayWindow): Promise<RawSample[]> {
    return [];
  }
}
