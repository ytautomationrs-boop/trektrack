import { env } from "../../lib/env.js";
import { withExternalFetchTimeout } from "../../lib/http.js";

// The other withdrawal method alongside Paystack Transfers (paystackService.ts)
// — PayPal sandbox only. Payouts always send in ZAR (the wallet's single
// currency, same as everywhere else in this app); whether the receiving
// PayPal account actually settles in ZAR or converts is between PayPal and
// the recipient, not something this backend controls — see the fee
// disclosure shown in the withdrawal UI before the user confirms.

const PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * OAuth2 client-credentials grant, cached until shortly before expiry
 * (PayPal tokens are typically valid ~9h) so a withdrawal flow doesn't
 * re-authenticate on every call.
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const basicAuth = Buffer.from(`${env.PAYPAL_SANDBOX_CLIENT_ID}:${env.PAYPAL_SANDBOX_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, withExternalFetchTimeout({
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }));
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`PayPal auth error: ${body.error_description ?? res.statusText}`);
  }

  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function paypalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}${path}`, withExternalFetchTimeout({
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  }));
  const body = (await res.json()) as T & { message?: string; name?: string; details?: Array<{ issue?: string; description?: string; field?: string }> };
  if (!res.ok) {
    // PayPal's top-level `message` ("Invalid request - see details") is
    // rarely the actual problem — the real reason lives in `details[]`.
    const detail = body.details?.map((d) => [d.field, d.issue, d.description].filter(Boolean).join(": ")).join("; ");
    throw new Error(`PayPal API error: ${detail || body.message || body.name || res.statusText}`);
  }
  return body;
}

/** cents → PayPal's decimal string amount format ("1987" -> "19.87"). */
function centsToDecimalString(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

/**
 * Submits a single-item payout batch to the receiver's PayPal email.
 * `senderBatchId` must be unique per attempt — the withdrawal's own id is
 * used so a retried call for the same withdrawal can't accidentally create
 * two payouts (PayPal treats a duplicate sender_batch_id as the same
 * batch rather than creating a new one).
 */
export async function createPayout(params: { withdrawalId: string; amountCents: number; receiverEmail: string; note: string }): Promise<{ payoutBatchId: string; payoutItemId: string | null }> {
  const res = await paypalFetch<{
    batch_header: { payout_batch_id: string; batch_status: string };
    items?: Array<{ payout_item_id: string }>;
  }>("/v1/payments/payouts", {
    method: "POST",
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: params.withdrawalId,
        email_subject: "You have a payout from Streak!",
        email_message: params.note,
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: { value: centsToDecimalString(params.amountCents), currency: "ZAR" },
          receiver: params.receiverEmail,
          note: params.note,
          sender_item_id: params.withdrawalId,
        },
      ],
    }),
  });
  return { payoutBatchId: res.batch_header.payout_batch_id, payoutItemId: res.items?.[0]?.payout_item_id ?? null };
}

export type PayPalItemStatus = "SUCCESS" | "FAILED" | "PENDING" | "UNCLAIMED" | "RETURNED" | "ONHOLD" | "BLOCKED" | "REFUNDED" | "REVERSED";

/** Polled by jobs/withdrawalPolling.ts — a batch with one item resolves via that item's own transaction_status, not just the batch-level status. */
export async function getPayoutStatus(payoutBatchId: string): Promise<{ itemStatus: PayPalItemStatus; failureReason: string | null }> {
  const res = await paypalFetch<{
    items: Array<{ transaction_status: PayPalItemStatus; errors?: { message?: string } }>;
  }>(`/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
  const item = res.items[0];
  if (!item) throw new Error(`PayPal payout ${payoutBatchId} has no items`);
  return { itemStatus: item.transaction_status, failureReason: item.errors?.message ?? null };
}
