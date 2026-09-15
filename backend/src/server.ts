import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ZodError } from "zod";
import { env } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";
import { authRoutes } from "./modules/auth/routes.js";
import { accountRoutes } from "./modules/account/routes.js";
import { anomalyRoutes } from "./modules/anomaly/routes.js";
import { metricTypeRoutes } from "./modules/metricTypes/routes.js";
import { deviceRoutes } from "./modules/devices/routes.js";
import { stravaRoutes } from "./modules/integrations/strava/routes.js";
import { walletRoutes } from "./modules/wallet/routes.js";
import { raceRoutes } from "./modules/races/routes.js";
import { challengeRoutes } from "./modules/challenges/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { startScheduler } from "./jobs/scheduler.js";

/**
 * The rate-limit bucket for one request: the authenticated user when the
 * bearer token actually verifies, otherwise the client IP.
 *
 * Anything the caller can vary at will is unusable as a key, which is why
 * this verifies rather than trusting the header's presence. Tokens carrying
 * a `purpose` (currently the Strava OAuth `state` — see
 * modules/integrations/strava/routes.ts) are not sessions and are treated
 * the same as no token at all.
 */
export type RouteRecord = { method: string; url: string };

declare module "fastify" {
  interface FastifyInstance {
    routeTable: RouteRecord[];
  }
}

export type TokenVerifier = { verify: <T>(token: string) => T };

export function rateLimitKey(jwtVerifier: TokenVerifier, authorization: string | undefined, ip: string): string {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token) return ip;
  try {
    const claims = jwtVerifier.verify<{ sub?: string; purpose?: string }>(token);
    if (claims.purpose || !claims.sub) return ip;
    return `user:${claims.sub}`;
  } catch {
    // Expired, forged, or malformed — not an identity.
    return ip;
  }
}

export async function buildServer() {
  const app = Fastify({
    logger: true,
    // Behind a production hosting proxy, req.ip is the proxy's address unless
    // we trust forwarded headers, which would make every request look like it
    // came from one client and turn the rate limiter below into an
    // application-wide shared quota. Only trusted in production: honouring
    // X-Forwarded-For when not behind a proxy would let anyone spoof their
    // own IP and sidestep the limiter entirely.
    trustProxy: env.NODE_ENV === "production",
  });

  // Every route the server registers, in registration order.
  //
  // Exists for the admin-guard sweep in scripts/smoke-races.ts, which has to
  // be able to assert that EVERY /admin route rejects a non-admin — a claim
  // that is only worth anything if the list cannot drift from reality.
  //
  // printRoutes() is not usable for that: it renders a tree, so a child like
  // /admin/withdrawals/:id/mark-paid prints as the bare suffix "/:id/mark-paid"
  // under its parent. Three admin routes were invisible to a text parse of it.
  // onRoute fires once per route with the full url and cannot miss one.
  const routeTable: RouteRecord[] = [];
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) routeTable.push({ method, url: route.url });
  });
  app.decorate("routeTable", routeTable);

  await app.register(cors, { origin: true });

  // Workout-file uploads (GPX/TCX/FIT) — see modules/imports/workoutFile.ts.
  //
  // 8MB covers a long ride recorded at one point per second with room to
  // spare, and is small enough that a hostile upload can't exhaust memory.
  // One file per request, because one request scores one activity.
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 4 },
  });
  await app.register(jwt, { secret: env.JWT_SECRET });

  /**
   * Global rate limit. Generous enough that normal use never notices —
   * the race and challenge detail screens poll every 15s, and a browsing
   * session fans out into several parallel calls per screen.
   *
   * The auth routes get a much stricter limit of their own (see
   * modules/auth/routes.ts): those are the ones worth brute-forcing, since
   * signup is gated by an invite code and login guards real wallet balances.
   */
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    // Authenticated requests key on the user, so several people behind one
    // office NAT or mobile carrier CGNAT don't consume each other's quota.
    // Falling back to IP is only for unauthenticated traffic.
    //
    // The subject has to come from a VERIFIED token. Keying on the raw
    // Authorization header — which is what this did — meant the client chose
    // its own bucket: send a different random string each time and every
    // request lands in a fresh one, so the limit never applies to anybody
    // willing to send `Authorization: Bearer <junk>`. Demonstrated against
    // this server with the IP bucket already exhausted: 200 of 200 rotating
    // -header requests returned 200 while unheadered ones were being 429'd.
    //
    // Verifying is an HMAC check with no database hit. A token that doesn't
    // verify is not an identity, so it falls through to the IP — and every
    // token a real user holds shares one bucket, rather than each login
    // minting extra quota.
    keyGenerator: (req) => rateLimitKey(app.jwt, req.headers.authorization, req.ip),
    // Loopback is exempt OUTSIDE production only. The smoke suite signs up
    // ~800 users from localhost in a single run, which the strict auth limit
    // would (correctly) block — so rather than weakening the real limit to
    // suit the tests, the tests are exempted and the limit stays honest.
    // Never exempt in production: on a single-service deploy the app itself
    // is reachable over loopback.
    allowList: env.NODE_ENV === "production" ? [] : ["127.0.0.1", "::1"],
    // This object is THROWN by the plugin, so it lands in setErrorHandler
    // below rather than being sent directly — which means it has to be
    // shaped the way that handler reads an error, not the way the response
    // should look. Specifically it needs `statusCode` (or the handler
    // defaults to 500) and `code` (which the handler emits as `error`).
    // Returning the bare response body here produced a 500 "internal_error"
    // and this message never reached anyone.
    errorResponseBuilder: () => ({
      statusCode: 429,
      code: "rate_limited",
      error: "rate_limited",
      message: "Too many requests — give it a moment and try again.",
    }),
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      // Every mobile-facing error surfaces via `body.message` (see
      // api/client.ts request()) — without one here, every validation
      // failure app-wide (empty login field, an out-of-range stake, a bad
      // metric key, ...) fell back to an unhelpful generic "Request
      // failed: 400" with no indication of what was actually wrong.
      const first = err.issues[0];
      const field = first?.path?.length ? first.path.join(".") : null;
      const message = first ? (field ? `${field}: ${first.message}` : first.message) : "Invalid request.";
      return reply.code(400).send({ error: "validation_error", message, issues: err.issues });
    }
    // A Fastify-native error (bad JSON, empty body with a JSON content-type,
    // an unsupported method, ...) already carries the correct HTTP status —
    // discarding it and always answering 500 turned a client mistake like
    // "Content-Type: application/json" with no body into a misleading
    // "internal_error" instead of the 400 it actually was.
    const status = typeof (err as { statusCode?: number }).statusCode === "number" ? (err as { statusCode: number }).statusCode : 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: (err as { code?: string }).code ?? "bad_request", message: err.message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/health", async () => ({ ok: true, mode: "paystack_test" as const }));

  /**
   * Public client config. Unauthenticated on purpose — the support address
   * and legal links are things someone needs to be able to reach BEFORE
   * they have an account, and none of it is sensitive.
   *
   * Served at runtime rather than inlined into the web bundle: these are the
   * values most likely to change without a code change, and EXPO_PUBLIC_*
   * variables are baked in at build time (see mobile/src/api/config.ts for
   * where that bit us once already).
   */
  app.get("/config", async () => ({
    supportEmail: env.SUPPORT_EMAIL ?? null,
    termsUrl: env.TERMS_URL ?? null,
    privacyUrl: env.PRIVACY_URL ?? null,
    // The money model, so the client can render the right wallet rather
    // than offering actions the server will refuse. Served here rather than
    // built into the bundle for the same reason as the links above: this is
    // exactly the sort of thing that changes without a code change, and the
    // pilot ends by flipping these rather than by shipping a new build.
    depositsEnabled: env.DEPOSITS_ENABLED,
    automatedPayoutsEnabled: env.AUTOMATED_PAYOUTS_ENABLED,
  }));

  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(anomalyRoutes);
  await app.register(metricTypeRoutes);
  await app.register(deviceRoutes);
  await app.register(stravaRoutes);
  await app.register(walletRoutes);
  await app.register(raceRoutes);
  await app.register(challengeRoutes);
  await app.register(notificationRoutes);

  await registerWebApp(app);

  return app;
}

/**
 * Serves the exported web pilot (mobile/dist, copied to backend/public at
 * build time — see scripts/build-web.sh) from this same server.
 *
 * One service rather than two on purpose, for the pilot:
 *  - one domain to register as Strava's Authorization Callback Domain and
 *    as Paystack's callback host, instead of coordinating two;
 *  - no cross-origin surface at all, so EXPO_PUBLIC_API_URL can be empty
 *    and the client just uses same-origin relative paths;
 *  - the SPA fallback below is explicit and testable here, rather than
 *    depending on a host's static-site routing config. That fallback is
 *    load-bearing: Paystack and Strava both redirect the browser to
 *    /paystack-callback and /strava-callback as FRESH navigations, and if
 *    those 404 instead of serving index.html, both integrations break at
 *    the last step.
 *
 * Absent a build (local API-only dev), this no-ops so `npm run dev` keeps
 * working exactly as before.
 */
async function registerWebApp(app: FastifyInstance) {
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
  if (!existsSync(join(publicDir, "index.html"))) {
    app.log.info({ publicDir }, "no web build found — running API-only");
    return;
  }

  await app.register(fastifyStatic, { root: publicDir });

  app.setNotFoundHandler((req, reply) => {
    // Never swallow a genuinely missing API route into the SPA — that turns
    // a clear 404 into a confusing wall of HTML in a fetch() response.
    if (!["GET", "HEAD"].includes(req.method) || req.headers.accept?.includes("application/json")) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });

  app.log.info({ publicDir }, "serving web build");
}

// A plain `file://${process.argv[1]}` string comparison breaks on Windows
// (backslash path separators, drive-letter casing) and silently skips the
// listen() call with no error — pathToFileURL normalizes both sides the
// same way regardless of platform.
export async function startProductionServer() {
  await prisma.$connect();
  const app = await buildServer();
  if (env.RUN_BACKGROUND_JOBS) {
    startScheduler();
  } else {
    app.log.info("background jobs disabled");
  }
  app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startProductionServer();
}
