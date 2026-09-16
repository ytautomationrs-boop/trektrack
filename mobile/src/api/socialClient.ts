import { request } from "./http";
import type { LeagueStandings, RaceHistoryEntry } from "./raceTypes";

export type FriendState = "none" | "pending_sent" | "pending_received" | "friends" | "blocked";

export type PlayerSummary = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string;
  friendState?: FriendState;
};

export type FriendsPayload = {
  friends: PlayerSummary[];
  incoming: PlayerSummary[];
  outgoing: PlayerSummary[];
};

export type PlayerProfile = {
  player: PlayerSummary;
  friendState: FriendState;
  leagues: LeagueStandings;
  raceHistory: RaceHistoryEntry[];
};

export function searchPlayers(q: string) {
  return request<{ players: PlayerSummary[] }>(`/players/search?q=${encodeURIComponent(q)}`);
}

export function getFriends() {
  return request<FriendsPayload>("/friends");
}

export function getPlayerProfile(playerId: string) {
  return request<PlayerProfile>(`/players/${encodeURIComponent(playerId)}`);
}

export function requestFriend(playerId: string) {
  return request<{ friendState: FriendState }>(`/friends/${encodeURIComponent(playerId)}/request`, { method: "POST" });
}

export function acceptFriend(playerId: string) {
  return request<{ friendState: FriendState }>(`/friends/${encodeURIComponent(playerId)}/accept`, { method: "POST" });
}

export function removeFriend(playerId: string) {
  return request<{ friendState: FriendState }>(`/friends/${encodeURIComponent(playerId)}`, { method: "DELETE" });
}
