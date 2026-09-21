import { Platform } from "react-native";

function origin() {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location.origin) return window.location.origin;
  return "https://lightsteelblue-giraffe-860469.hostingersite.com";
}

export function raceUrl(raceId: string, inviteCode?: string | null) {
  const url = `${origin()}/race/${encodeURIComponent(raceId)}`;
  return inviteCode ? `${url}?code=${encodeURIComponent(inviteCode)}` : url;
}

export function eventUrl(eventId: string, inviteCode?: string | null) {
  const url = `${origin()}/event/${encodeURIComponent(eventId)}`;
  return inviteCode ? `${url}?code=${encodeURIComponent(inviteCode)}` : url;
}
