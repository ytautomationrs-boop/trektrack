import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireAuth } from "../../../middleware/auth.js";
import { env } from "../../../lib/env.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  stravaConfigured,
  stravaMobileRedirectConfigured,
  stravaWebRedirectConfigured,
} from "./stravaClient.js";

const CallbackSchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

/**
 * Marks a token as an OAuth `state` rather than a session. Both are signed
 * with the same secret, and requireAuth only reads `sub` — so without a
 * discriminator a state token would work as a session token and vice versa.
 * middleware/auth.ts refuses anything carrying a purpose.
 */
const STRAVA_STATE_PURPOSE = "strava_oauth";

/** Long enough to authorise at Strava without hurrying, short enough that a leaked URL goes stale. */
const STATE_TTL = "15m";

type StravaStateClaims = { sub: string; purpose?: string };

// Optional, opt-in Strava OAuth (see schema.prisma StravaConnection doc
// comment for the architecture note on why this is a real token exchange
// rather than the phone-only permission grant HealthConnection records).
export async function stravaRoutes(app: FastifyInstance) {
  app.get("/integrations/strava/status", { preHandler: requireAuth }, async (req, reply) => {
    if (!stravaConfigured()) return reply.send({ configured: false, connected: false });
    const connection = await prisma.stravaConnection.findUnique({ where: { userId: req.userId } });
    return reply.send({
      configured: true,
      connected: connection?.status === "ACTIVE",
      athleteId: connection?.status === "ACTIVE" ? connection.stravaAthleteId : null,
      connectedAt: connection?.status === "ACTIVE" ? connection.connectedAt : null,
    });
  });

  // Mobile opens this URL in a browser (expo-web-browser's auth session);
  // the web pilot does a plain top-level redirect to it instead — either
  // way, read-only scope, never writes to Strava.
  //
  // `state` is a short-lived token signed for the requesting user, and the
  // POST callback below refuses a code that doesn't arrive with one.
  //
  // It used to be `randomBytes(8)` that was generated, sent, and thrown
  // away — never stored, never checked. That is OAuth with no CSRF
  // protection: an attacker completes an authorisation for THEIR Strava
  // account, keeps the resulting code, and gets a signed-in victim to open
  // /strava-callback?code=<theirs>. The victim's browser posts it with the
  // victim's session and the attacker's Strava account is now bound to the
  // victim's Streak account. On the web pilot Strava is the ONLY evidence
  // source, so that is control of what a victim's races score.
  //
  // ?platform=web picks the WEB_APP_URL-bound bridge; anything else (the
  // default) picks the native streak:// bridge. They're independent — a
  // deployment may only have one of the two redirect URIs registered yet.
  app.get("/integrations/strava/authorize-url", { preHandler: requireAuth }, async (req, reply) => {
    const { platform } = req.query as { platform?: string };
    if (!stravaConfigured()) {
      return reply.code(400).send({ error: "strava_not_configured", message: "Strava isn't configured on this server." });
    }
    // jti keeps two authorize calls a second apart from minting an
    // identical string; the binding that matters is sub.
    const state = app.jwt.sign(
      { sub: req.userId, purpose: STRAVA_STATE_PURPOSE, jti: randomBytes(8).toString("hex") },
      { expiresIn: STATE_TTL }
    );
    if (platform === "web") {
      if (!stravaWebRedirectConfigured()) {
        return reply.code(400).send({ error: "strava_web_not_configured", message: "Strava's web callback isn't configured on this server yet." });
      }
      return reply.send({ url: buildAuthorizeUrl(state, env.STRAVA_WEB_REDIRECT_URI!) });
    }
    if (!stravaMobileRedirectConfigured()) {
      return reply.code(400).send({ error: "strava_not_configured", message: "Strava isn't configured on this server." });
    }
    return reply.send({ url: buildAuthorizeUrl(state, env.STRAVA_REDIRECT_URI!) });
  });

  // Unauthenticated bridge — this is what STRAVA_REDIRECT_URI actually
  // points at (see .env.example / API.md "Callback domain"). Strava only
  // accepts a real http(s) redirect_uri under a registered domain, not a
  // bare custom app scheme, so it lands here first; this just 302s
  // whatever query params it got (code/state/error) straight on to the
  // app's streak:// scheme, which expo-web-browser's auth session is
  // watching for and intercepts on-device.
  app.get("/integrations/strava/mobile-callback", async (req, reply) => {
    const params = new URLSearchParams(req.query as Record<string, string>);
    return reply.redirect(`streak://strava-callback?${params.toString()}`, 302);
  });

  // Web pilot's equivalent bridge — what STRAVA_WEB_REDIRECT_URI points at.
  // A browser tab can't "intercept" a custom scheme the way expo-web-browser
  // does on-device, so this 302s onward to a REAL page on the web app's own
  // origin instead — StravaCallbackScreen there reads window.location.search
  // and finishes the connection via POST /integrations/strava/callback,
  // same as the mobile flow does after its own bridge hop.
  app.get("/integrations/strava/web-callback", async (req, reply) => {
    if (!env.WEB_APP_URL) return reply.code(500).send({ error: "web_app_url_not_configured" });
    const params = new URLSearchParams(req.query as Record<string, string>);
    return reply.redirect(`${env.WEB_APP_URL}/strava-callback?${params.toString()}`, 302);
  });

  app.post("/integrations/strava/callback", { preHandler: requireAuth }, async (req, reply) => {
    if (!stravaConfigured()) {
      return reply.code(400).send({ error: "strava_not_configured", message: "Strava isn't configured on this server." });
    }
    const body = CallbackSchema.parse(req.body);

    // The CSRF check. The code is only exchanged once we know this same
    // account is the one that asked for it — an expired, forged, or
    // someone-else's state is refused before Strava is ever called.
    let claims: StravaStateClaims;
    try {
      claims = app.jwt.verify<StravaStateClaims>(body.state);
    } catch {
      return reply.code(400).send({ error: "invalid_state", message: "That Strava link has expired. Please start again." });
    }
    if (claims.purpose !== STRAVA_STATE_PURPOSE || claims.sub !== req.userId) {
      return reply.code(400).send({ error: "invalid_state", message: "That Strava link wasn't started from this account. Please start again." });
    }

    const token = await exchangeCodeForToken(body.code);
    if (!token.athlete) return reply.code(502).send({ error: "strava_error", message: "Strava didn't return athlete info." });

    const connection = await prisma.stravaConnection.upsert({
      where: { userId: req.userId },
      update: {
        stravaAthleteId: String(token.athlete.id),
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(token.expires_at * 1000),
        status: "ACTIVE",
        revokedAt: null,
      },
      create: {
        userId: req.userId,
        stravaAthleteId: String(token.athlete.id),
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(token.expires_at * 1000),
        scope: "activity:read_all",
      },
    });
    return reply.code(201).send({ connected: true, athleteId: connection.stravaAthleteId });
  });

  app.delete("/integrations/strava", { preHandler: requireAuth }, async (req, reply) => {
    await prisma.stravaConnection.updateMany({
      where: { userId: req.userId },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    return reply.send({ connected: false });
  });
}
