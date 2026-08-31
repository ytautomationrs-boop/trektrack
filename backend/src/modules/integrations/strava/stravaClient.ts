import { STRAVA_API_BASE, STRAVA_OAUTH_AUTHORIZE_URL, STRAVA_OAUTH_TOKEN_URL } from "../../../lib/constants.js";
import { env } from "../../../lib/env.js";

/** Base credentials only — a specific PLATFORM's redirect bridge (mobile vs web) is checked separately, since a deployment may only have one registered. */
export function stravaConfigured(): boolean {
  return !!(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);
}

export function stravaMobileRedirectConfigured(): boolean {
  return !!env.STRAVA_REDIRECT_URI;
}

export function stravaWebRedirectConfigured(): boolean {
  return !!(env.STRAVA_WEB_REDIRECT_URI && env.WEB_APP_URL);
}

function requireConfig() {
  if (!stravaConfigured()) {
    throw new Error("Strava is not configured — set STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET/STRAVA_REDIRECT_URI to enable it.");
  }
  return { clientId: env.STRAVA_CLIENT_ID!, clientSecret: env.STRAVA_CLIENT_SECRET! };
}

/**
 * URL the caller opens in a browser for the user to approve access.
 * Read-only scope only — this app never writes to Strava.
 *
 * `redirectUri` is which callback bridge Strava sends the user back
 * through — mobile-callback (native custom-scheme handoff) or
 * web-callback (a real page on WEB_APP_URL) — both registered under the
 * same "Authorization Callback Domain" in the Strava app dashboard, since
 * Strava restricts that setting to one domain, not one full URI.
 */
export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const { clientId } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read_all",
    state,
  });
  return `${STRAVA_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export type StravaTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  athlete?: { id: number };
};

export async function exchangeCodeForToken(code: string): Promise<StravaTokenResponse> {
  const { clientId, clientSecret } = requireConfig();
  const res = await fetch(STRAVA_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code" }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as StravaTokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<StravaTokenResponse> {
  const { clientId, clientSecret } = requireConfig();
  const res = await fetch(STRAVA_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as StravaTokenResponse;
}

export type StravaActivity = {
  id: number;
  type: string; // "Run", "Ride", "VirtualRide", "TrailRun", etc.
  distance: number; // meters
  moving_time: number; // seconds
  total_elevation_gain: number; // meters
  start_date: string; // ISO
  average_heartrate?: number;
  map?: { summary_polyline?: string };
};

/** Activities starting on/after `afterUnixSeconds` — used to fetch just "today" for a participant's local day window. One call per participant per metric per day (see stravaService.ts), well within the free-tier rate limit. */
export async function listActivitiesSince(accessToken: string, afterUnixSeconds: number): Promise<StravaActivity[]> {
  const params = new URLSearchParams({ after: String(afterUnixSeconds), per_page: "30" });
  const res = await fetch(`${STRAVA_API_BASE}/athlete/activities?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as StravaActivity[];
}

/**
 * Decodes Google's polyline encoding (what Strava's `summary_polyline`
 * uses) into [lat, lng] points, so Strava-sourced samples can go through
 * the exact same GPS-route validator (teleport-jump / pace-vs-distance
 * checks) as HealthKit/Health Connect ones — see
 * modules/health/validators/index.ts.
 */
export function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}
