import type { FastifyInstance, FastifyReply } from "fastify";
import { z, ZodError } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import {
  SocialEventError,
  createSocialEvent,
  getSocialEvent,
  joinSocialEvent,
  leaveSocialEvent,
  listSocialEvents,
  listSocialSports,
} from "./service.js";

const CreateSocialEventSchema = z.object({
  name: z.string().trim().min(2).max(80),
  sportKey: z.string().trim().min(2).max(40),
  customSportName: z.string().trim().max(50).optional(),
  description: z.string().trim().max(240).optional(),
  location: z.string().trim().max(120).optional(),
  startsAt: z.coerce.date(),
  maxPlayers: z.coerce.number().int().min(2).max(100),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
});

const JoinSocialEventSchema = z.object({
  inviteCode: z.string().trim().min(4).max(32).optional(),
});

const EventQuerySchema = z.object({
  code: z.string().trim().min(4).max(32).optional(),
});

function sendEventError(reply: FastifyReply, err: unknown) {
  if (err && typeof err === "object" && "code" in err && ((err as any).code === "P2021" || (err as any).code === "P2022")) {
    return reply.code(503).send({
      error: "database_not_ready",
      message: "Events need the latest database migration. Redeploy with startup database maintenance enabled, then try again.",
    });
  }
  if (err instanceof SocialEventError) {
    const status = err.code === "not_found" ? 404 : err.code === "event_full" ? 409 : 400;
    return reply.code(status).send({ error: err.code, message: err.message });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path?.length ? first.path.join(".") : null;
    const message = first ? (field ? `${field}: ${first.message}` : first.message) : "Invalid request.";
    return reply.code(400).send({ error: "validation_error", message, issues: err.issues });
  }
  throw err;
}

export async function socialEventRoutes(app: FastifyInstance) {
  app.get("/social-events/sports", { preHandler: requireAuth }, async (_req, reply) => {
    return reply.send({ sports: listSocialSports() });
  });

  app.get("/social-events", { preHandler: requireAuth }, async (req, reply) => {
    try {
      return reply.send({ events: await listSocialEvents(req.userId) });
    } catch (err) {
      return sendEventError(reply, err);
    }
  });

  app.post("/social-events", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const body = CreateSocialEventSchema.parse(req.body ?? {});
      return reply.code(201).send({
        event: await createSocialEvent({
          hostUserId: req.userId,
          name: body.name,
          sportKey: body.sportKey,
          customSportName: body.customSportName,
          description: body.description,
          location: body.location,
          startsAt: body.startsAt,
          maxPlayers: body.maxPlayers,
          visibility: body.visibility,
        }),
      });
    } catch (err) {
      return sendEventError(reply, err);
    }
  });

  app.get("/social-events/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const query = EventQuerySchema.parse(req.query);
      return reply.send({ event: await getSocialEvent(id, req.userId, query.code) });
    } catch (err) {
      return sendEventError(reply, err);
    }
  });

  app.post("/social-events/:id/join", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = JoinSocialEventSchema.parse(req.body ?? {});
      return reply.send({ event: await joinSocialEvent(id, req.userId, body.inviteCode) });
    } catch (err) {
      return sendEventError(reply, err);
    }
  });

  app.post("/social-events/:id/leave", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send({ event: await leaveSocialEvent(id, req.userId) });
    } catch (err) {
      return sendEventError(reply, err);
    }
  });
}
