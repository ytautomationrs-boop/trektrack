import cron from "node-cron";
import {sendStartReminders} from "./startReminders.js";
import {ensureOpenRaces} from "../modules/races/service.js";
import { runRaceLifecycle, runRaceStravaSync } from "./raceLifecycle.js";
import { runChallengeLifecycle } from "./challengeLifecycle.js";
import { runChallengeStravaSync } from "../modules/challenges/stravaSync.js";
import { pollPendingWithdrawals } from "./withdrawalPolling.js";
import { reconcilePendingDeposits } from "./depositReconciliation.js";
import { env } from "../lib/env.js";
import { stravaConfigured } from "../modules/integrations/strava/stravaClient.js";

type JobName =
  | "activity reminders"
  | "empty race cleanup"
  | "race lifecycle"
  | "race strava sync"
  | "challenge strava sync"
  | "challenge lifecycle"
  | "withdrawal polling"
  | "deposit reconciliation";

const runningJobs = new Set<JobName>();

function scheduleJob(name: JobName, expression: string, run: () => Promise<unknown>) {
  cron.schedule(expression, async () => {
    if (runningJobs.has(name)) {
      console.log(`[cron] ${name} skipped: another job is still running`);
      return;
    }

    runningJobs.add(name);
    try {
      const result = await run();
      console.log(`[cron] ${name}:`, result);
    } catch (err) {
      console.error(`[cron] ${name} failed:`, err);
    } finally {
      runningJobs.delete(name);
    }
  });
}

// In-process scheduler for the pilot. If this grows beyond a single Node
// process, move these jobs into a dedicated worker so a slow pass can't
// block the API process and multiple web instances don't all run the same
// cron ticks.
export function startScheduler() {
  // Start locked races, resolve results and release reviewed prizes.
  scheduleJob("race lifecycle", "*/5 * * * *", runRaceLifecycle);

  // Server-side Strava pull for running races. Hourly — it makes real
  // outbound calls against a per-application rate limit, and it exists so an
  // entrant who logs a real ride but never opens the app is still counted.
  if (stravaConfigured()) {
    scheduleJob("race strava sync", "30 * * * *", runRaceStravaSync);
  }

  // The same pull for challenge participants. Offset from the race sync so
  // the two don't hit Strava's per-application rate limit in the same
  // minute. This is the ONLY verification path a web participant has, so a
  // failure here costs them their stake — see modules/challenges/stravaSync.ts.
  if (stravaConfigured()) {
    scheduleJob("challenge strava sync", "45 * * * *", runChallengeStravaSync);
  }

  // StreakPot lifecycle: start challenges whose startDate has arrived,
  // finalize check-ins past their cutoff, resolve/pay out finished
  // challenges. Same cadence as the race lifecycle tick.
  scheduleJob("challenge lifecycle", "1-59/5 * * * *", runChallengeLifecycle);

  // Withdrawal status polling — real money the user is actively waiting on,
  // so this runs far more often than the others. No webhook receiver: this
  // backend has no public URL in dev, so status is pulled, not pushed.
  if (env.AUTOMATED_PAYOUTS_ENABLED) {
    scheduleJob("withdrawal polling", "*/2 * * * *", pollPendingWithdrawals);
  }

  // The counterpart for money coming IN. Every deposit used to depend
  // entirely on the browser making it back from Paystack to call confirm;
  // when it didn't, the user had paid and nothing credited them. Runs on
  // the same cadence as withdrawals — someone waiting on a balance they
  // have already been charged for should not wait long.
  if (env.DEPOSITS_ENABLED) {
    scheduleJob("deposit reconciliation", "1-59/2 * * * *", reconcilePendingDeposits);
  }
}

/** Small activity tasks remain available when heavy scoring jobs are disabled. */
export function startActivityScheduler(){
 scheduleJob("activity reminders","* * * * *",sendStartReminders);
 if(!env.RUN_BACKGROUND_JOBS)scheduleJob("empty race cleanup","*/5 * * * *",ensureOpenRaces);
}
