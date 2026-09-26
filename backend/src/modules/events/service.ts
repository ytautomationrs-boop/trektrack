import { randomBytes } from "node:crypto";
import { notifyActivity, notifyActorActivity } from "../notifications/inbox.js";
import { prisma } from "../../lib/prisma.js";

export const SOCIAL_SPORTS = [
  { key: "tennis", name: "Tennis", icon: "tennisball-outline" },
  { key: "squash", name: "Squash", icon: "scan-circle-outline" },
  { key: "padel", name: "Padel", icon: "radio-button-on-outline" },
  { key: "rugby", name: "Rugby union", icon: "american-football-outline" },
  { key: "touch_rugby", name: "Touch rugby", icon: "american-football-outline" },
  { key: "football", name: "Football", icon: "football-outline" },
  { key: "basketball", name: "Basketball", icon: "basketball-outline" },
  { key: "netball", name: "Netball", icon: "ellipse-outline" },
  { key: "volleyball", name: "Volleyball", icon: "radio-button-off-outline" },
  { key: "hiking", name: "Hiking", icon: "trail-sign-outline" },
  { key: "custom", name: "Custom game", icon: "create-outline" },
] as const;

export class SocialEventError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

type EventWithRelations = NonNullable<Awaited<ReturnType<typeof findEvent>>>;

function generateInviteCode() {
  return randomBytes(4).toString("hex");
}

function sportNameFor(key: string, customName?: string | null) {
  if (key === "custom") return customName?.trim() || "Custom game";
  return SOCIAL_SPORTS.find((sport) => sport.key === key)?.name ?? key;
}

const eventInclude = {
  host: { select: { id: true, displayName: true, bio: true, createdAt: true } },
  participants: {
    where: { status: "JOINED" },
    include: { user: { select: { id: true, displayName: true, bio: true, createdAt: true } } },
    orderBy: { joinedAt: "asc" },
  },
} as const;

async function findEvent(eventId: string) {
  return prisma.socialEvent.findUnique({ where: { id: eventId }, include: eventInclude });
}

function serializePlayer(user: { id: string; displayName: string; bio: string | null; createdAt: Date }) {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: null,
    bio: user.bio,
    joinedAt: user.createdAt,
  };
}

function decorateEvent(event: EventWithRelations, viewerId: string) {
  const joined = event.participants.some((participant) => participant.userId === viewerId);
  return {
    id: event.id,
    name: event.name,
    sportKey: event.sportKey,
    sportName: event.sportName,
    description: event.description,
    location: event.location,
    startsAt: event.startsAt,
    maxPlayers: event.maxPlayers,
    visibility: event.visibility,
    inviteCode: event.hostUserId === viewerId || joined ? event.inviteCode : null,
    status: event.status,
    game: event.game,
    host: serializePlayer(event.host),
    isHost: event.hostUserId === viewerId,
    hasJoined: joined,
    participantCount: event.participants.length,
    slotsRemaining: Math.max(0, event.maxPlayers - event.participants.length),
    participants: event.participants.map((participant) => ({
      id: participant.id,
      userId: participant.userId,
      joinedAt: participant.joinedAt,
      isViewer: participant.userId === viewerId,
      player: serializePlayer(participant.user),
    })),
    createdAt: event.createdAt,
  };
}

export function listSocialSports() {
  return SOCIAL_SPORTS;
}

export async function listSocialEvents(viewerId: string, joinedOnly = false) {
  const membership = [{ hostUserId: viewerId }, { participants: { some: { userId: viewerId, status: "JOINED" as const } } }];
  const [active, past] = await Promise.all([
    prisma.socialEvent.findMany({where:{status:{in:['UPCOMING','LIVE']},OR:joinedOnly?membership:[{visibility:'PUBLIC',status:'UPCOMING',startsAt:{gte:new Date(Date.now()-3600000)}},...membership]},include:eventInclude,orderBy:{startsAt:'asc'},take:80}),
    prisma.socialEvent.findMany({where:{status:'COMPLETED',OR:membership},include:eventInclude,orderBy:{startsAt:'desc'},take:40}),
  ]);
  return [...active,...past].map(event=>decorateEvent(event,viewerId));
}

export async function getSocialEvent(eventId: string, viewerId: string, inviteCode?: string | null) {
  const event = await findEvent(eventId);
  if (!event) throw new SocialEventError("not_found", "Event not found.");
  const canViewPrivate =
    event.hostUserId === viewerId ||
    event.participants.some((p) => p.userId === viewerId) ||
    event.inviteCode === inviteCode?.trim().toLowerCase();
  if (event.visibility === "PRIVATE" && !canViewPrivate) {
    throw new SocialEventError("not_found", "Event not found.");
  }
  return decorateEvent(event, viewerId);
}

export async function createSocialEvent(input: {
  hostUserId: string;
  name: string;
  sportKey: string;
  customSportName?: string | null;
  description?: string | null;
  location?: string | null;
  startsAt: Date;
  maxPlayers: number;
  visibility: "PUBLIC" | "PRIVATE";
}) {
  const sportKey = input.sportKey.trim().toLowerCase();
  const known = SOCIAL_SPORTS.some((sport) => sport.key === sportKey);
  if (!known) throw new SocialEventError("unknown_sport", "Choose a sport from the list, or choose Custom game.");
  if (input.startsAt.getTime() < Date.now() - 10 * 60 * 1000) {
    throw new SocialEventError("event_in_past", "Choose a date and time in the future.");
  }

  const sportName = sportNameFor(sportKey, input.customSportName);
  const event = await prisma.socialEvent.create({
    data: {
      hostUserId: input.hostUserId,
      name: input.name.trim(),
      sportKey,
      sportName,
      description: input.description?.trim() || null,
      location: input.location?.trim() || null,
      startsAt: input.startsAt,
      maxPlayers: input.maxPlayers,
      visibility: input.visibility,
      inviteCode: generateInviteCode(),
      participants: { create: { userId: input.hostUserId, status: "JOINED" } },
    },
    include: eventInclude,
  });
  return decorateEvent(event, input.hostUserId);
}

export async function joinSocialEvent(eventId: string, userId: string, inviteCode?: string | null) {
  const hostId = await prisma.$transaction(async (tx) => {
    const [event] = await tx.$queryRaw<Array<{hostUserId:string;status:string;visibility:string;inviteCode:string|null;maxPlayers:number}>>`SELECT "hostUserId", "status", "visibility", "inviteCode", "maxPlayers" FROM "SocialEvent" WHERE "id"=${eventId} FOR UPDATE`;
    if (!event) throw new SocialEventError("not_found", "Event not found.");
    const entries = await tx.socialEventParticipant.findMany({where:{eventId,status:"JOINED"},select:{userId:true}});
    if (entries.some(p=>p.userId===userId)) return;
    if (event.status !== "UPCOMING") throw new SocialEventError("event_closed", "This event has already started.");
    if (event.visibility === "PRIVATE" && event.inviteCode !== inviteCode?.trim().toLowerCase()) throw new SocialEventError("invalid_invite", "Use a valid invite to join this event.");
    if (entries.length >= event.maxPlayers) throw new SocialEventError("event_full", "This event is full.");
    await tx.socialEventParticipant.upsert({where:{eventId_userId:{eventId,userId}},create:{eventId,userId,status:"JOINED"},update:{status:"JOINED",leftAt:null,joinedAt:new Date()}});
    return event.hostUserId;
  }, {timeout:10000});
  const result=await getSocialEvent(eventId,userId,inviteCode);
  if(hostId && hostId!==userId) void notifyActorActivity(hostId,userId,"event_join",`${eventId}:join:${userId}`,"New player",`joined ${result.name}.`,{eventId});
  return result;
}

export async function leaveSocialEvent(eventId: string, userId: string) {
  await prisma.$transaction(async tx=>{
    const [event] = await tx.$queryRaw<Array<{hostUserId:string;status:string}>>`SELECT "hostUserId", "status" FROM "SocialEvent" WHERE "id"=${eventId} FOR UPDATE`;
    if (!event) throw new SocialEventError("not_found","Event not found.");
    if (event.hostUserId===userId) throw new SocialEventError("host_cannot_leave","Hosts stay listed on their own event.");
    if (event.status!=="UPCOMING") throw new SocialEventError("event_closed","A game in progress cannot be left.");
    await tx.socialEventParticipant.updateMany({where:{eventId,userId,status:"JOINED"},data:{status:"LEFT",leftAt:new Date()}});
  });
  // Return the updated event to its former participant without exposing it to others.
  const event=await findEvent(eventId);
  if (!event) throw new SocialEventError("not_found","Event not found.");
  return decorateEvent(event,userId);
}

export async function inviteToEvent(eventId:string,viewerId:string,playerId:string) {
  const event=await getSocialEvent(eventId,viewerId);
  if (!event.hasJoined) throw new SocialEventError("not_joined","Join the event before inviting players.");
  if(event.status!=="UPCOMING") throw new SocialEventError("event_closed","This game has already started.");
  const friend=await prisma.friendship.findFirst({where:{status:"ACCEPTED",OR:[{requesterId:viewerId,addresseeId:playerId},{requesterId:playerId,addresseeId:viewerId}]},select:{id:true}});
  if(!friend) throw new SocialEventError("not_connected","You can invite players you follow.");
  void notifyActorActivity(playerId,viewerId,'event_invite',`${eventId}:invite:${viewerId}`,'Game invitation',`invited you to ${event.name}.`,{eventId,...(event.inviteCode?{code:event.inviteCode}:{})});
  return {invited:true};
}

export async function deleteSocialEvent(eventId: string, userId: string) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{hostUserId:string;status:string}>>`SELECT "hostUserId", "status" FROM "SocialEvent" WHERE id = ${eventId} FOR UPDATE`;
    const event=rows[0];
    if (!event) throw new SocialEventError("not_found", "Event not found.");
    if (event.hostUserId !== userId) throw new SocialEventError("not_host", "Only the host can delete this event.");
    if (event.status !== "UPCOMING") throw new SocialEventError("event_closed", "This event can no longer be deleted.");
    await tx.socialEvent.delete({where:{id:eventId}});
    return {id:eventId};
  });
}
