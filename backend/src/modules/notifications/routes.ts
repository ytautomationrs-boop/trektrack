import type { FastifyInstance } from "fastify";
import { apnsConfigured, sendApplePush } from "./apns.js";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

const RegisterPushTokenSchema = z.object({
  token: z.string().min(1).max(512).refine(value=>/^apns:[a-fA-F0-9]{64,200}$/.test(value)||/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(value),"Invalid push token"),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
});

export async function notificationRoutes(app: FastifyInstance) {
  app.post('/notifications/test', {preHandler:requireAuth,config:{rateLimit:{max:3,timeWindow:'1 minute'}}}, async(req,reply)=>{
    if(!apnsConfigured())return reply.code(503).send({error:'push_unavailable',message:'Phone notifications are not configured yet.'});
    const tokens=await prisma.pushToken.findMany({where:{userId:req.userId,token:{startsWith:'apns:'}},select:{token:true}});
    if(!tokens.length)return reply.code(400).send({error:'no_phone',message:'Enable phone notifications in ASTA on your iPhone first.'});
    const results=await Promise.allSettled(tokens.map(t=>sendApplePush(t.token.slice(5),'ASTA notification check','Your iPhone notifications are working.',{kind:'test'})));
    const accepted=results.filter(r=>r.status==='fulfilled').length;
    if(!accepted){req.log.error({reasons:results.map(r=>r.status==='rejected'?r.reason?.message:null)},'APNs test failed');return reply.code(502).send({error:'push_failed',message:'Apple did not accept the notification. Please enable phone notifications again and retry.'});}
    return {accepted};
  });
  app.get('/notifications', {preHandler:requireAuth}, async req=>{
    const [notifications,unreadCount]=await Promise.all([
      prisma.appNotification.findMany({where:{userId:req.userId},orderBy:{createdAt:'desc'},take:60}),
      prisma.appNotification.count({where:{userId:req.userId,readAt:null}}),
    ]);return {notifications,unreadCount,pushAvailable:apnsConfigured()};
  });
  app.post('/notifications/read', {preHandler:requireAuth}, async req=>{
    const {ids}=z.object({ids:z.array(z.string().min(1)).max(60)}).parse(req.body);
    await prisma.appNotification.updateMany({where:{userId:req.userId,id:{in:ids},readAt:null},data:{readAt:new Date()}});return {read:true};
  });
  /**
   * Registers (or re-registers) this device's Expo push token.
   *
   * Upsert on the token rather than create: Expo issues one token per
   * install, so the same device re-registering must move the token to the
   * current user rather than add a row. Without that, a shared or handed-on
   * device would keep delivering the previous owner's notifications — which
   * for this app means someone else's race results and payouts.
   */
  app.post("/push-tokens", { preHandler: requireAuth }, async (req, reply) => {
    const body = RegisterPushTokenSchema.parse(req.body);
    const pushToken = await prisma.pushToken.upsert({
      where: { token: body.token },
      update: { userId: req.userId, platform: body.platform },
      create: { userId: req.userId, token: body.token, platform: body.platform },
    });
    return reply.code(201).send({ registered: true, id: pushToken.id });
  });

  /** Called on logout so a signed-out device stops receiving that account's notifications. */
  app.delete("/push-tokens/:token", { preHandler: requireAuth }, async (req, reply) => {
    const { token } = req.params as { token: string };
    // Scoped to the caller's own tokens — a token string is not a secret and
    // must not let one account deregister another's device.
    await prisma.pushToken.deleteMany({ where: { token, userId: req.userId } });
    return reply.send({ registered: false });
  });
}
