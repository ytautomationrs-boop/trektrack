import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { RegisterDeviceSchema, RegisterHealthConnectionSchema } from "./schemas.js";

// Device attestation (spec 3e) + health-provider connection bookkeeping
// (spec 5 onboarding flow). A device that fails attestation is still
// recorded — its samples get rejected downstream by relying on
// attestationStatus rather than silently dropping the device row, so it
// shows up for anti-fraud review.
export async function deviceRoutes(app: FastifyInstance) {
  app.post("/devices", { preHandler: requireAuth }, async (req, reply) => {
    const body = RegisterDeviceSchema.parse(req.body);
    const device = await prisma.device.create({
      data: {
        userId: req.userId,
        platform: body.platform,
        deviceModel: body.deviceModel,
        osVersion: body.osVersion,
        attestationProvider: body.attestationProvider,
        attestationStatus: body.passed ? "VERIFIED" : "FAILED",
        lastAttestedAt: new Date(),
        isEmulatorSuspected: body.isEmulatorSuspected,
        isJailbrokenOrRooted: body.isJailbrokenOrRooted,
      },
    });
    return reply.code(201).send(device);
  });

  app.post("/health-connections", { preHandler: requireAuth }, async (req, reply) => {
    const body = RegisterHealthConnectionSchema.parse(req.body);
    const connection = await prisma.healthConnection.upsert({
      where: { userId_provider: { userId: req.userId, provider: body.provider } },
      update: { grantedScopes: body.grantedScopes, status: "ACTIVE", revokedAt: null },
      create: { userId: req.userId, provider: body.provider, grantedScopes: body.grantedScopes },
    });
    return reply.code(201).send(connection);
  });

  // Permission revoked mid-race — mobile calls
  // this when it detects HealthKit/Health Connect access was pulled so the
  // participant's next missed cutoff reads as a real SYNC_ISSUE rather than
  // a silent failure with no explanation in the UI.
  app.post("/health-connections/:provider/revoke", { preHandler: requireAuth }, async (req, reply) => {
    const { provider } = req.params as { provider: "HEALTHKIT" | "HEALTH_CONNECT" };
    await prisma.healthConnection.updateMany({
      where: { userId: req.userId, provider },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    return reply.send({ ok: true });
  });
}
