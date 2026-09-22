import type { FastifyInstance, FastifyReply } from "fastify";
import { z, ZodError } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { isMissingRuntimeSchemaError, withRuntimeSchemaRepair } from "../../lib/runtimeRepair.js";
import {
  acceptFriend,
  createSocialPostComment,
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
  setSocialPostLike,
  shareSocialPost,
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

const CommentBody = z.object({
  body: z.string().trim().min(1).max(240),
});

const SharePostBody = z.object({
  recipientId: z.string().trim().min(1).optional().nullable(),
});

function sendSocialError(reply: FastifyReply, err: unknown) {
  if (isMissingRuntimeSchemaError(err)) {
    return reply.code(503).send({
      error: "database_not_ready",
      message: "Social database repair did not complete. Check Hostinger runtime logs, then try again.",
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
      return reply.send({ posts: await withRuntimeSchemaRepair("social feed", () => listSocialFeed(req.userId)) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/social/postable-results", { preHandler: requireAuth }, async (req, reply) => {
    try {
      return reply.send({ results: await withRuntimeSchemaRepair("social postable results", () => listPostableResults(req.userId)) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.post("/social/posts", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const body = SocialPostBody.parse(req.body ?? {});
      return reply.code(201).send({ post: await withRuntimeSchemaRepair("create social post", () => createSocialPost(req.userId, body)) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.post("/social/posts/:id/like", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send({ post: await withRuntimeSchemaRepair("like social post", () => setSocialPostLike(req.userId, id, true)) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.delete("/social/posts/:id/like", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send({ post: await withRuntimeSchemaRepair("unlike social post", () => setSocialPostLike(req.userId, id, false)) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.post("/social/posts/:id/comments", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = CommentBody.parse(req.body ?? {});
      return reply.code(201).send({ post: await withRuntimeSchemaRepair("comment on social post", () => createSocialPostComment(req.userId, id, body.body)) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.post("/social/posts/:id/share", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = SharePostBody.parse(req.body ?? {});
      return reply.code(201).send({ post: await withRuntimeSchemaRepair("share social post", () => shareSocialPost(req.userId, id, body.recipientId)) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/players/search", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const query = SearchQuery.parse(req.query);
      return reply.send({ players: await withRuntimeSchemaRepair("player search", () => searchPlayers(req.userId, query.q, query.limit)) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/players/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(await withRuntimeSchemaRepair("player profile", () => getPlayerProfile(req.userId, id)));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/friends", { preHandler: requireAuth }, async (req, reply) => {
    try {
      return reply.send(await withRuntimeSchemaRepair("list friends", () => listFriends(req.userId)));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.post("/friends/:id/request", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.code(201).send(await withRuntimeSchemaRepair("request friend", () => requestFriend(req.userId, id)));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.post("/friends/:id/accept", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(await withRuntimeSchemaRepair("accept friend", () => acceptFriend(req.userId, id)));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.delete("/friends/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(await withRuntimeSchemaRepair("remove friend", () => removeFriend(req.userId, id)));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/messages/conversations", { preHandler: requireAuth }, async (req, reply) => {
    try {
      return reply.send({ conversations: await withRuntimeSchemaRepair("list conversations", () => listConversations(req.userId)) });
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.get("/messages/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send(await withRuntimeSchemaRepair("get conversation", () => getConversation(req.userId, id)));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });

  app.post("/messages/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = MessageBody.parse(req.body ?? {});
      return reply.code(201).send(await withRuntimeSchemaRepair("send message", () => sendMessage(req.userId, id, body.body)));
    } catch (err) {
      return sendSocialError(reply, err);
    }
  });
}
