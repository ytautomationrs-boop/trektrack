import { env } from "../../lib/env.js";
import { withExternalFetchTimeout } from "../../lib/http.js";

// All amounts in cents (Paystack calls this "the smallest currency unit" —
// for ZAR that's cents, same unit as every other *Cents field in this
// schema). ZAR because this merchant test account doesn't support USD —
// see modules/wallet/service.ts getWallet. TEST MODE only — enforced by
// the sk_test_/pk_test_ prefix check in lib/env.ts. Deposits (Transactions
// API) and withdrawals (Transfers API, this file's bank/resolve/recipient/
// transfer functions) are the only two real money movements in this app.

const PAYSTACK_API_BASE = "https://api.paystack.co";

type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data: { authorization_url: string; access_code: string; reference: string };
};

type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data: {
    status: "success" | "failed" | "abandoned";
    reference: string;
    amount: number;
    currency: string;
    metadata: Record<string, unknown> | null;
  };
};

async function paystackFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PAYSTACK_API_BASE}${path}`, withExternalFetchTimeout({
    ...init,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  }));
  const body = (await res.json()) as T & { status: boolean; message: string };
  if (!res.ok || !body.status) {
    throw new Error(`Paystack API error: ${body.message ?? res.statusText}`);
  }
  return body;
}

/**
 * Step 1 of a deposit — Paystack's own hosted checkout page. Nothing is
 * written to our DB here; the mobile app opens `authorization_url` in a
 * browser session (see mobile/src/integrations/paystack.ts) and Paystack
 * redirects back to `callback_url` on completion, carrying `reference`.
 */
export async function initializeTransaction(params: { email: string; amountCents: number; userId: string; callbackUrl: string }) {
  const { data } = await paystackFetch<PaystackInitializeResponse>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: params.email,
      amount: params.amountCents,
      currency: "ZAR", // this merchant test account only supports ZAR — USD/NGN/GHS/KES all rejected with unsupported_currency
      // Per-transaction, so one backend can serve both the native app (a
      // streak:// scheme expo-web-browser intercepts) and the web pilot (a
      // real page on WEB_APP_URL). See createDeposit in service.ts.
      callback_url: params.callbackUrl,
      metadata: { userId: params.userId },
    }),
  });
  return data;
}

/**
 * Step 2 — re-verifies the transaction with Paystack itself rather than
 * trusting the client's "it succeeded" redirect, same trust model the old
 * Stripe PaymentIntent re-fetch used.
 */
export async function verifyTransaction(reference: string) {
  const { data } = await paystackFetch<PaystackVerifyResponse>(`/transaction/verify/${encodeURIComponent(reference)}`);
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// Withdrawals (Transfers API) — one of the two payout methods (the other
// is PayPal, see paypalService.ts). South African bank accounts use
// Paystack's "basa" recipient type (not "nuban", which is Nigeria-only) to
// match the ZAR/South Africa merchant account the deposit side already
// uses.
// ─────────────────────────────────────────────────────────────────────────

export type PaystackBank = { name: string; code: string };

/** Banks for the withdrawal form's picker — South Africa only, matching the wallet's single ZAR currency. */
export async function listBanks(): Promise<PaystackBank[]> {
  const { data } = await paystackFetch<{ status: boolean; message: string; data: Array<{ name: string; code: string }> }>(
    "/bank?country=south africa&currency=ZAR"
  );
  return data.map((b) => ({ name: b.name, code: b.code }));
}

/**
 * Confirms whose account a bank code + account number actually resolves
 * to, *before* the user commits to a withdrawal — the returned name is
 * shown back to them for confirmation rather than trusting whatever they
 * typed (a typo'd account number would otherwise silently pay a stranger).
 *
 * Verified against Paystack's live API directly (not just their docs):
 * `/bank/resolve` only supports NGN/USD/GHS/KES — South Africa (ZAR) isn't
 * one of them, and passing `currency=ZAR` explicitly doesn't change that;
 * it's a hard platform gap, not a param this integration is missing. Every
 * ZAR call to this function throws with that exact "valid currencies"
 * message — see the `account_resolve_unavailable` handling on the
 * `/me/wallet/payout-methods/paystack/resolve` route and the mobile
 * client's fallback to a user-typed account name when this fails.
 */
export async function resolveAccount(params: { bankCode: string; accountNumber: string }): Promise<{ accountName: string }> {
  const { data } = await paystackFetch<{ status: boolean; message: string; data: { account_number: string; account_name: string } }>(
    `/bank/resolve?account_number=${encodeURIComponent(params.accountNumber)}&bank_code=${encodeURIComponent(params.bankCode)}`
  );
  return { accountName: data.account_name };
}

/** Registers the payout destination with Paystack — required once per transfer (recipients aren't currently reused across withdrawals). */
export async function createTransferRecipient(params: { accountName: string; accountNumber: string; bankCode: string }): Promise<{ recipientCode: string }> {
  const { data } = await paystackFetch<{ status: boolean; message: string; data: { recipient_code: string } }>("/transferrecipient", {
    method: "POST",
    body: JSON.stringify({
      type: "basa",
      name: params.accountName,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: "ZAR",
    }),
  });
  return { recipientCode: data.recipient_code };
}

export type PaystackTransferStatus = "success" | "pending" | "failed" | "reversed" | "otp";

/**
 * Initiates the actual payout. `status: "otp"` means this Paystack
 * integration has transfer OTP confirmation turned on — finalizing that
 * (POST /transfer/finalize_transfer with the OTP the user received) isn't
 * built here; treat it as a configuration mismatch for this demo (disable
 * OTP on transfers in the Paystack test dashboard) rather than a normal
 * failure path.
 */
export async function initiateTransfer(params: { amountCents: number; recipientCode: string; reason: string }): Promise<{ transferCode: string; status: PaystackTransferStatus }> {
  const { data } = await paystackFetch<{ status: boolean; message: string; data: { transfer_code: string; status: PaystackTransferStatus } }>("/transfer", {
    method: "POST",
    body: JSON.stringify({
      source: "balance",
      amount: params.amountCents,
      recipient: params.recipientCode,
      reason: params.reason,
      currency: "ZAR",
    }),
  });
  return { transferCode: data.transfer_code, status: data.status };
}

/** Polled by jobs/withdrawalPolling.ts — never assume the initiating call's status is final. */
export async function fetchTransferStatus(transferCode: string): Promise<{ status: PaystackTransferStatus; failureReason: string | null }> {
  const { data } = await paystackFetch<{ status: boolean; message: string; data: { status: PaystackTransferStatus; failures?: string | null } }>(
    `/transfer/${encodeURIComponent(transferCode)}`
  );
  return { status: data.status, failureReason: data.failures ?? null };
}
