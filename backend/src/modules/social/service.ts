import { prisma } from "../../lib/prisma.js";
import { getLeagueStandings } from "../races/leagues.js";
import { listUserRaceEntries } from "../races/service.js";

export type FriendState = "none" | "pending_sent" | "pending_received" | "friends" | "blocked";

const playerSelect = {
  id: true,
  displayName: true,
  avatarUrl: true,
  createdAt: true,
} as const;

function serializePlayer(user: { id: string; displayName: string; avatarUrl: string | null; createdAt: Date }) {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: null,
    joinedAt: user.createdAt,
  };
}

export async function friendshipState(viewerId: string, playerId: string): Promise<FriendState> {
  if (viewerId === playerId) return "friends";
  const friendship = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: viewerId, addresseeId: playerId },
        { requesterId: playerId, addresseeId: viewerId },
      ],
    },
  });
  if (!friendship) return "none";
  if (friendship.status === "ACCEPTED") return "friends";
  if (friendship.status === "BLOCKED") return "blocked";
  return friendship.requesterId === viewerId ? "pending_sent" : "pending_received";
}

export async function searchPlayers(viewerId: string, query: string, limit = 20) {
  const q = query.trim();
  if (q.length < 2) return [];

  const users = await prisma.user.findMany({
    where: {
      id: { not: viewerId },
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: playerSelect,
    orderBy: [{ displayName: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(limit, 1), 30),
  });

  return Promise.all(
    users.map(async (user) => ({
      ...serializePlayer(user),
      friendState: await friendshipState(viewerId, user.id),
    }))
  );
}

export async function listFriends(viewerId: string) {
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [{ requesterId: viewerId }, { addresseeId: viewerId }],
    },
    include: {
      requester: { select: playerSelect },
      addressee: { select: playerSelect },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return {
    friends: friendships
      .filter((f) => f.status === "ACCEPTED")
      .map((f) => serializePlayer(f.requesterId === viewerId ? f.addressee : f.requester)),
    incoming: friendships
      .filter((f) => f.status === "PENDING" && f.addresseeId === viewerId)
      .map((f) => serializePlayer(f.requester)),
    outgoing: friendships
      .filter((f) => f.status === "PENDING" && f.requesterId === viewerId)
      .map((f) => serializePlayer(f.addressee)),
  };
}

export async function requestFriend(viewerId: string, playerId: string) {
  if (viewerId === playerId) {
    throw Object.assign(new Error("You can't add yourself."), { statusCode: 400, code: "self_friend" });
  }

  const player = await prisma.user.findUnique({ where: { id: playerId }, select: { id: true } });
  if (!player) throw Object.assign(new Error("Player not found."), { statusCode: 404, code: "player_not_found" });

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: viewerId, addresseeId: playerId },
        { requesterId: playerId, addresseeId: viewerId },
      ],
    },
  });

  if (!existing) {
    await prisma.friendship.create({ data: { requesterId: viewerId, addresseeId: playerId } });
    return { friendState: "pending_sent" as const };
  }

  if (existing.status === "PENDING" && existing.addresseeId === viewerId) {
    await prisma.friendship.update({
      where: { id: existing.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    return { friendState: "friends" as const };
  }

  return { friendState: await friendshipState(viewerId, playerId) };
}

export async function acceptFriend(viewerId: string, requesterId: string) {
  const friendship = await prisma.friendship.findFirst({
    where: { requesterId, addresseeId: viewerId, status: "PENDING" },
  });
  if (!friendship) throw Object.assign(new Error("Friend request not found."), { statusCode: 404, code: "friend_request_not_found" });

  await prisma.friendship.update({
    where: { id: friendship.id },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });
  return { friendState: "friends" as const };
}

export async function removeFriend(viewerId: string, playerId: string) {
  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: viewerId, addresseeId: playerId },
        { requesterId: playerId, addresseeId: viewerId },
      ],
    },
  });
  return { friendState: "none" as const };
}

async function assertCanMessage(viewerId: string, playerId: string) {
  if (viewerId === playerId) {
    throw Object.assign(new Error("You can't message yourself."), { statusCode: 400, code: "self_message" });
  }
  const state = await friendshipState(viewerId, playerId);
  if (state !== "friends") {
    throw Object.assign(new Error("You can only message people you follow back and forth."), {
      statusCode: 403,
      code: "not_connected",
    });
  }
}

export async function listConversations(viewerId: string) {
  const messages = await prisma.directMessage.findMany({
    where: { OR: [{ senderId: viewerId }, { recipientId: viewerId }] },
    include: {
      sender: { select: playerSelect },
      recipient: { select: playerSelect },
    },
    orderBy: { createdAt: "desc" },
    take: 150,
  });

  const seen = new Set<string>();
  const conversations = [];
  for (const message of messages) {
    const other = message.senderId === viewerId ? message.recipient : message.sender;
    if (seen.has(other.id)) continue;
    seen.add(other.id);
    conversations.push({
      player: serializePlayer(other),
      lastMessage: serializeMessage(message, viewerId),
      unreadCount: messages.filter((m) => m.senderId === other.id && m.recipientId === viewerId && !m.readAt).length,
    });
  }
  return conversations;
}

function serializeMessage(message: { id: string; senderId: string; recipientId: string; body: string; createdAt: Date; readAt: Date | null }, viewerId: string) {
  return {
    id: message.id,
    senderId: message.senderId,
    recipientId: message.recipientId,
    body: message.body,
    createdAt: message.createdAt,
    readAt: message.readAt,
    isMine: message.senderId === viewerId,
  };
}

export async function getConversation(viewerId: string, playerId: string) {
  await assertCanMessage(viewerId, playerId);
  const messages = await prisma.directMessage.findMany({
    where: {
      OR: [
        { senderId: viewerId, recipientId: playerId },
        { senderId: playerId, recipientId: viewerId },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  await prisma.directMessage.updateMany({
    where: { senderId: playerId, recipientId: viewerId, readAt: null },
    data: { readAt: new Date() },
  });

  return { messages: messages.map((message) => serializeMessage(message, viewerId)) };
}

export async function sendMessage(viewerId: string, playerId: string, body: string) {
  await assertCanMessage(viewerId, playerId);
  const message = await prisma.directMessage.create({
    data: { senderId: viewerId, recipientId: playerId, body: body.trim() },
  });
  return { message: serializeMessage(message, viewerId) };
}

export async function getPlayerProfile(viewerId: string, playerId: string) {
  const user = await prisma.user.findUnique({ where: { id: playerId }, select: playerSelect });
  if (!user) throw Object.assign(new Error("Player not found."), { statusCode: 404, code: "player_not_found" });

  const [friendState, leagues, raceHistory] = await Promise.all([
    friendshipState(viewerId, playerId),
    getLeagueStandings(playerId),
    listUserRaceEntries(playerId, 20),
  ]);

  return {
    player: serializePlayer(user),
    friendState,
    leagues,
    raceHistory,
  };
}
