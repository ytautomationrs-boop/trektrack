import { prisma } from "../../../lib/prisma.js";
import { STRAVA_SUPPORTED_METRICS } from "../../../lib/constants.js";
import { decodePolyline, listActivitiesSince, refreshAccessToken, type StravaActivity } from "./stravaClient.js";
import type { HealthSampleInput } from "../../health/schemas.js";
import type { StravaConnection } from "@prisma/client";

// "Ride"/"Run" only — Strava's Virtual* activity types (VirtualRide,
// VirtualRun) aren't tied to a real-world GPS track, so they're excluded
// on anti-fraud grounds the same way a bare distance number would be.
const ACTIVITY_TYPE_TO_METRIC: Record<string, (typeof STRAVA_SUPPORTED_METRICS)[number]> = {
  Ride: "cycling",
  Run: "running",
  TrailRun: "running",
};

async function ensureFreshToken(connection: StravaConnection): Promise<string> {
  const bufferMs = 5 * 60_000;
  if (connection.expiresAt.getTime() - bufferMs > Date.now()) {
    return connection.accessToken;
  }
  const refreshed = await refreshAccessToken(connection.refreshToken);
  await prisma.stravaConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: new Date(refreshed.expires_at * 1000),
    },
  });
  return refreshed.access_token;
}

/**
 * The provider half of the Strava integration, with no opinion about which
 * model is asking: fetches this user's matching activities since `sinceUtc`
 * and returns them in the shared HealthSampleInput shape, ready for whatever
 * validation/storage path the caller uses.
 *
 * Split out of syncStravaActivitiesForToday above (whose behaviour is
 * unchanged) so the fixed-prize race model can reuse the real integration
 * — token refresh, activity-type filtering, polyline decoding — instead of
 * reimplementing it against RaceHealthSample. The caller owns idempotency,
 * since "already fetched?" means a different query in each model.
 */
export async function fetchStravaSamples(params: {
  userId: string;
  metricKey: string;
  sinceUtc: Date;
}): Promise<HealthSampleInput[]> {
  if (!STRAVA_SUPPORTED_METRICS.includes(params.metricKey as any)) return [];

  const connection = await prisma.stravaConnection.findUnique({ where: { userId: params.userId } });
  if (!connection || connection.status !== "ACTIVE") return [];

  const accessToken = await ensureFreshToken(connection);
  const activities = await listActivitiesSince(accessToken, Math.floor(params.sinceUtc.getTime() / 1000));

  return activities
    .filter((a) => ACTIVITY_TYPE_TO_METRIC[a.type] === params.metricKey)
    .map((activity) => toHealthSampleInput(activity, params.metricKey));
}

function toHealthSampleInput(activity: StravaActivity, metricKey: string): HealthSampleInput {
  const startTime = new Date(activity.start_date);
  const endTime = new Date(startTime.getTime() + activity.moving_time * 1000);
  const decodedPoints = activity.map?.summary_polyline ? decodePolyline(activity.map.summary_polyline) : [];
  // Strava's summary polyline has no per-point timestamps; spread them
  // evenly across the activity's moving time so the existing teleport-jump
  // validator (which needs a `t` per point) still works unmodified.
  const gpsRoute = decodedPoints.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    t: new Date(startTime.getTime() + (i / Math.max(1, decodedPoints.length - 1)) * activity.moving_time * 1000).toISOString(),
  }));

  return {
    metricKey,
    value: activity.distance,
    unit: "meters",
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    sourceBundleId: `strava:${activity.id}`,
    sourceName: "Strava",
    wasManualEntry: false,
    isWearableSourced: true, // Strava activities are recorded by a device/app, not typed in
    corroboration: {
      gpsRoute,
      elevationGainMeters: activity.total_elevation_gain,
      hasHeartRate: !!activity.average_heartrate,
    },
  };
}
