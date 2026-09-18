import type { FastifyReply, FastifyRequest } from "fastify";
import { ensureEffectiveAdmin } from "../lib/adminAccess.js";
import { prisma } from "../lib/prisma.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  let payload: { sub: string; purpose?: string };
  try {
    payload = await req.jwtVerify<{ sub: string; purpose?: string }>();
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }

  // Session tokens carry no `purpose`. Other short-lived tokens signed with
  // the same secret do — currently the Strava OAuth `state` — and must not
  // be usable as a session just because they happen to carry a `sub`.
  if (payload.purpose) {
    return reply.code(401).send({ error: "unauthorized" });
  }

  // A valid signature is not proof the account still exists. Tokens are
  // long-lived, so one outlives a deleted account for weeks — and every
  // route below assumes req.userId names a real row. Without this check the
  // handlers dereference a user that isn't there and the caller gets a 500
  // (or a 404 from whichever findUniqueOrThrow ran first) on every request,
  // forever, instead of simply being signed out.
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true } });
  if (!user) {
    return reply.code(401).send({ error: "unauthorized", message: "That account no longer exists. Please sign in again." });
  }

  req.userId = user.id;
}

/**
 * Pilot-only content-creation gate — chain AFTER requireAuth (needs
 * req.userId already set). Everyone can still enter races / join
 * challenges; this only blocks the CREATE side for non-admin accounts
 * while the app is invite-only. Drop this once public creation reopens.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, email: true, isAdmin: true } });
  if (!user || !(await ensureEffectiveAdmin(user))) {
    reply.code(403).send({
      error: "admin_only",
      message: "TrackTrek is invite-only right now — only the team can create competitions during the pilot.",
    });
  }
}
