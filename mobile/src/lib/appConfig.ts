import { useEffect, useState } from "react";
import { getAppConfig } from "../api/client";

/**
 * Deployment config, fetched once and shared.
 *
 * `GET /config` is unauthenticated and static for the life of a deploy, so
 * refetching it per screen is pure waste — and the wallet in particular
 * needs it before its first paint to know whether to offer a deposit at all.
 *
 * Cached at module scope rather than in state so a screen that mounts later
 * gets the answer synchronously instead of flashing the wrong wallet.
 */

export type AppConfig = {
  supportEmail: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  /** Pilot: false. Nobody pays in — balances are granted (see backend GrantSponsoredCreditSchema). */
  depositsEnabled: boolean;
  /** Pilot: false. Withdrawals are queued for an admin to send by hand as an EFT. */
  automatedPayoutsEnabled: boolean;
};

/**
 * What to assume before the server answers, and if it never does.
 *
 * Both money flags default to OFF, which is the safe direction: showing a
 * deposit button that the server refuses is worse than briefly hiding one
 * that works, and it fails closed on a deployment too old to send them.
 */
const FALLBACK: AppConfig = {
  supportEmail: null,
  termsUrl: null,
  privacyUrl: null,
  depositsEnabled: false,
  automatedPayoutsEnabled: false,
};

let cached: AppConfig | null = null;
let inFlight: Promise<AppConfig> | null = null;

export function loadAppConfig(): Promise<AppConfig> {
  if (cached) return Promise.resolve(cached);
  // Share one request between callers that mount together, rather than
  // firing the same fetch from every screen on first paint.
  inFlight ??= getAppConfig()
    .then((c) => {
      cached = { ...FALLBACK, ...c };
      return cached;
    })
    .catch(() => FALLBACK)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Clears the cache — for logout, so a different deployment isn't read from a stale one. */
export function resetAppConfig() {
  cached = null;
}

export function useAppConfig(): AppConfig {
  const [config, setConfig] = useState<AppConfig>(cached ?? FALLBACK);

  useEffect(() => {
    let alive = true;
    loadAppConfig().then((c) => {
      if (alive) setConfig(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  return config;
}
