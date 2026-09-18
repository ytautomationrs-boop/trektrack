import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { initializeTransaction, verifyTransaction, createTransferRecipient, initiateTransfer } from "./paystackService.js";
import { createPayout } from "./paypalService.js";
import { WITHDRAWAL_MIN_CENTS } from "../../lib/constants.js";
import { env } from "../../lib/env.js";
import { ensurePlatformAccount } from "../../lib/platformAccount.js";
import { notifyUsers } from "../notifications/service.js";

export class WalletError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// ZAR — the wallet's single currency, matching the Paystack merchant test
// account's supported currency (USD/NGN/GHS/KES all rejected with
// unsupported_currency when tested against these keys).
export async function getWallet(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalanceCents: true } });
  return { balanceCents: user.walletBalanceCents, currency: "zar" as const };
}

/**
 * Step 1 of depositing — Paystack's hosted checkout, not an in-app card
 * sheet (no native Paystack SDK needed; the mobile app opens
 * `authorizationUrl` via expo-web-browser and Paystack redirects back to
 * the streak:// scheme on completion — same pattern as the existing Strava
 * OAuth flow). Nothing written to our DB yet.
 */
export async function createDeposit(params: { userId: string; amountCents: number; platform?: "native" | "web" }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: params.userId }, select: { id: true, email: true } });

  // Where Paystack sends the user after checkout. Native uses the streak://
  // scheme expo-web-browser's auth session intercepts on-device; web has no
  // equivalent (a browser tab can't intercept a custom scheme), so it gets a
  // real page on WEB_APP_URL that reads ?reference= off its own URL — see
  // mobile/src/screens/integrations/PaystackCallbackScreen.tsx.
  if (params.platform === "web" && !env.WEB_APP_URL) {
    throw new WalletError("web_callback_not_configured", "Deposits from the web aren't configured on this server yet.");
  }
  const callbackUrl = params.platform === "web" ? `${env.WEB_APP_URL}/paystack-callback` : "streak://paystack-callback";

  const { authorization_url, reference } = await initializeTransaction({
    email: user.email,
    amountCents: params.amountCents,
    userId: user.id,
    callbackUrl,
  });

  // Recorded BEFORE the user ever reaches Paystack's page, because the whole
  // point is to know about deposits whose confirm never comes back. Written
  // after initialize only because the reference doesn't exist until then.
  await prisma.depositIntent.create({
    data: { userId: user.id, reference, amountCents: params.amountCents },
  });

  return { authorizationUrl: authorization_url, reference };
}

/**
 * Step 2 — called after the browser session returns with a reference.
 * Re-verifies the transaction with Paystack before crediting the wallet
 * (never trusts the redirect alone — the callback URL is client-visible
 * and unsigned).
 *
 * Idempotent on the reference — but instead of a check-then-act read (an
 * `already processed?` SELECT followed by a separate credit, which two
 * concurrent confirm calls for the same reference could both pass before
 * either commits), this relies on the DB-level `@@unique([externalRef,
 * type])` constraint on LedgerEntry: both calls attempt the same insert
 * inside one transaction with the credit, but Postgres only lets one
 * succeed. The loser's transaction rolls back entirely (no credit applied)
 * and is treated as "already processed" rather than an error.
 */
export async function confirmDeposit(params: { userId: string; reference: string }) {
  const transaction = await verifyTransaction(params.reference);

  if (transaction.metadata?.userId !== params.userId) {
    throw new WalletError("payment_mismatch", "This payment doesn't belong to this user.");
  }
  if (transaction.status !== "success") {
    throw new WalletError("payment_failed", `Paystack transaction status: ${transaction.status}`);
  }

  try {
    await prisma.$transaction([
      prisma.ledgerEntry.create({
        data: {
          userId: params.userId,
          type: "DEPOSIT",
          status: "COMPLETED",
          amountCents: transaction.amount,
          currency: transaction.currency.toLowerCase(),
          description: "Wallet deposit",
          externalRef: transaction.reference,
          externalProvider: "paystack",
        },
      }),
      prisma.user.update({ where: { id: params.userId }, data: { walletBalanceCents: { increment: transaction.amount } }, select: { id: true } }),
    ]);
  } catch (err) {
    const alreadyProcessed = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (!alreadyProcessed) throw err;
  }

  // Outside the transaction above deliberately: the credit is the thing that
  // must be atomic, and the intent is bookkeeping about it. If this update
  // is lost the reconciler re-verifies, re-runs the no-op credit, and closes
  // the intent on its next pass — whereas failing the whole confirm over it
  // would turn a successful deposit into an error the user sees.
  // updateMany, not update, so an intent that isn't there (an older deposit
  // predating this table) isn't an exception.
  await prisma.depositIntent.updateMany({
    where: { reference: params.reference, status: "PENDING" },
    data: { status: "COMPLETED", resolvedAt: new Date() },
  });

  return getWallet(params.userId);
}

export type WithdrawalDestination =
  | { method: "PAYSTACK"; bankCode: string; accountNumber: string; accountName: string }
  | { method: "PAYPAL"; email: string }
  | { method: "MANUAL"; bankName: string; accountNumber: string; accountName: string };

/**
 * Grants a user wallet balance the platform is funding — the pilot's only
 * way in while deposits are off.
 *
 * Two ledger rows, not one. The user's credit is matched by a platform-side
 * expense because a granted balance is a real liability the moment it is
 * issued: the holder can withdraw it as cash. Recording only the user side
 * would leave the platform account looking break-even while it was actually
 * spending, which is exactly the distinction the race REVENUE/EXPENSE pair
 * exists to keep answerable from the ledger alone.
 *
 * `grantRef` makes it idempotent. A double-submitted grant is a real risk
 * when the operator is a person with a terminal, and the failure mode is
 * handing out money twice — so the caller passes a stable reference and the
 * unique index on [externalRef, type] refuses the second attempt.
 */
export async function grantSponsoredCredit(params: {
  userId: string;
  amountCents: number;
  grantRef: string;
  note?: string;
  grantedByUserId: string;
}) {
  if (params.amountCents <= 0) {
    throw new WalletError("invalid_amount", "A sponsored credit must be a positive amount.");
  }

  const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { id: true } });
  if (!user) throw new WalletError("user_not_found", "No account with that id.");

  const platform = await ensurePlatformAccount(prisma);
  const description = params.note ? `Pilot sponsorship — ${params.note}` : "Pilot sponsorship";

  try {
    await prisma.$transaction([
      prisma.ledgerEntry.create({
        data: {
          userId: params.userId,
          type: "SPONSORED_CREDIT",
          status: "COMPLETED",
          amountCents: params.amountCents,
          currency: "zar",
          description,
          externalRef: params.grantRef,
          externalProvider: "sponsorship",
          // A structured column, not text embedded in `description` — the
          // console makes this a one-tap action with no shell history behind
          // it, so "who did this" needs to be queryable, not grep-able.
          performedByUserId: params.grantedByUserId,
        },
      }),
      prisma.user.update({ where: { id: params.userId }, data: { walletBalanceCents: { increment: params.amountCents } }, select: { id: true } }),
      prisma.ledgerEntry.create({
        data: {
          userId: platform.id,
          type: "SPONSORED_CREDIT_EXPENSE",
          status: "COMPLETED",
          amountCents: -params.amountCents,
          currency: "zar",
          description,
          externalRef: params.grantRef,
          externalProvider: "sponsorship",
          performedByUserId: params.grantedByUserId,
        },
      }),
      prisma.user.update({ where: { id: platform.id }, data: { walletBalanceCents: { decrement: params.amountCents } }, select: { id: true } }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new WalletError("duplicate_grant", "That grant reference has already been used — nothing was granted twice.");
    }
    throw err;
  }

  return getWallet(params.userId);
}

/**
 * Withdrawal — a real payout via Paystack Transfers or PayPal Payouts
 * (both test/sandbox), modeled as a two-phase hold-then-confirm exactly
 * like the existing staking fix:
 *   1. Hold — atomically debit the wallet and write PENDING LedgerEntry +
 *      Withdrawal rows, all in one transaction, *before* ever calling a
 *      payout provider. This is what "spendable balance" means: once a
 *      withdrawal is requested, that money can't also be staked into a
 *      challenge in the meantime — the debit is a single conditional
 *      UPDATE (`WHERE walletBalanceCents >= amount`), re-checked at the
 *      exact moment it commits, not against a balance read earlier in the
 *      request; two concurrent withdrawal (or stake) requests against the
 *      same wallet can't both succeed past the real balance.
 *   2. Initiate — call the actual provider. Paystack sometimes confirms a
 *      test-mode transfer synchronously (`status: "success"` on the same
 *      call), in which case this resolves the hold to COMPLETED right
 *      here; otherwise (the PayPal case, always) it stays PENDING and
 *      jobs/withdrawalPolling.ts resolves it later by asking the provider,
 *      never by assuming the initiating call's non-error return means
 *      success. If initiation itself throws — bad account, provider
 *      unreachable, whatever — the hold is reversed immediately (re-credit
 *      the wallet, mark FAILED) so a failed payout never costs the user
 *      their balance.
 */
export async function requestWithdrawal(params: { userId: string; amountCents: number; destination: WithdrawalDestination }) {
  if (params.amountCents < WITHDRAWAL_MIN_CENTS) {
    throw new WalletError("below_minimum", `Withdrawals must be at least R${(WITHDRAWAL_MIN_CENTS / 100).toFixed(2)}.`);
  }
  const { destination } = params;

  const { withdrawal, ledgerEntry } = await prisma.$transaction(async (tx) => {
    const debited = await tx.user.updateMany({
      where: { id: params.userId, walletBalanceCents: { gte: params.amountCents } },
      data: { walletBalanceCents: { decrement: params.amountCents } },
    });
    if (debited.count === 0) {
      throw new WalletError("insufficient_balance", "Withdrawal amount exceeds your wallet balance.");
    }

    const ledgerEntry = await tx.ledgerEntry.create({
      data: {
        userId: params.userId,
        type: "WITHDRAWAL",
        status: "PENDING",
        amountCents: -params.amountCents,
        currency: "zar",
        description:
          destination.method === "PAYSTACK"
            ? `Withdrawal via Paystack to ${destination.accountName}`
            : destination.method === "PAYPAL"
              ? `Withdrawal via PayPal to ${destination.email}`
              : `Withdrawal by EFT to ${destination.accountName} (${destination.bankName})`,
        externalProvider: destination.method.toLowerCase(),
      },
    });

    const withdrawal = await tx.withdrawal.create({
      data: {
        userId: params.userId,
        ledgerEntryId: ledgerEntry.id,
        amountCents: params.amountCents,
        method: destination.method,
        ...(destination.method === "PAYSTACK"
          ? { paystackBankCode: destination.bankCode, paystackAccountNumber: destination.accountNumber, paystackAccountName: destination.accountName }
          : destination.method === "PAYPAL"
            ? { paypalEmail: destination.email }
            : { manualBankName: destination.bankName, manualAccountNumber: destination.accountNumber, manualAccountName: destination.accountName }),
      },
    });

    return { withdrawal, ledgerEntry };
  });

  // MANUAL stops here on purpose. The hold above is the whole of the
  // machine's job: the balance is debited so it can't also be staked, the
  // Withdrawal sits PENDING, and a person sends the EFT and marks it paid
  // (markManualWithdrawalPaid below). No provider is called, so there is
  // nothing to poll and nothing that can fail halfway.
  //
  // That human step is load-bearing beyond payments during the pilot: with
  // activity data now self-imported rather than pulled from Strava, the
  // review before an EFT goes out is the only place a fabricated result gets
  // caught before it becomes cash.
  if (destination.method === "MANUAL") {
    await notifyAdminsOfWithdrawal({ withdrawalId: withdrawal.id, userId: params.userId, amountCents: params.amountCents });
    return getWallet(params.userId);
  }

  if (!env.AUTOMATED_PAYOUTS_ENABLED) {
    await reverseWithdrawal({
      withdrawalId: withdrawal.id,
      ledgerEntryId: ledgerEntry.id,
      userId: params.userId,
      amountCents: params.amountCents,
      reason: "Automated payouts are disabled on this deployment",
    });
    throw new WalletError(
      "automated_payouts_disabled",
      "Card and PayPal payouts are switched off during the pilot — withdraw by EFT instead."
    );
  }

  try {
    if (destination.method === "PAYSTACK") {
      const { recipientCode } = await createTransferRecipient({
        accountName: destination.accountName,
        accountNumber: destination.accountNumber,
        bankCode: destination.bankCode,
      });
  const { transferCode, status } = await initiateTransfer({ amountCents: params.amountCents, recipientCode, reason: "TrackTrek wallet withdrawal" });
      if (status === "otp") {
        throw new WalletError(
          "payout_needs_otp",
          "This Paystack integration requires transfer OTP confirmation, which isn't supported here — disable Transfer OTP in the Paystack test dashboard."
        );
      }
      const resolved = status === "success";
      await prisma.$transaction([
        prisma.withdrawal.update({
          where: { id: withdrawal.id },
          data: { paystackRecipientCode: recipientCode, paystackTransferCode: transferCode, status: resolved ? "COMPLETED" : "PENDING", confirmedAt: resolved ? new Date() : null },
        }),
        prisma.ledgerEntry.update({ where: { id: ledgerEntry.id }, data: { externalRef: transferCode, status: resolved ? "COMPLETED" : "PENDING" } }),
      ]);
    } else {
      // PayPal payouts never resolve synchronously, even in sandbox —
      // stays PENDING unconditionally; jobs/withdrawalPolling.ts picks it up.
      const { payoutBatchId, payoutItemId } = await createPayout({
        withdrawalId: withdrawal.id,
        amountCents: params.amountCents,
        receiverEmail: destination.email,
        note: "TrackTrek wallet withdrawal",
      });
      await prisma.$transaction([
        prisma.withdrawal.update({ where: { id: withdrawal.id }, data: { paypalPayoutBatchId: payoutBatchId, paypalPayoutItemId: payoutItemId } }),
        prisma.ledgerEntry.update({ where: { id: ledgerEntry.id }, data: { externalRef: payoutBatchId } }),
      ]);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Payout initiation failed";
    await reverseWithdrawal({ withdrawalId: withdrawal.id, ledgerEntryId: ledgerEntry.id, userId: params.userId, amountCents: params.amountCents, reason });
    throw err instanceof WalletError ? err : new WalletError("payout_failed", reason);
  }

  return getWallet(params.userId);
}

function formatZar(cents: number) {
  return `R${(cents / 100).toFixed(2)}`;
}

/**
 * Tells every admin a payout is waiting to be sent by hand.
 *
 * Push is best-effort and deliberately never fails the withdrawal — the
 * request is already recorded, and `GET /admin/withdrawals` is the reliable
 * queue. That matters right now in particular: until the Expo project is
 * linked, no push token exists on any platform, so the queue is the ONLY
 * thing that surfaces a pending payout. Check it whether or not a
 * notification arrives.
 */
async function notifyAdminsOfWithdrawal(params: { withdrawalId: string; userId: string; amountCents: number }) {
  try {
    const [admins, user] = await Promise.all([
      prisma.user.findMany({ where: { isAdmin: true }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: params.userId }, select: { displayName: true } }),
    ]);
    if (admins.length === 0) return;
    await notifyUsers(
      admins.map((a) => a.id),
      "admin_withdrawal_requested",
      {
        title: "Withdrawal to send",
        body: `${user?.displayName ?? "Someone"} requested ${formatZar(params.amountCents)} by EFT.`,
        data: { withdrawalId: params.withdrawalId },
      }
    );
  } catch (err) {
    console.error("[wallet] failed to notify admins of a withdrawal:", err);
  }
}

/** The payout queue — everything waiting to be sent by hand, oldest first. */
export async function listPendingManualWithdrawals() {
  return prisma.withdrawal.findMany({
    where: { status: "PENDING", method: "MANUAL" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      amountCents: true,
      createdAt: true,
      manualBankName: true,
      manualAccountNumber: true,
      manualAccountName: true,
      user: { select: { id: true, displayName: true, email: true } },
    },
  });
}

/**
 * Marks a hand-sent EFT as paid.
 *
 * The wallet was already debited when the withdrawal was requested, so this
 * moves no money — it closes the record. Guarded on PENDING via updateMany
 * so two admins clicking at once can't both "complete" it, and the second
 * gets told rather than silently succeeding.
 */
export async function markManualWithdrawalPaid(params: { withdrawalId: string; adminUserId: string; reference?: string }) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: params.withdrawalId } });
  if (!withdrawal) throw new WalletError("not_found", "No withdrawal with that id.");
  if (withdrawal.method !== "MANUAL") throw new WalletError("not_manual", "That withdrawal isn't a manual EFT.");
  if (withdrawal.status !== "PENDING") throw new WalletError("not_pending", `That withdrawal is already ${withdrawal.status.toLowerCase()}.`);

  const claimed = await prisma.withdrawal.updateMany({
    where: { id: params.withdrawalId, status: "PENDING" },
    data: { status: "COMPLETED", confirmedAt: new Date(), manualReference: params.reference ?? null, resolvedByUserId: params.adminUserId },
  });
  if (claimed.count === 0) throw new WalletError("not_pending", "Someone else just resolved that withdrawal.");

  // Status only. The EFT reference is an admin's note and lives on
  // Withdrawal.manualReference — putting it in LedgerEntry.externalRef
  // overloads a field that carries a UNIQUE [externalRef, type] constraint,
  // which exists to dedupe provider-issued ids. Two payouts batched under
  // one EFT reference is an ordinary thing for a person to do, and it was
  // turning the second mark-paid into a 500.
  await prisma.ledgerEntry.update({ where: { id: withdrawal.ledgerEntryId }, data: { status: "COMPLETED" } });
  return { withdrawalId: withdrawal.id, status: "COMPLETED" as const };
}

/**
 * Refuses a hand-sent EFT and gives the money back.
 *
 * Reuses reverseWithdrawal so a rejected manual payout re-credits by exactly
 * the same path as a failed provider payout — one reversal, one place.
 */
export async function rejectManualWithdrawal(params: { withdrawalId: string; adminUserId: string; reason: string }) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: params.withdrawalId } });
  if (!withdrawal) throw new WalletError("not_found", "No withdrawal with that id.");
  if (withdrawal.method !== "MANUAL") throw new WalletError("not_manual", "That withdrawal isn't a manual EFT.");
  if (withdrawal.status !== "PENDING") throw new WalletError("not_pending", `That withdrawal is already ${withdrawal.status.toLowerCase()}.`);

  // Claim it first, so a reject racing a mark-paid can't double-credit.
  const claimed = await prisma.withdrawal.updateMany({
    where: { id: params.withdrawalId, status: "PENDING" },
    data: { resolvedByUserId: params.adminUserId },
  });
  if (claimed.count === 0) throw new WalletError("not_pending", "Someone else just resolved that withdrawal.");

  await reverseWithdrawal({
    withdrawalId: withdrawal.id,
    ledgerEntryId: withdrawal.ledgerEntryId,
    userId: withdrawal.userId,
    amountCents: withdrawal.amountCents,
    reason: params.reason,
  });
  return { withdrawalId: withdrawal.id, status: "FAILED" as const, refundedCents: withdrawal.amountCents };
}

/**
 * Un-does the hold from requestWithdrawal — re-credits the wallet and
 * marks both the Withdrawal and its LedgerEntry FAILED, atomically. Used
 * both when initiation itself throws (above) and when
 * jobs/withdrawalPolling.ts later learns a PENDING payout actually failed
 * or reversed on the provider's side — same reversal either way, only the
 * timing differs.
 */
export async function reverseWithdrawal(params: { withdrawalId: string; ledgerEntryId: string; userId: string; amountCents: number; reason: string }) {
  await prisma.$transaction([
    prisma.user.update({ where: { id: params.userId }, data: { walletBalanceCents: { increment: params.amountCents } }, select: { id: true } }),
    prisma.withdrawal.update({ where: { id: params.withdrawalId }, data: { status: "FAILED", failureReason: params.reason } }),
    prisma.ledgerEntry.update({ where: { id: params.ledgerEntryId }, data: { status: "FAILED" } }),
  ]);
}

/** Marks a PENDING withdrawal COMPLETED once the provider confirms — no balance movement here, the hold already applied it. */
export async function completeWithdrawal(params: { withdrawalId: string; ledgerEntryId: string }) {
  await prisma.$transaction([
    prisma.withdrawal.update({ where: { id: params.withdrawalId }, data: { status: "COMPLETED", confirmedAt: new Date() } }),
    prisma.ledgerEntry.update({ where: { id: params.ledgerEntryId }, data: { status: "COMPLETED" } }),
  ]);
}
