import { request, type ReadOptions } from "./http";
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
  raceHistory: ProfileRaceHistoryEntry[];
  posts: ProfilePostSummary[];
};

/** Only the fields rendered by a profile's race history and statistics. */
export type ProfileRaceHistoryEntry = Pick<RaceHistoryEntry, "id" | "finishPosition" | "pointsAwarded"> & {
  race: Pick<RaceHistoryEntry["race"], "id" | "name" | "metricKey" | "status" | "league">;
};

/** Profile tiles do not download full feed cards or their photo payloads. */
export type ProfilePostSummary = {
  id: string;
  body: string;
  createdAt: string;
  raceResult: { race: { id: string; name: string } } | null;
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
  imageUrl: string | null;
  eventResult?: {eventId:string;name:string;sportName:string;summary:string;elapsedMs:number} | null;
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

export function getSocialFeed(options?: ReadOptions<{ posts: SocialPost[] }>) {
  return request<{ posts: SocialPost[] }>("/social/feed", options);
}

export function getPostableResults() {
  return request<{ results: SocialRaceResult[] }>("/social/postable-results");
}

export function createSocialPost(input: { body: string; raceEntryId?: string | null; imageUrl?: string | null; eventId?: string | null }) {
  return request<{ post: SocialPost }>("/social/posts", { method: "POST", body: JSON.stringify(input) });
}

export function likeSocialPost(postId: string) {
  return request<{ post: Partial<SocialPost> }>(`/social/posts/${encodeURIComponent(postId)}/like?compact=1`, { method: "POST", body: JSON.stringify({}) });
}

export function unlikeSocialPost(postId: string) {
  return request<{ post: Partial<SocialPost> }>(`/social/posts/${encodeURIComponent(postId)}/like?compact=1`, { method: "DELETE" });
}

export function commentOnSocialPost(postId: string, body: string) {
  return request<{ post: Partial<SocialPost> }>(`/social/posts/${encodeURIComponent(postId)}/comments?compact=1`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function shareSocialPost(postId: string, recipientId?: string | null) {
  return request<{ post: Partial<SocialPost> }>(`/social/posts/${encodeURIComponent(postId)}/share?compact=1`, {
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

export function getConversations(options?: ReadOptions<{conversations:ConversationSummary[]}>) {
  return request<{ conversations: ConversationSummary[] }>("/messages/conversations",{cacheMode:"reload",...options});
}

export function getConversation(playerId: string, options?: ReadOptions<{messages:DirectMessage[]}>) {
  return request<{ messages: DirectMessage[] }>(`/messages/${encodeURIComponent(playerId)}`, {cacheMode:"reload",...options});
}

export function sendMessage(playerId: string, body: string) {
  return request<{ message: DirectMessage }>(`/messages/${encodeURIComponent(playerId)}`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export const getSocialPost=(postId:string)=>request<{post:SocialPost}>(`/social/posts/${encodeURIComponent(postId)}`,{cacheMode:'reload'});

export type ProfileGalleryData={posts:{id:string;body:string;imageUrl:string|null;createdAt:string}[];games:{id:string;name:string;sportKey:string;summary:string;finishedAt:string}[]};
export const getProfileGallery=(id:string,options?:ReadOptions<ProfileGalleryData>)=>request<ProfileGalleryData>(`/players/${encodeURIComponent(id)}/gallery`,{cacheMode:'reload',...options});
