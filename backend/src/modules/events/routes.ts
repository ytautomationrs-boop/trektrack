import {prisma} from '../../lib/prisma.js';
import {scoreGame,scoreChoices,type Game} from './scoring.js';
import type { FastifyInstance, FastifyReply } from "fastify";
import { updateGame } from "./game.js";
import { z, ZodError } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { isMissingRuntimeSchemaError, withRuntimeSchemaRepair } from "../../lib/runtimeRepair.js";
import {
  SocialEventError,
  inviteToEvent,
  createSocialEvent,
  deleteSocialEvent,
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
  if (isMissingRuntimeSchemaError(err)) {
    return reply.code(503).send({
      error: "database_not_ready",
      message: "Events database repair did not complete. Check Hostinger runtime logs, then try again.",
    });
  }
  if (err instanceof SocialEventError) {
    const status = err.code === "not_found" ? 404 : ["event_full", "game_changed"].includes(err.code) ? 409 : 400;
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
  app.get('/social-events/watch',{preHandler:requireAuth},async(req)=>{
    const events=await prisma.socialEvent.findMany({where:{hostUserId:req.userId,status:'LIVE'},select:{id:true,name:true,status:true,sportKey:true,game:true},orderBy:{startsAt:'desc'},take:20});
    return {events:events.filter(e=>e.game).map(e=>{const {actions,operationIds,...game}=e.game as Game;return {...e,game,score:scoreGame(e.sportKey,e.game as Game),choices:scoreChoices(e.sportKey)};})};
  });
  app.post("/social-events/:id/game", {preHandler:requireAuth}, async(req,reply)=>{
    try {
      const {id}=req.params as {id:string};
      const body=z.object({action:z.enum(['start','score','undo','pause','resume','finish']),operationId:z.string().min(8).max(80),version:z.number().int().nonnegative(),side:z.union([z.literal(0),z.literal(1)]).optional(),value:z.number().int().optional(),teams:z.tuple([z.string().trim().min(1).max(32),z.string().trim().min(1).max(32)]).optional(),bestOf:z.union([z.literal(1),z.literal(3),z.literal(5)]).optional()}).parse(req.body);
      return await updateGame(id,req.userId,body);
    } catch(error) {return sendEventError(reply,error);}
  });
  app.post('/social-events/:id/invite',{preHandler:requireAuth},async(req,reply)=>{
    try {const {id}=req.params as {id:string};const {playerId}=z.object({playerId:z.string().min(1)}).parse(req.body);return await inviteToEvent(id,req.userId,playerId);} catch(error){return sendEventError(reply,error);}
  });
  app.get("/social-events/sports", { preHandler: requireAuth }, async (_req, reply) => {
    return reply.send({ sports: listSocialSports() });
  });

  app.get("/social-events", { preHandler: requireAuth }, async (req, reply) => {
    try {
      return reply.send({ events: await withRuntimeSchemaRepair("list social events", () => listSocialEvents(req.userId, (req.query as {joinedOnly?:string}).joinedOnly === "true")) });
    } catch (err) {
      return sendEventError(reply, err);
    }
  });

  app.post("/social-events", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const body = CreateSocialEventSchema.parse(req.body ?? {});
      return reply.code(201).send({
        event: await withRuntimeSchemaRepair("create social event", () =>
          createSocialEvent({
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
        ),
      });
    } catch (err) {
      return sendEventError(reply, err);
    }
  });

  app.get("/social-events/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const query = EventQuerySchema.parse(req.query);
      return reply.send({ event: await withRuntimeSchemaRepair("get social event", () => getSocialEvent(id, req.userId, query.code)) });
    } catch (err) {
      return sendEventError(reply, err);
    }
  });

  app.post("/social-events/:id/join", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = JoinSocialEventSchema.parse(req.body ?? {});
      return reply.send({ event: await withRuntimeSchemaRepair("join social event", () => joinSocialEvent(id, req.userId, body.inviteCode)) });
    } catch (err) {
      return sendEventError(reply, err);
    }
  });

  app.post("/social-events/:id/leave", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send({ event: await withRuntimeSchemaRepair("leave social event", () => leaveSocialEvent(id, req.userId)) });
    } catch (err) {
      return sendEventError(reply, err);
    }
  });

  app.delete("/social-events/:id", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const deleted = await withRuntimeSchemaRepair("delete social event", () => deleteSocialEvent(id, req.userId));
      return reply.send({ deleted: true, eventId: deleted.id });
    } catch (err) {
      return sendEventError(reply, err);
    }
  });
}
