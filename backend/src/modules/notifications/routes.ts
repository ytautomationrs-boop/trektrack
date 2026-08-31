import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

const RegisterPushTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
});

export async function notificationRoutes(app: FastifyInstance) {
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
