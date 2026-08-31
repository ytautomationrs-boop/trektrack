import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.js";
import { fetchTransferStatus } from "../modules/wallet/paystackService.js";
import { getPayoutStatus } from "../modules/wallet/paypalService.js";
import { reverseWithdrawal, completeWithdrawal } from "../modules/wallet/service.js";

const PAYPAL_FAILURE_STATUSES = new Set(["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"]);

/**
 * Resolves every PENDING withdrawal by asking Paystack/PayPal for its
 * current status — this backend has no public URL for either provider's
 * webhooks to reach in dev, so status is pulled here on a schedule rather
 * than pushed, same "never trust the initiating call alone" posture as
 * confirmDeposit's re-verify. A withdrawal only leaves PENDING once the
 * provider itself reports a terminal state; anything still in flight
 * (Paystack "pending", PayPal "PENDING"/"UNCLAIMED"/"ONHOLD") is left
 * alone for the next run.
 */
export async function pollPendingWithdrawals() {
  // MANUAL is excluded deliberately: this job asks a payout provider what
  // happened, and a hand-sent EFT has no provider to ask. It leaves PENDING
  // when an admin marks it paid or rejects it.
  //
  // Without this it fell through to the PayPal branch below, found no
  // payoutBatchId, and counted itself "still pending" on every tick forever
  // — harmless, but it conflated "waiting on PayPal" with "waiting on a
  // person", which is exactly the distinction the pilot runs on.
  const pending = await prisma.withdrawal.findMany({
    where: { status: "PENDING", method: { in: ["PAYSTACK", "PAYPAL"] } },
  });

  let completed = 0;
  let failed = 0;
  let stillPending = 0;

  for (const w of pending) {
    try {
      if (w.method === "PAYSTACK") {
        if (!w.paystackTransferCode) {
          stillPending++;
          continue;
        }
        const { status, failureReason } = await fetchTransferStatus(w.paystackTransferCode);
        if (status === "success") {
          await completeWithdrawal({ withdrawalId: w.id, ledgerEntryId: w.ledgerEntryId });
          completed++;
        } else if (status === "failed" || status === "reversed") {
          await reverseWithdrawal({
            withdrawalId: w.id,
            ledgerEntryId: w.ledgerEntryId,
            userId: w.userId,
            amountCents: w.amountCents,
            reason: failureReason ?? `Paystack transfer ${status}`,
          });
          failed++;
        } else {
          stillPending++; // "pending" or "otp" — not resolved yet
        }
      } else {
        if (!w.paypalPayoutBatchId) {
          stillPending++;
          continue;
        }
        const { itemStatus, failureReason } = await getPayoutStatus(w.paypalPayoutBatchId);
        if (itemStatus === "SUCCESS") {
          await completeWithdrawal({ withdrawalId: w.id, ledgerEntryId: w.ledgerEntryId });
          completed++;
        } else if (PAYPAL_FAILURE_STATUSES.has(itemStatus)) {
          await reverseWithdrawal({
            withdrawalId: w.id,
            ledgerEntryId: w.ledgerEntryId,
            userId: w.userId,
            amountCents: w.amountCents,
            reason: failureReason ?? `PayPal payout ${itemStatus}`,
          });
          failed++;
        } else {
          stillPending++; // PENDING / UNCLAIMED / ONHOLD
        }
      }
    } catch (err) {
      // A transient status-check failure (network blip, provider outage)
      // isn't the same as a payout *failure* — leave it PENDING and let the
      // next run try again rather than reversing on our own error.
      console.error(`[withdrawalPolling] status check failed for withdrawal ${w.id}:`, err);
      stillPending++;
    }
  }

  return { completed, failed, stillPending };
}

// Allow `npm run cron:withdrawal-poll` to invoke this directly for local/demo use.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  pollPendingWithdrawals()
    .then((r) => {
      console.log("Withdrawal polling complete:", r);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
