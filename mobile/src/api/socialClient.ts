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
  posts: SocialPost[];
};

export type SocialRaceResult = {
  id: string;
  raceId: string;
  status: string;
  aggregateValue: number | null;
  finishPosition: number | null;
  pointsAwarded: number | null;
  prizeCents: number | null;
  joinedAt: string;
  race: {
    id: string;
    name: string;
    metricKey: string;
    status: string;
    league: { name: string; level: number };
    raceType: { displayName: string };
  };
  squad: { id: string; name: string; finishPosition: number | null } | null;
};

export type SocialPost = {
  id: string;
  body: string;
  createdAt: string;
  author: PlayerSummary;
  raceResult: SocialRaceResult | null;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  hasLiked: boolean;
  comments: SocialPostComment[];
};

export type SocialPostComment = {
  id: string;
  body: string;
  createdAt: string;
  author: PlayerSummary;
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

export function getSocialFeed() {
  return request<{ posts: SocialPost[] }>("/social/feed");
}

export function getPostableResults() {
  return request<{ results: SocialRaceResult[] }>("/social/postable-results");
}

export function createSocialPost(input: { body: string; raceEntryId?: string | null }) {
  return request<{ post: SocialPost }>("/social/posts", { method: "POST", body: JSON.stringify(input) });
}

export function likeSocialPost(postId: string) {
  return request<{ post: SocialPost }>(`/social/posts/${encodeURIComponent(postId)}/like`, { method: "POST", body: JSON.stringify({}) });
}

export function unlikeSocialPost(postId: string) {
  return request<{ post: SocialPost }>(`/social/posts/${encodeURIComponent(postId)}/like`, { method: "DELETE" });
}

export function commentOnSocialPost(postId: string, body: string) {
  return request<{ post: SocialPost }>(`/social/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function shareSocialPost(postId: string, recipientId?: string | null) {
  return request<{ post: SocialPost }>(`/social/posts/${encodeURIComponent(postId)}/share`, {
    method: "POST",
    body: JSON.stringify(recipientId ? { recipientId } : {}),
  });
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
