import { Platform } from "react-native";

const DEPLOYED_WEB_ORIGIN =
  process.env.EXPO_PUBLIC_WEB_URL?.trim() ||
  process.env.EXPO_PUBLIC_API_URL?.trim() ||
  "https://lightsteelblue-giraffe-860469.hostingersite.com";

function origin() {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location.origin) {
    return window.location.protocol === "capacitor:" ? DEPLOYED_WEB_ORIGIN : window.location.origin;
  }
  return DEPLOYED_WEB_ORIGIN;
}

export function raceUrl(raceId: string, inviteCode?: string | null) {
  const url = `${origin()}/race/${encodeURIComponent(raceId)}`;
  return inviteCode ? `${url}?code=${encodeURIComponent(inviteCode)}` : url;
}

export function eventUrl(eventId: string, inviteCode?: string | null) {
  const url = `${origin()}/event/${encodeURIComponent(eventId)}`;
  return inviteCode ? `${url}?code=${encodeURIComponent(inviteCode)}` : url;
}
