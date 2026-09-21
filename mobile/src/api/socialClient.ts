import { request } from "./http";
import type { LeagueStandings, RaceHistoryEntry } from "./raceTypes";

export type FriendState = "none" | "pending_sent" | "pending_received" | "friends" | "blocked";

export type PlayerSummary = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
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

export type DirectMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  isMine: boolean;
};

export type ConversationSummary = {
  player: PlayerSummary;
  lastMessage: DirectMessage;
  unreadCount: number;
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
  return request<{ friendState: FriendState }>(`/friends/${encodeURIComponent(playerId)}/request`, { method: "POST", body: JSON.stringify({}) });
}

export function acceptFriend(playerId: string) {
  return request<{ friendState: FriendState }>(`/friends/${encodeURIComponent(playerId)}/accept`, { method: "POST", body: JSON.stringify({}) });
}

export function removeFriend(playerId: string) {
  return request<{ friendState: FriendState }>(`/friends/${encodeURIComponent(playerId)}`, { method: "DELETE" });
}

export function getConversations() {
  return request<{ conversations: ConversationSummary[] }>("/messages/conversations");
}

export function getConversation(playerId: string) {
  return request<{ messages: DirectMessage[] }>(`/messages/${encodeURIComponent(playerId)}`);
}

export function sendMessage(playerId: string, body: string) {
  return request<{ message: DirectMessage }>(`/messages/${encodeURIComponent(playerId)}`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}
