import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import {
  acceptFriend,
  createSocialPost,
  getPlayerProfile,
  listFriends,
  listConversations,
  listPostableResults,
  listSocialFeed,
  removeFriend,
  requestFriend,
  searchPlayers,
  getConversation,
  sendMessage,
} from "./service.js";

const SearchQuery = z.object({
  q: z.string().trim().min(0).default(""),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});

const MessageBody = z.object({
  body: z.string().trim().min(1).max(500),
});

const SocialPostBody = z.object({
  body: z.string().trim().min(1).max(500),
  raceEntryId: z.string().trim().min(1).optional().nullable(),
});

export async function socialRoutes(app: FastifyInstance) {
  app.get("/social/feed", { preHandler: requireAuth }, async (req, reply) => {
    return reply.send({ posts: await listSocialFeed(req.userId) });
  });

  app.get("/social/postable-results", { preHandler: requireAuth }, async (req, reply) => {
    return reply.send({ results: await listPostableResults(req.userId) });
  });

  app.post("/social/posts", { preHandler: requireAuth }, async (req, reply) => {
    const body = SocialPostBody.parse(req.body ?? {});
    return reply.code(201).send({ post: await createSocialPost(req.userId, body) });
  });

  app.get("/players/search", { preHandler: requireAuth }, async (req, reply) => {
    const query = SearchQuery.parse(req.query);
    return reply.send({ players: await searchPlayers(req.userId, query.q, query.limit) });
  });

  app.get("/players/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await getPlayerProfile(req.userId, id));
  });

  app.get("/friends", { preHandler: requireAuth }, async (req, reply) => {
    return reply.send(await listFriends(req.userId));
  });

  app.post("/friends/:id/request", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.code(201).send(await requestFriend(req.userId, id));
  });

  app.post("/friends/:id/accept", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await acceptFriend(req.userId, id));
  });

  app.delete("/friends/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await removeFriend(req.userId, id));
  });

  app.get("/messages/conversations", { preHandler: requireAuth }, async (req, reply) => {
    return reply.send({ conversations: await listConversations(req.userId) });
  });

  app.get("/messages/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await getConversation(req.userId, id));
  });

  app.post("/messages/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = MessageBody.parse(req.body ?? {});
    return reply.code(201).send(await sendMessage(req.userId, id, body.body));
  });
}
