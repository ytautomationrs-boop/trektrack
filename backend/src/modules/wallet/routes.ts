import type { FastifyInstance } from "fastify";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import {
  DepositIntentSchema,
  ConfirmDepositSchema,
  WithdrawSchema,
  ResolvePaystackAccountSchema,
  GrantSponsoredCreditSchema,
  ResolveManualWithdrawalSchema,
} from "./schemas.js";
import {
  getWallet,
  createDeposit,
  confirmDeposit,
  requestWithdrawal,
  grantSponsoredCredit,
  listPendingManualWithdrawals,
  markManualWithdrawalPaid,
  rejectManualWithdrawal,
  WalletError,
} from "./service.js";
import { listBanks, resolveAccount } from "./paystackService.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../lib/env.js";

export async function walletRoutes(app: FastifyInstance) {
  app.get("/me/wallet", { preHandler: requireAuth }, async (req, reply) => {
    return reply.send(await getWallet(req.userId));
  });

  // Step 1 of the Paystack checkout flow — see modules/wallet/service.ts.
  app.post("/me/wallet/deposit/intent", { preHandler: requireAuth }, async (req, reply) => {
    const body = DepositIntentSchema.parse(req.body);
    try {
      if (!env.DEPOSITS_ENABLED) {
        return reply.code(403).send({
          error: "deposits_disabled",
          message: "ASTA is sponsoring the pilot — there is nothing to pay in. Your balance is credited for you.",
        });
      }

      return reply.send(await createDeposit({ userId: req.userId, amountCents: body.amountCents, platform: body.platform }));
    } catch (err) {
      if (err instanceof WalletError) return reply.code(400).send({ error: err.code, message: err.message });
      throw err;
    }
  });

  // Step 2 — called after the browser checkout session returns with a reference.
  app.post("/me/wallet/deposit/confirm", { preHandler: requireAuth }, async (req, reply) => {
    const body = ConfirmDepositSchema.parse(req.body);
    try {
      if (!env.DEPOSITS_ENABLED) {
        return reply.code(403).send({
          error: "deposits_disabled",
          message: "ASTA is sponsoring the pilot — there is nothing to pay in. Your balance is credited for you.",
        });
      }

      return reply.send(await confirmDeposit({ userId: req.userId, reference: body.reference }));
    } catch (err) {
      if (err instanceof WalletError) return reply.code(err.code === "payment_failed" ? 402 : 400).send({ error: err.code, message: err.message });
      throw err;
    }
  });

  // Paystack Transfers payout method — bank picker + account resolution
  // (see modules/wallet/paystackService.ts), used by the withdrawal form
  // before the user ever sees a "Withdraw" button they can press.
  app.get("/me/wallet/payout-methods/paystack/banks", { preHandler: requireAuth }, async (_req, reply) => {
    return reply.send({ banks: await listBanks() });
  });

  app.post("/me/wallet/payout-methods/paystack/resolve", { preHandler: requireAuth }, async (req, reply) => {
    const body = ResolvePaystackAccountSchema.parse(req.body);
    try {
      return reply.send(await resolveAccount(body));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't resolve that account.";
      // Paystack's /bank/resolve doesn't support South Africa/ZAR at all
      // (verified directly against their API — see paystackService.ts
      // resolveAccount) — a distinct code so the mobile client can fall
      // back to a user-typed account name instead of treating it as "you
      // typed the wrong account number".
      const unavailable = message.includes("valid currencies");
      return reply.code(400).send({ error: unavailable ? "account_resolve_unavailable" : "account_resolve_failed", message });
    }
  });

  // Real payout — Paystack Transfer or PayPal Payout, both test/sandbox
  // (see modules/wallet/service.ts requestWithdrawal for the hold-then-
  // confirm model). `payout_needs_otp` and `insufficient_balance` are
  // surfaced distinctly from a generic failure so the mobile client can
  // show something more useful than "something went wrong".
  app.post("/me/wallet/withdraw", { preHandler: requireAuth }, async (req, reply) => {
    const body = WithdrawSchema.parse(req.body);
    try {
      return reply.send(await requestWithdrawal({ userId: req.userId, amountCents: body.amountCents, destination: body.destination }));
    } catch (err) {
      if (err instanceof WalletError) return reply.code(err.code === "insufficient_balance" ? 402 : 400).send({ error: err.code, message: err.message });
      throw err;
    }
  });

  // ── Pilot operations ──────────────────────────────────
  //
  // Same posture as the invite-code endpoints in modules/auth/routes.ts: a
  // couple of admin-only REST calls rather than a console, because at ~50
  // users the operator is a person with a terminal.

  /** Funds a sponsored account. The only way money enters a wallet while deposits are off. */
  app.post("/admin/sponsored-credit", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const body = GrantSponsoredCreditSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (!user) return reply.code(404).send({ error: "user_not_found", message: "No account with that email." });
    try {
      const wallet = await grantSponsoredCredit({
        userId: user.id,
        amountCents: body.amountCents,
        grantRef: body.grantRef,
        note: body.note,
        grantedByUserId: req.userId,
      });
      return reply.send({ granted: true, email: body.email, wallet });
    } catch (err) {
      if (err instanceof WalletError) {
        return reply.code(err.code === "duplicate_grant" ? 409 : 400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  /**
   * The payout queue — everything waiting to be sent by hand.
   *
   * This is the reliable surface, not the push notification: until the Expo
   * project is linked no token exists on any platform, so nothing is being
   * delivered. Check here regardless of whether a notification arrived.
   */
  app.get("/admin/withdrawals", { preHandler: [requireAuth, requireAdmin] }, async (_req, reply) => {
    return reply.send({ withdrawals: await listPendingManualWithdrawals() });
  });

  /** Closes the record once the EFT has gone out. Moves no money — the wallet was debited at request time. */
  app.post("/admin/withdrawals/:id/mark-paid", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ResolveManualWithdrawalSchema.parse(req.body ?? {});
    try {
      return reply.send(await markManualWithdrawalPaid({ withdrawalId: id, adminUserId: req.userId, reference: body.reference }));
    } catch (err) {
      if (err instanceof WalletError) {
        return reply.code(err.code === "not_found" ? 404 : 400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  /** Refuses a payout and gives the money back, by the same reversal path a failed provider payout uses. */
  app.post("/admin/withdrawals/:id/reject", { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ResolveManualWithdrawalSchema.parse(req.body ?? {});
    try {
      return reply.send(
        await rejectManualWithdrawal({ withdrawalId: id, adminUserId: req.userId, reason: body.reason ?? "Rejected by an admin" })
      );
    } catch (err) {
      if (err instanceof WalletError) {
        return reply.code(err.code === "not_found" ? 404 : 400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });
}
