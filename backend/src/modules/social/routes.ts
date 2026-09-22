import type { FastifyInstance, FastifyReply } from "fastify";
import { z, ZodError } from "zod";
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

function sendSocialError(reply: FastifyReply, err: unknown) {
  if (err && typeof err === "object" && "code" in err && ((err as any).code === "P2021" || (err as any).code === "P2022")) {
    return reply.code(503).send({
      error: "database_not_ready",
      message: "Social features need the latest database migration. Redeploy, then try again.",
    });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path?.length ? first.path.join(".") : null;
    const message = first ? (field ? `${field}: ${first.message}` : first.message) : "Invalid request.";
    return reply.code(400).send({ error: "validation_error", message, issues: err.issues });
  }
  if (err && typeof err === "object" && "statusCode" in err) {
    const socialError = err as { statusCode?: number; code?: string; message?: string };
    const statusCode = socialError.statusCode ?? 400;
    return reply.code(statusCode).send({ error: socialError.code ?? "social_error", message: socialError.message ?? "Social request failed." });
  }
  throw err;
}

export async function socialRoutes(app: FastifyInstance) {
  app.get("/social/feed", { preHandler: requireAuth }, async (req, reply) => {
    try {
      return reply.send({ posts: await listSocialFeed(req.userId) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/social/postable-results", { preHandler: requireAuth }, async (req, reply) => {
    try {
      return reply.send({ results: await listPostableResults(req.userId) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.post("/social/posts", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const body = SocialPostBody.parse(req.body ?? {});
      return reply.code(201).send({ post: await createSocialPost(req.userId, body) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/players/search", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const query = SearchQuery.parse(req.query);
      return reply.send({ players: await searchPlayers(req.userId, query.q, query.limit) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/players/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(await getPlayerProfile(req.userId, id));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/friends", { preHandler: requireAuth }, async (req, reply) => {
    try {
      return reply.send(await listFriends(req.userId));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.post("/friends/:id/request", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.code(201).send(await requestFriend(req.userId, id));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.post("/friends/:id/accept", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(await acceptFriend(req.userId, id));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.delete("/friends/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(await removeFriend(req.userId, id));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/messages/conversations", { preHandler: requireAuth }, async (req, reply) => {
    try {
      return reply.send({ conversations: await listConversations(req.userId) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/messages/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(await getConversation(req.userId, id));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.post("/messages/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = MessageBody.parse(req.body ?? {});
      return reply.code(201).send(await sendMessage(req.userId, id, body.body));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });
}
