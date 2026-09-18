import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}, z.string().optional());

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  // Wallet deposits (see modules/wallet/paystackService.ts) — Paystack TEST
  // MODE only, same demo-only guardrail Stripe used to have. Live keys
  // start with sk_live_/pk_live_ instead of sk_test_/pk_test_.
  PAYSTACK_SECRET_KEY: optionalNonEmptyString.pipe(z.string().startsWith("sk_test_", {
    message: "PAYSTACK_SECRET_KEY must be a Paystack TEST key (sk_test_...) — this app is demo-only, never point it at live keys.",
  }).optional()),
  PAYSTACK_PUBLIC_KEY: optionalNonEmptyString.pipe(z.string().startsWith("pk_test_", {
    message: "PAYSTACK_PUBLIC_KEY must be a Paystack TEST key (pk_test_...) — this app is demo-only, never point it at live keys.",
  }).optional()),
  // Wallet withdrawals (see modules/wallet/paypalService.ts) — PayPal
  // sandbox only, same demo-only posture as the Paystack keys above.
  // Required (not optional like Strava) since withdrawal is a core wallet
  // feature, not an opt-in add-on.
  PAYPAL_SANDBOX_CLIENT_ID: optionalNonEmptyString,
  PAYPAL_SANDBOX_SECRET: optionalNonEmptyString,
  EXPO_ACCESS_TOKEN: z.string().optional(),
  // Optional (feature: Strava integration) — the app must keep working for
  // cycling/running with HealthKit/Health Connect alone if these aren't
  // set. Register a free app at https://developers.strava.com to get these.
  STRAVA_CLIENT_ID: z.string().optional(),
  STRAVA_CLIENT_SECRET: z.string().optional(),
  // Mobile: bridges through /integrations/strava/mobile-callback to the
  // streak:// custom scheme (see stravaClient.ts / routes.ts).
  STRAVA_REDIRECT_URI: z.string().optional(),
  // Web pilot: bridges through /integrations/strava/web-callback, which
  // 302s onward to WEB_APP_URL + /strava-callback — a real page the web
  // build can read window.location.search from, since a browser tab can't
  // "intercept" a custom scheme the way expo-web-browser does natively.
  STRAVA_WEB_REDIRECT_URI: z.string().optional(),
  WEB_APP_URL: z.string().optional(),
  // Comma-separated permanent bootstrap admins. These emails are treated as
  // admins even if a production database restore loses the User.isAdmin flag.
  ADMIN_EMAILS: z.string().optional(),
  // Surfaced to the client via GET /config. Deliberately served at runtime
  // rather than inlined into the web bundle at build time: these are exactly
  // the values most likely to change without a code change, and a stale
  // support address baked into a bundle is a real support failure.
  //
  // A real-money pilot needs all three before inviting anyone. The client
  // hides whatever is unset rather than showing a dead link.
  SUPPORT_EMAIL: z.string().optional(),
  TERMS_URL: z.string().optional(),
  PRIVACY_URL: z.string().optional(),
  // ── Pilot money model ───────────────────────────────────────────────
  //
  // The first ~50 users are sponsored by the platform rather than paying in,
  // so nobody deposits. Deposits stay OFF by default: leaving a Paystack
  // checkout reachable during a sponsored pilot means someone can put their
  // own money in, which is the one thing this pilot is meant not to involve.
  //
  // None of the deposit code is deleted — Paystack initialize, verify, the
  // callback bridge and the reconciliation job are all intact and tested,
  // and flipping this to "true" turns them back on.
  DEPOSITS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Payouts are done by hand during the pilot — the user requests, an admin
  // is notified, the money goes out as an EFT, and the admin marks it paid.
  // With automated payouts off, no Paystack Transfer or PayPal Payout call
  // is ever made, so live payout credentials aren't needed to run the pilot.
  AUTOMATED_PAYOUTS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Hostinger's Node.js Web App process should serve HTTP first. Background
  // cron work is opt-in so timers and long-running Prisma queries cannot
  // destabilize the web process on shared hosting.
  RUN_BACKGROUND_JOBS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
}).superRefine((env, ctx) => {
  if (env.DEPOSITS_ENABLED) {
    if (!env.PAYSTACK_SECRET_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PAYSTACK_SECRET_KEY"], message: "PAYSTACK_SECRET_KEY is required when DEPOSITS_ENABLED=true." });
    }
    if (!env.PAYSTACK_PUBLIC_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PAYSTACK_PUBLIC_KEY"], message: "PAYSTACK_PUBLIC_KEY is required when DEPOSITS_ENABLED=true." });
    }
  }

  if (env.AUTOMATED_PAYOUTS_ENABLED) {
    if (!env.PAYSTACK_SECRET_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PAYSTACK_SECRET_KEY"], message: "PAYSTACK_SECRET_KEY is required when AUTOMATED_PAYOUTS_ENABLED=true." });
    }
    if (!env.PAYPAL_SANDBOX_CLIENT_ID) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PAYPAL_SANDBOX_CLIENT_ID"], message: "PAYPAL_SANDBOX_CLIENT_ID is required when AUTOMATED_PAYOUTS_ENABLED=true." });
    }
    if (!env.PAYPAL_SANDBOX_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PAYPAL_SANDBOX_SECRET"], message: "PAYPAL_SANDBOX_SECRET is required when AUTOMATED_PAYOUTS_ENABLED=true." });
    }
  }
});

export const env = EnvSchema.parse(process.env);
