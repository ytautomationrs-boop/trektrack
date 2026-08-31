import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { createPaystackDeposit, confirmPaystackDeposit } from "../api/client";
import type { Wallet } from "../api/types";

// Must match the callback_url the backend passes to Paystack at initialize
// time. expo-web-browser's openAuthSessionAsync watches for a redirect to
// this scheme and closes the browser itself — same pattern as the Strava
// OAuth flow (src/integrations/strava.ts). No native Paystack SDK needed:
// this is Paystack's hosted checkout page, not an in-app card sheet.
const REDIRECT_SCHEME = "streak://paystack-callback";

// Survives the full page navigation the web flow does — see the web branch
// below for why the amount can't just be held in React state.
const PENDING_KEY = "streak_pending_deposit_ref";

export type PaystackDepositResult =
  | { status: "success"; wallet: Wallet }
  | { status: "cancelled" }
  | { status: "error"; message: string }
  // Web only: a top-level redirect to Paystack's checkout just started, so
  // this call has no result to return (the page is about to unload).
  // PaystackCallbackScreen confirms the deposit once Paystack redirects back.
  | { status: "redirecting" };

/**
 * Opens Paystack's hosted checkout for a deposit.
 *
 * On native this completes end-to-end: the transaction reference is known
 * from step 1 (Paystack returns it at initialize time, before the browser
 * even opens), so the browser session's outcome is enough to decide whether
 * to verify.
 *
 * On web there is no in-app browser session to await — the tab navigates
 * fully away to Paystack and fully back, tearing down this JS context. So
 * the reference is stashed in localStorage first and the confirm happens in
 * PaystackCallbackScreen after the return trip. (Paystack does echo
 * ?reference= back on the redirect, but the stashed copy is what lets the
 * callback screen distinguish "a deposit I started" from an arbitrary URL.)
 */
export async function depositViaPaystack(amountCents: number): Promise<PaystackDepositResult> {
  if (Platform.OS === "web") {
    try {
      const { authorizationUrl, reference } = await createPaystackDeposit(amountCents, "web");
      try {
        window.localStorage.setItem(PENDING_KEY, reference);
      } catch {
        // Storage blocked (private mode). The callback screen falls back to
        // the ?reference= Paystack puts on the redirect, so this is a
        // degraded-but-working path rather than a failure.
      }
      window.location.href = authorizationUrl;
      return { status: "redirecting" };
    } catch (err: any) {
      return { status: "error", message: err.message ?? "Couldn't start the deposit." };
    }
  }

  try {
    const { authorizationUrl, reference } = await createPaystackDeposit(amountCents, "native");
    const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, REDIRECT_SCHEME);

    if (result.type !== "success") return { status: "cancelled" };

    const wallet = await confirmPaystackDeposit(reference);
    return { status: "success", wallet };
  } catch (err: any) {
    return { status: "error", message: err.message ?? "Couldn't complete deposit." };
  }
}

/** Web only — the reference stashed before redirecting to Paystack's checkout. */
export function readPendingDepositReference(): string | null {
  try {
    return window.localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearPendingDepositReference(): void {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing to clear */
  }
}
