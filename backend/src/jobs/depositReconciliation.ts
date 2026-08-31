import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.js";
import { verifyTransaction } from "../modules/wallet/paystackService.js";
import { confirmDeposit } from "../modules/wallet/service.js";

/**
 * Credits deposits whose confirm never came back.
 *
 * The happy path is the redirect: Paystack sends the user back, the client
 * calls `POST /me/wallet/deposit/confirm`, and the wallet is credited. That
 * round trip is the ONLY thing that credited a deposit — so if it didn't
 * happen, Paystack had the user's money and Streak never knew a deposit had
 * been attempted at all.
 *
 * It doesn't happen more often than it sounds. The tab gets closed on the
 * "payment successful" screen; the connection drops on the way back; the
 * browser discards a backgrounded tab on a phone; the callback lands on an
 * origin where the session isn't stored. None of those are exotic, and every
 * one of them costs a real user real money.
 *
 * Withdrawals have had `jobs/withdrawalPolling.ts` for exactly this reason.
 * This is its counterpart for money coming in, and it is the more important
 * direction: a stuck withdrawal leaves the user's balance intact, while a
 * lost deposit leaves them out of pocket.
 */

/**
 * How long to leave a fresh intent alone. The redirect confirm normally
 * lands within seconds; racing it would just mean both paths crediting the
 * same reference (harmless — confirmDeposit is idempotent — but it would
 * make the logs lie about which path did the work).
 */
const SETTLE_GRACE_MS = 3 * 60 * 1000;

/**
 * When to stop asking. Paystack keeps a reference queryable well past this,
 * but an intent this old that still isn't `success` was abandoned at the
 * checkout page, and leaving it PENDING forever means the queue grows
 * without bound and a genuinely stuck deposit is buried in it.
 */
const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

export async function reconcilePendingDeposits(now = new Date()) {
  const pending = await prisma.depositIntent.findMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - SETTLE_GRACE_MS) } },
    orderBy: { createdAt: "asc" },
    // Bounded so one run can't spend an unbounded amount of time in
    // Paystack calls; the rest are picked up on the next tick.
    take: 200,
  });

  let credited = 0;
  let abandoned = 0;
  let stillPending = 0;

  for (const intent of pending) {
    const tooOld = now.getTime() - intent.createdAt.getTime() > ABANDON_AFTER_MS;

    try {
      const transaction = await verifyTransaction(intent.reference);

      if (transaction.status === "success") {
        // Through the same path the redirect uses, so there is exactly one
        // place that credits a wallet. It is idempotent on the reference
        // (unique [externalRef, type]), so a confirm that raced us is a
        // no-op rather than a double credit.
        await confirmDeposit({ userId: intent.userId, reference: intent.reference });
        credited++;
        continue;
      }

      if (tooOld) {
        await resolve(intent.id, "ABANDONED", `Paystack status: ${transaction.status}`, now);
        abandoned++;
        continue;
      }

      // "abandoned"/"ongoing" inside the window: the user may still be on
      // the checkout page. Paystack references stay payable for a while.
      stillPending++;
    } catch (err) {
      // A failed status check is our problem, not evidence about the
      // payment — never resolve an intent on it, or a Paystack outage would
      // mark real deposits abandoned. The one exception is age: something
      // this old is not worth retrying forever.
      console.error(`[depositReconciliation] verify failed for ${intent.reference}:`, err);
      if (tooOld) {
        await resolve(intent.id, "FAILED", err instanceof Error ? err.message : "verify failed", now);
        abandoned++;
      } else {
        stillPending++;
      }
    }
  }

  return { credited, abandoned, stillPending, examined: pending.length };
}

/** Guarded on PENDING so a concurrent confirm that already completed it wins. */
async function resolve(id: string, status: "ABANDONED" | "FAILED", failureReason: string, now: Date) {
  await prisma.depositIntent.updateMany({
    where: { id, status: "PENDING" },
    data: { status, failureReason, resolvedAt: now },
  });
}

// Allow `npm run cron:deposit-reconcile` to invoke this directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reconcilePendingDeposits()
    .then((r) => {
      console.log("Deposit reconciliation complete:", r);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
