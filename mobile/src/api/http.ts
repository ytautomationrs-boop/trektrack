import { getToken } from "../lib/tokenStorage";
import { API_BASE_URL } from "./config";

/**
 * The one HTTP helper every API module uses.
 *
 * Previously client.ts, raceClient.ts and challengeClient.ts each carried
 * their own near-identical copy, which is how the timeout below came to be
 * missing from all three at once.
 *
 * ## Timeouts
 *
 * `fetch` has no default timeout. On a flaky mobile connection a request can
 * hang indefinitely, and since every screen drives its spinner off the
 * promise, the app shows a spinner forever with no way back — the user's only
 * recourse is force-quitting. A bounded wait that surfaces a retryable error
 * is strictly better than an unbounded one that surfaces nothing.
 */

/** Long enough for normal mobile latency, short enough that a hung request doesn't strand the UI. */
const DEFAULT_TIMEOUT_MS = 15_000;
const GET_CACHE_TTL_MS = 30_000;
const inFlightGets = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;
type CacheEntry = { expiresAt: number; previewUntil: number; value: unknown };
const getCache = new Map<string, CacheEntry>();
const PREVIEW_KEY = "asta_browse_cache_v1";
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
// Only browsing data may survive a launch. Wallets, messages, admin data and
// authentication responses always stay out of this persistent preview cache.
const previewPaths = new Set(["/races?scope=my_league", "/races?scope=all", "/me/leagues", "/social-events", "/me/stats"]);
let hydratedToken: string | null | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export type ReadOptions<T> = {
  cacheMode?: "default" | "reload";
  /** Paint a saved preview while the returned promise fetches current data. */
  onCached?: (value: T) => void;
};

function hydratePreviews(token: string | null) {
  if (hydratedToken === token) return;
  hydratedToken = token;
  if (!token || typeof window === "undefined") return;
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREVIEW_KEY) ?? "null");
    if (saved?.owner !== token || !Array.isArray(saved.entries)) return;
    for (const [path, entry] of saved.entries) {
      if (previewPaths.has(path) && entry.previewUntil > Date.now()) {
        // A new launch always revalidates; disk content is only a preview.
        getCache.set(`${path}::${token}`, { ...entry, expiresAt: 0 });
      }
    }
  } catch { /* Browsing still works if storage is unavailable or corrupt. */ }
}

function savePreviews(token: string | null) {
  if (!token || typeof window === "undefined") return;
  clearTimeout(saveTimer);
  // Keep serialization off the first render and bound storage on small phones.
  saveTimer = setTimeout(() => {
    if (hydratedToken !== token) return;
    try {
      const entries: Array<[string, CacheEntry]> = [];
      let bytes = 0;
      for (const path of previewPaths) {
        const entry = getCache.get(`${path}::${token}`);
        if (!entry || entry.previewUntil <= Date.now()) continue;
        const size = JSON.stringify(entry).length;
        if (bytes + size > 750_000) continue;
        entries.push([path, entry]);
        bytes += size;
      }
      window.localStorage.setItem(PREVIEW_KEY, JSON.stringify({ owner: token, entries }));
    } catch { /* Storage quota must never block the app. */ }
  }, 250);
}

export type ApiError = Error & {
  /** Server-supplied slug, e.g. "insufficient_balance". Absent on network/timeout failures. */
  code?: string;
  status?: number;
  /** True when the request never reached the server (offline, DNS, timeout) — the caller can reasonably offer a retry. */
  isNetworkError?: boolean;
};

async function authHeader(token: string | null): Promise<Record<string, string>> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let onSessionExpired: (() => void) | null = null;

/**
 * Registered once by App.tsx. Called when a request that DID carry a token
 * comes back 401 — the token is no longer good (expired, or the account is
 * gone), so the session is over and the app should return to sign-in rather
 * than leave the user staring at an error they can't act on.
 *
 * Deliberately a registered callback rather than an import of the app state:
 * that module imports the API client, so importing it back here would be a
 * cycle.
 */
export function setSessionExpiredHandler(fn: (() => void) | null) {
  onSessionExpired = fn;
}

export function clearApiCache(pathPrefix?: string) {
  cacheGeneration++;
  clearTimeout(saveTimer);
  if (typeof window !== "undefined" && (!pathPrefix || [...previewPaths].some(path=>path.startsWith(pathPrefix)))) {
    try { window.localStorage.removeItem(PREVIEW_KEY); } catch { /* optional */ }
  }
  for (const key of getCache.keys()) {
    if (!pathPrefix || key.startsWith(pathPrefix)) getCache.delete(key);
  }
  for (const key of inFlightGets.keys()) {
    if (!pathPrefix || key.startsWith(pathPrefix)) inFlightGets.delete(key);
  }
}

export async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number } & ReadOptions<T>): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, cacheMode = "default", onCached, ...rest } = init ?? {};
  const method = (rest.method ?? "GET").toUpperCase();
  const isCacheableGet = method === "GET" && rest.body == null && !rest.headers;
  const token = await getToken();
  hydratePreviews(token);
  const cacheKey = `${path}::${token ?? "anonymous"}`;
  const generation = cacheGeneration;

  if (isCacheableGet) {
    const cached = getCache.get(cacheKey);
    if (cached && cached.previewUntil > Date.now()) onCached?.(cached.value as T);
    if (cacheMode !== "reload" && cached && cached.expiresAt > Date.now()) return cached.value as T;
    const pending = inFlightGets.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }

  const run = async () => {
    const result = await requestUncached<T>(path, { ...rest, timeoutMs }, token);
    if (isCacheableGet && generation === cacheGeneration && token === await getToken()) {
      getCache.set(cacheKey, { value: result, expiresAt: Date.now() + GET_CACHE_TTL_MS, previewUntil: Date.now() + PREVIEW_TTL_MS });
      if (previewPaths.has(path)) savePreviews(token);
    } else if (method !== "GET") {
      if(path.startsWith('/notifications/'))clearApiCache('/notifications');
      else if(path.startsWith('/messages/'))clearApiCache('/messages');
      else if(path.startsWith('/social-events'))clearApiCache('/social-events');
      else if(path.startsWith('/push-tokens')) { /* Device registration changes no screen data. */ }
      else clearApiCache();
    }
    return result;
  };

  if (!isCacheableGet) return run();

  const pending = run().finally(() => {
    if (inFlightGets.get(cacheKey) === pending) inFlightGets.delete(cacheKey);
  });
  inFlightGets.set(cacheKey, pending);
  return pending;
}

async function requestUncached<T>(path: string, init: RequestInit & { timeoutMs?: number }, token: string | null): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const auth = await authHeader(token);
  const wasAuthenticated = "Authorization" in auth;
  const headers = { ...(rest.body == null ? {} : { "Content-Type": "application/json" }), ...auth, ...(rest.headers ?? {}) };

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers,
    });
    const body = res.status === 204 ? undefined : await res.json().catch((error) => {
      if (controller.signal.aborted) throw error;
      if (res.ok) throw error;
      return {};
    });
    if (!res.ok) {
      const error: ApiError = new Error(body?.message ??
        (body?.error === "invalid_credentials" ? "That email or password is incorrect." : `Request failed: ${res.status}`));
      error.code = body?.error;
      error.status = res.status;
      if (res.status === 401 && wasAuthenticated && token === await getToken()) onSessionExpired?.();
      throw error;
    }
    return body as T;
  } catch (error) {
    clearTimeout(timer);
    const status = (error as ApiError).status;
    const isRead = (rest.method ?? "GET").toUpperCase() === "GET";
    const retryable = status ? status >= 500 : true;
    if (isRead && retryable && timeoutMs === DEFAULT_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return requestUncached<T>(path, { ...rest, timeoutMs: DEFAULT_TIMEOUT_MS + 5_000 }, token);
    }
    if (status) throw error;
    const wrapped: ApiError = new Error(controller.signal.aborted
      ? "ASTA is taking longer than expected. Please try again."
      : "Couldn't reach ASTA. Check your connection and try again.");
    wrapped.isNetworkError = true;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}
