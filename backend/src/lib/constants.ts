// System account that platform revenue and prize expense are attributed to.
// Seeded in prisma/seedRaces.ts; referenced by email (not a hardcoded id) by
// anything that needs to post a platform-side entry — see
// modules/races/service.ts and modules/races/resolution.ts.
export const PLATFORM_ACCOUNT_EMAIL = "platform@streak.demo";

// Deposit (Paystack Transactions) and withdrawal (Paystack Transfers or
// PayPal Payouts, both test/sandbox) are the only two places real money
// moves. Entry fees and prizes are internal wallet movements — only a
// user-initiated withdrawal actually calls a payout provider.
export const WITHDRAWAL_MIN_CENTS = 10_000; // R100 minimum

// Strava integration. Free-tier limits are 200 req/15min and 2,000 req/day
// *per application* (not per user), so the race sync runs on a slow cadence
// (see jobs/raceLifecycle.ts runRaceStravaSync).
export const STRAVA_API_BASE = "https://www.strava.com/api/v3";
export const STRAVA_OAUTH_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
export const STRAVA_OAUTH_TOKEN_URL = "https://www.strava.com/oauth/token";

// Metric keys Strava can corroborate. Steps and swimming are verified from
// the phone/wearable only.
export const STRAVA_SUPPORTED_METRICS = ["cycling", "running"] as const;

// StreakPot — pooled-stake challenges. Flat fee to buy back one otherwise-
// disqualifying missed day. NEVER platform revenue: this amount is added
// straight into the pool finishers split (see modules/challenges/resolution.ts)
// — the whole point of "zero platform commission" is that this fee still
// only ever moves between participants.
export const REDEMPTION_FEE_CENTS = 2_000; // R20
