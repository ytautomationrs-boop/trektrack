import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ensureEffectiveAdmin, isBootstrapAdminEmail } from "../../lib/adminAccess.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import { GenerateInviteCodesSchema, LoginSchema, SignUpSchema } from "./schemas.js";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const hashBuf = Buffer.from(hash, "hex");
  return derived.length === hashBuf.length && timingSafeEqual(derived, hashBuf);
}

class AuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function sendAuthError(reply: FastifyReply, err: unknown) {
  if (err instanceof AuthError) {
    return reply.code(err.code === "invalid_invite_code" ? 403 : 400).send({ error: err.code, message: err.message });
  }
  throw err;
}

/**
 * Auth endpoints are the ones actually worth attacking, so they get a far
 * stricter limit than the global one:
 *
 *  - login guards real wallet balances;
 *  - signup guards the invite gate, and is the only place an invite code can
 *    be tested. The codes have enough entropy (5 random bytes) that guessing
 *    isn't realistic anyway, but an unthrottled endpoint that reports
 *    "valid / not valid" is exactly the shape you'd want for an oracle.
 *
 * Keyed on IP rather than the global limiter's authorization-header default —
 * an attacker on these routes has no token, so every attempt would otherwise
 * share the one anonymous bucket.
 */
const AUTH_RATE_LIMIT = {
  rateLimit: {
    max: 10,
    timeWindow: "1 minute",
    keyGenerator: (req: { ip: string }) => req.ip,
  },
};

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/signup", { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const body = SignUpSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.code(409).send({ error: "email_in_use", message: "An account with that email already exists — log in instead." });

    // No payment-provider call here on purpose: account creation shouldn't
    // depend on a third-party payment processor being reachable/configured.
    // This means signup/login/browsing/joining all work with no Paystack
    // keys at all — only depositing money does (see modules/wallet).
    const passwordHash = await hashPassword(body.password);

    try {
      const user = await prisma.$transaction(async (tx) => {
        // Pilot invite gate: there is no public signup — this must resolve
        // to an unrevoked code with capacity left, or signup fails outright.
        const invite = await tx.inviteCode.findUnique({ where: { code: body.inviteCode.trim() } });
        if (!invite || invite.revokedAt || invite.useCount >= invite.maxUses) {
          throw new AuthError("invalid_invite_code", "That invite code isn't valid or has already been used up.");
        }

        const created = await tx.user.create({
          data: {
            email: body.email,
            passwordHash,
            displayName: body.displayName,
            timezone: body.timezone,
            isAdmin: isBootstrapAdminEmail(body.email),
          },
        });

        // Optimistic concurrency guard: the WHERE clause re-checks useCount
        // against the value we just read, so two simultaneous signups
        // racing the last remaining use can't both succeed.
        const redeemed = await tx.inviteCode.updateMany({
          where: { id: invite.id, useCount: invite.useCount },
          data: { useCount: { increment: 1 }, usedByUserIds: { push: created.id } },
        });
        if (redeemed.count === 0) {
          throw new AuthError("invalid_invite_code", "That invite code was just used up — ask for a new one.");
        }

        return created;
      });

      const token = app.jwt.sign({ sub: user.id }, { expiresIn: "30d" });
      const isAdmin = await ensureEffectiveAdmin(user);
      return reply.code(201).send({
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          walletBalanceCents: user.walletBalanceCents,
          isAdmin,
        },
      });
    } catch (err) {
      return sendAuthError(reply, err);
    }
  });

  app.post("/auth/login", { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const token = app.jwt.sign({ sub: user.id }, { expiresIn: "30d" });
    const isAdmin = await ensureEffectiveAdmin(user);
    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        walletBalanceCents: user.walletBalanceCents,
        isAdmin,
      },
    });
  });

  // Session restore — mobile calls this on launch with whatever JWT is in
  // SecureStore so a reload doesn't force a re-login (the JWT itself is
  // opaque to the client beyond "present or not").
  app.get("/me", { preHandler: requireAuth }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, displayName: true, avatarUrl: true, walletBalanceCents: true, isAdmin: true },
    });
    if (!user) return reply.code(404).send({ error: "not_found" });
    const isAdmin = await ensureEffectiveAdmin(user);
    return reply.send({ user: { ...user, isAdmin } });
  });

  // ── Pilot invite-code administration ──────────────────────────────────
  // Deliberately minimal REST endpoints rather than a full admin panel —
  // callable directly (curl/Postman), and backing the in-app console at
  // mobile/src/screens/admin/AdminScreen.tsx.

  app.post("/admin/invite-codes", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const body = GenerateInviteCodesSchema.parse(req.body ?? {});
    if (body.code && body.count !== 1) {
      return reply.code(400).send({ error: "custom_code_count", message: "Create one custom invite code at a time." });
    }
    try {
      const codes = await prisma.$transaction(
        Array.from({ length: body.count }, () =>
          prisma.inviteCode.create({
            data: { code: (body.code ?? randomBytes(5).toString("hex")).trim().toLowerCase(), label: body.label, maxUses: 1, createdByUserId: req.userId },
          })
        )
      );
      return reply.code(201).send({ codes });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "invite_code_exists", message: "That invite code already exists. Try a different one." });
      }
      throw err;
    }
  });

  app.get("/admin/overview", { preHandler: [requireAuth, requireAdmin] }, async (_req, reply) => {
    const [
      totalUsers,
      wallet,
      raceCounts,
      challengeCounts,
      pendingWithdrawals,
      openReports,
      recentUsers,
      recentLedger,
    ] = await Promise.all([
      prisma.user.count({ where: { email: { not: "platform@streak.demo" } } }),
      prisma.user.aggregate({ where: { email: { not: "platform@streak.demo" } }, _sum: { walletBalanceCents: true } }),
      prisma.race.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.challenge.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.withdrawal.count({ where: { status: "PENDING" } }),
      prisma.report.count({ where: { status: "OPEN" } }),
      prisma.user.findMany({
        where: { email: { not: "platform@streak.demo" } },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          email: true,
          displayName: true,
          isAdmin: true,
          walletBalanceCents: true,
          createdAt: true,
          _count: { select: { raceEntries: true, challengeParticipations: true, withdrawals: true, depositIntents: true } },
        },
      }),
      prisma.ledgerEntry.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          userId: true,
          type: true,
          status: true,
          amountCents: true,
          createdAt: true,
          user: { select: { displayName: true, email: true } },
        },
      }),
    ]);

    return reply.send({
      stats: {
        totalUsers,
        activeNow: 0,
        activeToday: 0,
        userWalletBalanceCents: wallet._sum.walletBalanceCents ?? 0,
        pendingWithdrawals,
        openReports,
        racesByStatus: Object.fromEntries(raceCounts.map((row) => [row.status, row._count._all])),
        challengesByStatus: Object.fromEntries(challengeCounts.map((row) => [row.status, row._count._all])),
      },
      users: recentUsers.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        isAdmin: u.isAdmin,
        walletBalanceCents: u.walletBalanceCents,
        createdAt: u.createdAt,
        lastSeenAt: null,
        counts: {
          races: u._count.raceEntries,
          challenges: u._count.challengeParticipations,
          withdrawals: u._count.withdrawals,
          deposits: u._count.depositIntents,
        },
      })),
      ledger: recentLedger,
    });
  });

  app.get("/admin/invite-codes", { preHandler: [requireAuth, requireAdmin] }, async (_req, reply) => {
    const codes = await prisma.inviteCode.findMany({ orderBy: { createdAt: "desc" } });
    return reply.send({ codes });
  });

  app.post("/admin/invite-codes/:id/revoke", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const code = await prisma.inviteCode.update({ where: { id }, data: { revokedAt: new Date() } });
    return reply.send({ code });
  });
}
