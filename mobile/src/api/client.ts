import { getToken, setToken, clearToken } from "../lib/tokenStorage";
import { request } from "./http";
import type { LedgerEntry, MetricTypeDefinition, PaystackBank, PaystackDepositIntent, ProfileStats, StravaStatus, Wallet, WithdrawDestination } from "./types";

// Shared API calls — auth, metrics, wallet, profile, integrations.
//
// Race and league calls live in ./raceClient.ts; StreakPot's in
// ./challengeClient.ts. All three share ./http.ts — one request helper, one
// auth header, one timeout — and nothing else.
//
// Never hardcode a payment-provider secret key here — the client only ever
// holds an authorization_url handed back from the backend's Paystack call,
// never a secret key or raw card data.

// isAdmin gates whether Create is a live action or a "coming soon" state
// during the pilot — see screens/create/CreateRaceScreen.tsx.
type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  walletBalanceCents: number;
  isAdmin: boolean;
};

export async function login(email: string, password: string) {
  const data = await request<{ token: string; user: SessionUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await setToken(data.token);
  return data.user;
}

/**
 * Pilot invite gate — inviteCode is required; the backend refuses signup
 * without a valid, unused one (see backend/src/modules/auth/schemas.ts).
 * There is no public signup route while the pilot is invite-only.
 */
export async function signUp(input: { email: string; password: string; displayName: string; timezone: string; inviteCode: string }) {
  const data = await request<{ token: string; user: SessionUser }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
  await setToken(data.token);
  return data.user;
}

/** Restores a session from a previously-stored JWT on app launch. Returns null if there's no token or it's no longer valid (expired/revoked). */
export async function restoreSession() {
  const token = await getToken();
  if (!token) return null;
  try {
    const data = await request<{ user: SessionUser }>("/me");
    return data.user;
  } catch {
    await clearToken();
    return null;
  }
}

export async function logout() {
  await clearToken();
}

/** Support address and legal links, set per-deployment. Any of them may be null — the UI hides what isn't configured rather than showing a dead link. */
export function getAppConfig() {
  return request<{ supportEmail: string | null; termsUrl: string | null; privacyUrl: string | null }>("/config");
}

export function updateProfile(input: { displayName?: string; avatarUrl?: string | null; bio?: string | null }) {
  return request<{ user: SessionUser }>("/me/profile", { method: "PATCH", body: JSON.stringify(input) });
}

/** Registers this device's Expo push token. Upserts server-side, so re-registering the same device moves it to the current account rather than duplicating. */
export function registerPushToken(token: string, platform: "IOS" | "ANDROID" | "WEB") {
  return request<{ registered: boolean; id: string }>("/push-tokens", { method: "POST", body: JSON.stringify({ token, platform }) });
}

/** Called on logout so a signed-out device stops receiving that account's notifications. */
export function deregisterPushToken(token: string) {
  return request<{ registered: boolean }>(`/push-tokens/${encodeURIComponent(token)}`, { method: "DELETE" });
}

export function getMetricTypes() {
  return request<{ metricTypes: MetricTypeDefinition[] }>("/metric-types");
}

export function revokeHealthConnection(provider: "HEALTHKIT" | "HEALTH_CONNECT") {
  return request(`/health-connections/${provider}/revoke`, { method: "POST" });
}

export function getLedger() {
  return request<{ entries: LedgerEntry[] }>("/me/ledger");
}

export function getProfileStats() {
  return request<ProfileStats>("/me/stats");
}

// Optional, opt-in Strava integration — cycling/running work fully on
// HealthKit/Health Connect alone without any of these ever being called.
export function getStravaStatus() {
  return request<StravaStatus>("/integrations/strava/status");
}

/** `platform: "web"` picks the WEB_APP_URL-bound callback bridge instead of the native streak:// one — see integrations/strava.ts. */
export function getStravaAuthorizeUrl(platform?: "web") {
  return request<{ url: string }>(`/integrations/strava/authorize-url${platform ? `?platform=${platform}` : ""}`);
}

/** `state` is the CSRF binding minted by /authorize-url — the backend refuses a code without one that was signed for this same account. */
export function connectStrava(code: string, state: string) {
  return request<{ connected: boolean; athleteId: string }>("/integrations/strava/callback", {
    method: "POST",
    body: JSON.stringify({ code, state }),
  });
}

export function disconnectStrava() {
  return request<{ connected: boolean }>("/integrations/strava", { method: "DELETE" });
}

// Wallet/token model — the only place real money moves, and the only
// feature that calls Paystack. See backend/API.md "Wallet".
export function getWallet() {
  return request<Wallet>("/me/wallet");
}

/** Step 1 of depositing — initializes a Paystack transaction; see mobile/src/integrations/paystack.ts for the full browser-checkout flow. */
/** `platform: "web"` makes Paystack redirect back to a real page on WEB_APP_URL rather than the native streak:// scheme — see integrations/paystack.ts. */
export function createPaystackDeposit(amountCents: number, platform: "native" | "web" = "native") {
  return request<PaystackDepositIntent>("/me/wallet/deposit/intent", { method: "POST", body: JSON.stringify({ amountCents, platform }) });
}

/** Step 2 — call only after the Paystack checkout browser session completes. */
export function confirmPaystackDeposit(reference: string) {
  return request<Wallet>("/me/wallet/deposit/confirm", { method: "POST", body: JSON.stringify({ reference }) });
}

/** Real payout via Paystack Transfer or PayPal Payout (both test/sandbox) — see backend/API.md "Wallet". Throws with `err.code === "below_minimum"`, `"insufficient_balance"`, or `"payout_needs_otp"`. */
export function requestWithdrawal(amountCents: number, destination: WithdrawDestination) {
  return request<Wallet>("/me/wallet/withdraw", { method: "POST", body: JSON.stringify({ amountCents, destination }) });
}

/** South African banks for the Paystack withdrawal form's picker. */
export function getPaystackBanks() {
  return request<{ banks: PaystackBank[] }>("/me/wallet/payout-methods/paystack/banks");
}

/** Confirms whose account a bank code + account number resolves to, before the user commits to a Paystack withdrawal. */
export function resolvePaystackAccount(bankCode: string, accountNumber: string) {
  return request<{ accountName: string }>("/me/wallet/payout-methods/paystack/resolve", {
    method: "POST",
    body: JSON.stringify({ bankCode, accountNumber }),
  });
}
