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
const getCache = new Map<string, { expiresAt: number; value: unknown }>();

export type ApiError = Error & {
  /** Server-supplied slug, e.g. "insufficient_balance". Absent on network/timeout failures. */
  code?: string;
  status?: number;
  /** True when the request never reached the server (offline, DNS, timeout) — the caller can reasonably offer a retry. */
  isNetworkError?: boolean;
};

async function authHeader(): Promise<Record<string, string>> {
  const token = await getToken();
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
  for (const key of getCache.keys()) {
    if (!pathPrefix || key.startsWith(pathPrefix)) getCache.delete(key);
  }
  for (const key of inFlightGets.keys()) {
    if (!pathPrefix || key.startsWith(pathPrefix)) inFlightGets.delete(key);
  }
}

export async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};
  const method = (rest.method ?? "GET").toUpperCase();
  const isCacheableGet = method === "GET" && rest.body == null && !rest.headers;
  const token = await getToken();
  const cacheKey = `${path}::${token ?? "anonymous"}`;
  const generation = cacheGeneration;

  if (isCacheableGet) {
    const cached = getCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    const pending = inFlightGets.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }

  const run = async () => {
    const result = await requestUncached<T>(path, { ...rest, timeoutMs });
    if (isCacheableGet && generation === cacheGeneration && token === await getToken()) {
      getCache.set(cacheKey, { value: result, expiresAt: Date.now() + GET_CACHE_TTL_MS });
    } else if (method !== "GET") {
      clearApiCache();
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

async function requestUncached<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const auth = await authHeader();
  const wasAuthenticated = "Authorization" in auth;
  const headers = { ...(rest.body == null ? {} : { "Content-Type": "application/json" }), ...auth, ...(rest.headers ?? {}) };

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers,
    });
  } catch (err) {
    // Distinguish "we gave up waiting" from "the network refused" — they read
    // very differently to a user deciding whether to try again.
    const aborted = err instanceof Error && err.name === "AbortError";
    const wrapped: ApiError = new Error(
      aborted
        ? "That took too long to respond. Check your connection and try again."
        : "Couldn't reach ASTA. Check your connection and try again."
    );
    wrapped.isNetworkError = true;
    // Hostinger can cold-start after sitting idle. Retry reads once before
    // showing an error; mutations are never repeated automatically.
    if ((rest.method ?? "GET").toUpperCase() === "GET" && timeoutMs === DEFAULT_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return requestUncached<T>(path, { ...rest, timeoutMs: DEFAULT_TIMEOUT_MS + 5_000 });
    }
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  if (res.status >= 500 && (rest.method ?? "GET").toUpperCase() === "GET" && timeoutMs === DEFAULT_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return requestUncached<T>(path, { ...rest, timeoutMs: DEFAULT_TIMEOUT_MS + 5_000 });
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      body.message ??
      (body.error === "invalid_credentials" ? "That email or password is incorrect." : `Request failed: ${res.status}`);
    const err: ApiError = new Error(message);
    err.code = body.error;
    err.status = res.status;

    // Only when a token was actually sent — a 401 from /auth/login is a
    // wrong password, not an expired session, and clearing state there
    // would be nonsense.
    if (res.status === 401 && wasAuthenticated) onSessionExpired?.();

    throw err;
  }

  // 204 and other empty bodies are valid responses; json() would throw on them.
  if (res.status === 204) return undefined as T;
  return res.json();
}
