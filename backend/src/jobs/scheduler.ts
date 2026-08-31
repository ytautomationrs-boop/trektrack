import cron from "node-cron";
import { runRaceLifecycle, runRaceStravaSync } from "./raceLifecycle.js";
import { runChallengeLifecycle } from "./challengeLifecycle.js";
import { runChallengeStravaSync } from "../modules/challenges/stravaSync.js";
import { pollPendingWithdrawals } from "./withdrawalPolling.js";
import { reconcilePendingDeposits } from "./depositReconciliation.js";

// In-process scheduler for the pilot. If this grows beyond a single Node
// process, move these jobs into a dedicated worker so a slow pass can't
// block the API process and multiple web instances don't all run the same
// cron ticks.
export function startScheduler() {
  // Race lifecycle: cancel + refund races that closed short of their exact
  // headcount, resolve finished ones, release prizes cleared by review, and
  // open replacements. Races START inline in enterRace() the instant they
  // fill, so this tick is about the other end of the lifecycle.
  cron.schedule("*/5 * * * *", async () => {
    try {
      const result = await runRaceLifecycle();
      console.log("[cron] race lifecycle:", result);
    } catch (err) {
      console.error("[cron] race lifecycle failed:", err);
    }
  });

  // Server-side Strava pull for running races. Hourly — it makes real
  // outbound calls against a per-application rate limit, and it exists so an
  // entrant who logs a real ride but never opens the app is still counted.
  cron.schedule("30 * * * *", async () => {
    try {
      const result = await runRaceStravaSync();
      console.log("[cron] race strava sync:", result);
    } catch (err) {
      console.error("[cron] race strava sync failed:", err);
    }
  });

  // The same pull for challenge participants. Offset from the race sync so
  // the two don't hit Strava's per-application rate limit in the same
  // minute. This is the ONLY verification path a web participant has, so a
  // failure here costs them their stake — see modules/challenges/stravaSync.ts.
  cron.schedule("45 * * * *", async () => {
    try {
      const result = await runChallengeStravaSync();
      console.log("[cron] challenge strava sync:", result);
    } catch (err) {
      console.error("[cron] challenge strava sync failed:", err);
    }
  });

  // StreakPot lifecycle: start challenges whose startDate has arrived,
  // finalize check-ins past their cutoff, resolve/pay out finished
  // challenges. Same cadence as the race lifecycle tick.
  cron.schedule("*/5 * * * *", async () => {
    try {
      const result = await runChallengeLifecycle();
      console.log("[cron] challenge lifecycle:", result);
    } catch (err) {
      console.error("[cron] challenge lifecycle failed:", err);
    }
  });

  // Withdrawal status polling — real money the user is actively waiting on,
  // so this runs far more often than the others. No webhook receiver: this
  // backend has no public URL in dev, so status is pulled, not pushed.
  cron.schedule("*/2 * * * *", async () => {
    try {
      const result = await pollPendingWithdrawals();
      console.log("[cron] withdrawal polling:", result);
    } catch (err) {
      console.error("[cron] withdrawal polling failed:", err);
    }
  });

  // The counterpart for money coming IN. Every deposit used to depend
  // entirely on the browser making it back from Paystack to call confirm;
  // when it didn't, the user had paid and nothing credited them. Runs on
  // the same cadence as withdrawals — someone waiting on a balance they
  // have already been charged for should not wait long.
  cron.schedule("*/2 * * * *", async () => {
    try {
      const result = await reconcilePendingDeposits();
      console.log("[cron] deposit reconciliation:", result);
    } catch (err) {
      console.error("[cron] deposit reconciliation failed:", err);
    }
  });
}
