import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import {
  acceptFriend,
  getPlayerProfile,
  listFriends,
  removeFriend,
  requestFriend,
  searchPlayers,
} from "./service.js";

const SearchQuery = z.object({
  q: z.string().trim().min(0).default(""),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});

export async function socialRoutes(app: FastifyInstance) {
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
}
