import type { Game } from "../games/scoring";
import { request, type ReadOptions } from "./http";
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
  status: "UPCOMING" | "LIVE" | "CANCELLED" | "COMPLETED";
  game: Game | null;
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

export function getSocialEvents(options?: ReadOptions<{ events: SocialEvent[] }>) {
  // Refresh from the server while retaining deduplication and saved previews.
  return request<{ events: SocialEvent[] }>("/social-events", { cacheMode: "reload", ...options });
}

export function getSocialEvent(eventId: string, inviteCode?: string | null, options?: ReadOptions<{event:SocialEvent}>) {
  const q = inviteCode ? `?code=${encodeURIComponent(inviteCode)}` : "";
  return request<{ event: SocialEvent }>(`/social-events/${encodeURIComponent(eventId)}${q}`, {cacheMode:"reload",...options});
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

export function updateSocialGame(eventId:string, command:{action:'start'|'score'|'undo'|'pause'|'resume'|'finish';operationId:string;version:number;side?:0|1;value?:number;teams?:[string,string];bestOf?:1|3|5}) {
 return request<{game:Game;status:SocialEvent['status']}>(`/social-events/${encodeURIComponent(eventId)}/game`,{method:'POST',body:JSON.stringify(command)});
}
export const inviteToSocialEvent=(eventId:string,playerId:string)=>request(`/social-events/${encodeURIComponent(eventId)}/invite`,{method:'POST',body:JSON.stringify({playerId})});
