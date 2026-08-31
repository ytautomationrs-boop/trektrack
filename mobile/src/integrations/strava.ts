import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { getStravaAuthorizeUrl, connectStrava } from "../api/client";

// Must match backend .env's STRAVA_REDIRECT_URI. expo-web-browser's
// openAuthSessionAsync watches for a redirect to this scheme and closes the
// browser itself, handing back the full redirect URL — the OAuth `code`
// never has to round-trip through anything but this device.
const REDIRECT_SCHEME = "streak://strava-callback";

function extractQueryParam(url: string, key: string): string | null {
  const match = url.match(new RegExp(`[?&]${key}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export type StravaConnectResult =
  | { status: "connected"; athleteId: string }
  | { status: "cancelled" }
  | { status: "error"; message: string }
  // Web only — a full top-level redirect just started, so this call's own
  // promise never has a meaningful result to return (the page is about to
  // unload). StravaCallbackScreen finishes the connection after Strava
  // redirects back — see App.tsx.
  | { status: "redirecting" };

/**
 * Starts (and, on native, completes) a Strava connection. Opt-in —
 * cycling/running work fully without ever calling this; on the web pilot,
 * Strava is the PRIMARY verification method since there's no HealthKit/
 * Health Connect in a browser.
 *
 * Web has no equivalent to expo-web-browser's in-app auth session that can
 * await a result — a browser tab navigates fully away and (assuming the
 * user approves) fully back, which tears down this JS context entirely.
 * So on web this function just kicks off that navigation; the connection
 * itself completes in StravaCallbackScreen once the page reloads.
 */
export async function connectStravaAccount(): Promise<StravaConnectResult> {
  if (Platform.OS === "web") {
    try {
      const { url } = await getStravaAuthorizeUrl("web");
      window.location.href = url;
      return { status: "redirecting" };
    } catch (err: any) {
      return { status: "error", message: err.message ?? "Couldn't connect Strava." };
    }
  }

  try {
    const { url } = await getStravaAuthorizeUrl();
    const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT_SCHEME);

    if (result.type !== "success" || !result.url) return { status: "cancelled" };

    const code = extractQueryParam(result.url, "code");
    const state = extractQueryParam(result.url, "state");
    const error = extractQueryParam(result.url, "error");
    if (error || !code) return { status: "cancelled" };
    // Strava echoes state back untouched. Without it the backend refuses
    // the code, so treat a missing one as a failed connection rather than
    // posting a request that cannot succeed.
    if (!state) return { status: "error", message: "Strava didn't return the security token. Please try connecting again." };

    const res = await connectStrava(code, state);
    return { status: "connected", athleteId: res.athleteId };
  } catch (err: any) {
    return { status: "error", message: err.message ?? "Couldn't connect Strava." };
  }
}
