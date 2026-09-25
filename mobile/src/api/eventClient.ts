import { request } from "./http";
import type { PlayerSummary } from "./socialClient";

export type SocialSport = {
  key: string;
  name: string;
  icon: string;
};

export type SocialEventParticipant = {
  id: string;
  userId: string;
  joinedAt: string;
  isViewer: boolean;
  player: PlayerSummary;
};

export type SocialEvent = {
  id: string;
  name: string;
  sportKey: string;
  sportName: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  maxPlayers: number;
  visibility: "PUBLIC" | "PRIVATE";
  inviteCode: string | null;
  status: "UPCOMING" | "CANCELLED" | "COMPLETED";
  host: PlayerSummary;
  isHost: boolean;
  hasJoined: boolean;
  participantCount: number;
  slotsRemaining: number;
  participants: SocialEventParticipant[];
  createdAt: string;
};

export function getSocialSports() {
  return request<{ sports: SocialSport[] }>("/social-events/sports");
}

export function getSocialEvents() {
  // Event discovery must reflect games other people have just published.
  // Supplying a header opts this request out of the short shared GET cache;
  // pull-to-refresh and returning to the tab now always load the public list.
  return request<{ events: SocialEvent[] }>("/social-events", { headers: { "Cache-Control": "no-cache" } });
}

export function getSocialEvent(eventId: string, inviteCode?: string | null) {
  const q = inviteCode ? `?code=${encodeURIComponent(inviteCode)}` : "";
  return request<{ event: SocialEvent }>(`/social-events/${encodeURIComponent(eventId)}${q}`);
}

export function createSocialEvent(input: {
  name: string;
  sportKey: string;
  customSportName?: string;
  description?: string;
  location?: string;
  startsAt: string;
  maxPlayers: number;
  visibility: "PUBLIC" | "PRIVATE";
}) {
  return request<{ event: SocialEvent }>("/social-events", { method: "POST", body: JSON.stringify(input) });
}

export function joinSocialEvent(eventId: string, inviteCode?: string | null) {
  return request<{ event: SocialEvent }>(`/social-events/${encodeURIComponent(eventId)}/join`, {
    method: "POST",
    body: JSON.stringify(inviteCode ? { inviteCode } : {}),
  });
}

export function leaveSocialEvent(eventId: string) {
  return request<{ event: SocialEvent }>(`/social-events/${encodeURIComponent(eventId)}/leave`, { method: "POST", body: JSON.stringify({}) });
}

export function deleteSocialEvent(eventId: string) {
  return request<{ deleted: true; eventId: string }>(`/social-events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
}
