import { notifyActivity } from "../notifications/inbox.js";
import { gameSummary, type Game } from "../events/scoring.js";
import { storePhoto } from "../media/service.js";
import { prisma } from "../../lib/prisma.js";
import { getLeagueStandings } from "../races/leagues.js";

export type FriendState = "none" | "pending_sent" | "pending_received" | "friends" | "blocked";

const playerSelect = {
  id: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  createdAt: true,
} as const;

const raceResultInclude = {
  race: {
    select: {
      id: true,
      name: true,
      metricKey: true,
      status: true,
      league: { select: { name: true, level: true } },
      raceType: { select: { displayName: true } },
    },
  },
  squad: { select: { id: true, name: true, finishPosition: true } },
} as const;

function serializePlayer(user: { id: string; displayName: string; avatarUrl: string | null; bio: string | null; createdAt: Date }) {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    joinedAt: user.createdAt,
  };
}

function serializeRaceResult(entry: {
  id: string;
  raceId: string;
  status: string;
  aggregateValue: number | null;
  finishPosition: number | null;
  pointsAwarded: number | null;
  prizeCents: number | null;
  joinedAt: Date;
  race: {
    id: string;
    name: string;
    metricKey: string;
    status: string;
    league: { name: string; level: number };
    raceType: { displayName: string };
  };
  squad: { id: string; name: string; finishPosition: number | null } | null;
}) {
  return {
    id: entry.id,
    raceId: entry.raceId,
    status: entry.status,
    aggregateValue: entry.aggregateValue,
    finishPosition: entry.finishPosition,
    pointsAwarded: entry.pointsAwarded,
    prizeCents: entry.prizeCents,
    joinedAt: entry.joinedAt,
    race: entry.race,
    squad: entry.squad,
  };
}

function postInclude(viewerId: string) {
  return {
    author: { select: playerSelect },
    raceEntry: { include: raceResultInclude },
    event: { select: { id:true, name:true, sportName:true, sportKey:true, game:true } },
    _count: { select: { likes: true, comments: true, shares: true } },
    likes: { where: { userId: viewerId }, select: { id: true }, take: 1 },
    comments: {
      include: { user: { select: playerSelect } },
      orderBy: { createdAt: "asc" as const },
      take: 3,
    },
  };
}

function serializePost(post: any) {
  return {
    id: post.id,
    body: post.body,
    imageUrl: post.imageUrl ?? null,
    createdAt: post.createdAt,
    author: serializePlayer(post.author),
    raceResult: post.raceEntry ? serializeRaceResult(post.raceEntry) : null,
    eventResult: post.event?.game ? {eventId:post.event.id,name:post.event.name,sportName:post.event.sportName,summary:gameSummary(post.event.sportKey,post.event.game as Game),elapsedMs:(post.event.game as Game).elapsedMs} : null,
    likeCount: post._count?.likes ?? 0,
    commentCount: post._count?.comments ?? 0,
    shareCount: post._count?.shares ?? 0,
    hasLiked: Boolean(post.likes?.length),
    comments: (post.comments ?? []).map((comment: any) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      author: serializePlayer(comment.user),
    })),
  };
}

export async function findSerializablePost(postId: string, viewerId: string) {
  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: postInclude(viewerId),
  });
  if (!post) throw Object.assign(new Error("Post not found."), { statusCode: 404, code: "post_not_found" });
  return serializePost(post);
}

async function connectedIds(viewerId: string) {
  const friendships = await prisma.friendship.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: viewerId }, { addresseeId: viewerId }],
    },
    select: { requesterId: true, addresseeId: true },
    take: 250,
  });
  return [viewerId, ...friendships.map((f) => (f.requesterId === viewerId ? f.addresseeId : f.requesterId))];
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

export async function listSocialFeed(viewerId: string) {
  const authorIds = await connectedIds(viewerId);
  const posts = await prisma.socialPost.findMany({
    where: { authorId: { in: authorIds } },
    include: postInclude(viewerId),
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return posts.map(serializePost);
}

export async function listPostableResults(viewerId: string) {
  const entries = await prisma.raceEntry.findMany({
    where: {
      userId: viewerId,
      OR: [{ status: "SCORED" }, { finishPosition: { not: null } }, { pointsAwarded: { not: null } }],
    },
    include: raceResultInclude,
    orderBy: { joinedAt: "desc" },
    take: 12,
  });
  return entries.map(serializeRaceResult);
}

export async function createSocialPost(viewerId: string, input: { body: string; raceEntryId?: string | null; imageUrl?: string | null; eventId?: string | null }) {
  const body = input.body.trim();
  if (!body) throw Object.assign(new Error("Write something before posting."), { statusCode: 400, code: "empty_post" });

  let raceEntryId: string | null = null;
  if (input.raceEntryId) {
    const entry = await prisma.raceEntry.findFirst({
      where: { id: input.raceEntryId, userId: viewerId },
      select: { id: true },
    });
    if (!entry) throw Object.assign(new Error("That result is not available on your profile."), { statusCode: 404, code: "result_not_found" });
    raceEntryId = entry.id;
  }

  if (input.eventId) {
    const event=await prisma.socialEvent.findFirst({where:{id:input.eventId,status:'COMPLETED',participants:{some:{userId:viewerId,status:'JOINED'}}},select:{id:true}});
    if (!event) throw Object.assign(new Error('Only participants can share a completed game.'),{statusCode:403});
  }
  const post = await prisma.socialPost.create({
    data: { authorId: viewerId, body, raceEntryId, eventId: input.eventId ?? null, imageUrl: await storePhoto(viewerId, input.imageUrl) },
    include: postInclude(viewerId),
  });
  return serializePost(post);
}

// Mutation responses exclude unchanged photos, game histories and race relations.
export async function socialInteractionPatch(postId:string,viewerId:string){
 const post=await prisma.socialPost.findUniqueOrThrow({where:{id:postId},select:{id:true,_count:{select:{likes:true,comments:true,shares:true}},likes:{where:{userId:viewerId},select:{id:true},take:1},comments:{orderBy:{createdAt:'desc'},take:3,select:{id:true,body:true,createdAt:true,user:{select:{id:true,displayName:true}}}}}});
 return {id:post.id,likeCount:post._count.likes,commentCount:post._count.comments,shareCount:post._count.shares,hasLiked:!!post.likes.length,comments:post.comments.reverse().map(c=>({id:c.id,body:c.body,createdAt:c.createdAt,author:{...c.user,avatarUrl:null,bio:null,joinedAt:''}}))};
}

export async function setSocialPostLike(viewerId: string, postId: string, liked: boolean, compact=false) {
  const post = await prisma.socialPost.findUnique({ where: { id: postId }, select: { id: true, authorId:true } });
  if (!post) throw Object.assign(new Error("Post not found."), { statusCode: 404, code: "post_not_found" });

  if (liked) {
    await prisma.socialPostLike.upsert({
      where: { postId_userId: { postId, userId: viewerId } },
      create: { postId, userId: viewerId },
      update: {},
    });
  } else {
    await prisma.socialPostLike.deleteMany({ where: { postId, userId: viewerId } });
  }

  if(liked && post.authorId!==viewerId) void notifyActivity(post.authorId,'like',`like:${postId}:${viewerId}`,'New like','Someone liked your post.',{postId});
  return compact ? socialInteractionPatch(postId,viewerId) : findSerializablePost(postId, viewerId);
}

export async function createSocialPostComment(viewerId: string, postId: string, body: string, compact=false) {
  const text = body.trim();
  if (!text) throw Object.assign(new Error("Write a comment first."), { statusCode: 400, code: "empty_comment" });
  const post = await prisma.socialPost.findUnique({ where: { id: postId }, select: { id: true, authorId:true } });
  if (!post) throw Object.assign(new Error("Post not found."), { statusCode: 404, code: "post_not_found" });

  const comment=await prisma.socialPostComment.create({ data: { postId, userId: viewerId, body: text } });
  if(post.authorId!==viewerId) void notifyActivity(post.authorId,"comment",`comment:${comment.id}`,"New comment","Someone commented on your post.",{postId});
  return compact ? socialInteractionPatch(postId,viewerId) : findSerializablePost(postId, viewerId);
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
    await prisma.friendship.create({ data: { requesterId: viewerId, addresseeId: playerId, status: "ACCEPTED", acceptedAt: new Date() } });
    void notifyActivity(playerId,'follow',`follow:${viewerId}`,'New follower','Someone followed you on ASTA.',{playerId:viewerId});
    return { friendState: "friends" as const };
  }

  if (existing.status === "PENDING" && existing.addresseeId === viewerId) {
    await prisma.friendship.update({
      where: { id: existing.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    return { friendState: "friends" as const };
  }

  if (existing.status === "PENDING" && existing.requesterId === viewerId) {
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
  // Pick one message per conversation in SQL; do not repeat both avatars on 150 rows.
  const [messages, unread] = await Promise.all([
    prisma.$queryRaw<Array<{id:string;senderId:string;recipientId:string;body:string;createdAt:Date;readAt:Date|null;partnerId:string}>>`
      WITH messages AS (
        SELECT *, CASE WHEN "senderId"=${viewerId} THEN "recipientId" ELSE "senderId" END AS "partnerId"
        FROM "DirectMessage" WHERE "senderId"=${viewerId} OR "recipientId"=${viewerId}
      )
      SELECT * FROM (SELECT DISTINCT ON ("partnerId") * FROM messages
        ORDER BY "partnerId", "createdAt" DESC, "id" DESC) recent
      ORDER BY "createdAt" DESC LIMIT 50`,
    prisma.directMessage.groupBy({by:['senderId'],where:{recipientId:viewerId,readAt:null},_count:{_all:true}}),
  ]);
  if(!messages.length)return [];
  const players=await prisma.user.findMany({where:{id:{in:messages.map(m=>m.partnerId)}},select:playerSelect});
  const byId=new Map(players.map(p=>[p.id,p]));
  const counts=new Map(unread.map(u=>[u.senderId,u._count._all]));
  return messages.flatMap(m=>{const player=byId.get(m.partnerId);return player?[{player:serializePlayer(player),lastMessage:serializeMessage(m,viewerId),unreadCount:counts.get(m.partnerId)??0}]:[];});
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
  const [,messages]=await Promise.all([
    assertCanMessage(viewerId,playerId),
    prisma.directMessage.findMany({where:{OR:[{senderId:viewerId,recipientId:playerId},{senderId:playerId,recipientId:viewerId}]},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100}),
  ]);
  const unread=messages.filter(m=>m.recipientId===viewerId && !m.readAt).map(m=>m.id);
  if(unread.length) void prisma.directMessage.updateMany({where:{id:{in:unread},recipientId:viewerId,readAt:null},data:{readAt:new Date()}}).catch(error=>console.error('[messages] read receipt failed',error));
  return {messages:messages.reverse().map(message=>serializeMessage(message,viewerId))};
}

export async function sendMessage(viewerId: string, playerId: string, body: string) {
  await assertCanMessage(viewerId, playerId);
  const message = await prisma.directMessage.create({
    data: { senderId: viewerId, recipientId: playerId, body: body.trim() },
  });
  void notifyActivity(playerId,"message",`message:${message.id}`,"New message","You have a new message on ASTA.",{playerId:viewerId});
  return { message: serializeMessage(message, viewerId) };
}

export async function shareSocialPost(viewerId: string, postId: string, recipientId?: string | null, compact=false) {
  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    select: {body:true,author:{select:{displayName:true}}},
  });
  if (!post) throw Object.assign(new Error("Post not found."), { statusCode: 404, code: "post_not_found" });

  if (recipientId) {
    await assertCanMessage(viewerId, recipientId);
    await prisma.directMessage.create({
      data: {
        senderId: viewerId,
        recipientId,
        body: `Shared ${post.author.displayName}'s post: ${post.body.slice(0, 180)}`,
      },
    });
  }

  await prisma.socialPostShare.create({ data: { postId, userId: viewerId, recipientId: recipientId || null } });
  return compact ? socialInteractionPatch(postId,viewerId) : findSerializablePost(postId, viewerId);
}

export async function getPlayerProfile(viewerId: string, playerId: string) {
  const user = await prisma.user.findUnique({ where: { id: playerId }, select: playerSelect });
  if (!user) throw Object.assign(new Error("Player not found."), { statusCode: 404, code: "player_not_found" });

  const [friendState, leagues, raceHistory, posts] = await Promise.all([
    friendshipState(viewerId, playerId),
    getLeagueStandings(playerId),
    // Profile rows only show the result and race label. Loading each race's
    // entire participant list also duplicated every participant's photo.
    prisma.raceEntry.findMany({
      where: { userId: playerId },
      select: {
        id: true,
        finishPosition: true,
        pointsAwarded: true,
        race: {
          select: {
            id: true,
            name: true,
            metricKey: true,
            status: true,
            league: { select: { name: true, level: true } },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
      take: 20,
    }),
    prisma.socialPost.findMany({
      where: { authorId: playerId },
      // The profile grid displays text/result summaries, not full feed cards.
      // Exclude photo blobs, author avatars, and comments at the database so
      // opening a profile never downloads its whole photo gallery.
      select: {
        id: true,
        body: true,
        createdAt: true,
        raceEntry: { select: { race: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 24,
    }),
  ]);

  return {
    player: serializePlayer(user),
    friendState,
    leagues,
    raceHistory,
    posts: posts.map((post) => ({
      id: post.id,
      body: post.body,
      createdAt: post.createdAt,
      raceResult: post.raceEntry,
    })),
  };
}

export async function getProfileGallery(viewerId:string,playerId:string) {
 const [posts,games]=await Promise.all([
  prisma.$queryRaw<Array<{id:string;body:string;imageUrl:string|null;createdAt:Date}>>`SELECT id, body, "createdAt", CASE WHEN "imageUrl" LIKE 'data:%' THEN NULL ELSE "imageUrl" END AS "imageUrl" FROM "SocialPost" WHERE "authorId"=${playerId} ORDER BY "createdAt" DESC LIMIT 60`,
  prisma.socialEvent.findMany({where:{status:'COMPLETED',AND:[{OR:[{hostUserId:playerId},{participants:{some:{userId:playerId,status:'JOINED'}}}]},{OR:[{visibility:'PUBLIC'},{hostUserId:viewerId},{participants:{some:{userId:viewerId,status:'JOINED'}}}]}]},select:{id:true,name:true,sportKey:true,game:true,startsAt:true},orderBy:{startsAt:'desc'},take:40}),
 ]);
 return {posts,games:games.map(event=>({id:event.id,name:event.name,sportKey:event.sportKey,summary:event.game?gameSummary(event.sportKey,event.game as unknown as Game):'',finishedAt:(event.game as unknown as Game)?.finishedAt ?? event.startsAt}))};
}
