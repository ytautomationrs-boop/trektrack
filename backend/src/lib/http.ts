const DEFAULT_EXTERNAL_FETCH_TIMEOUT_MS = 15_000;

export function withExternalFetchTimeout(init: RequestInit = {}, timeoutMs = DEFAULT_EXTERNAL_FETCH_TIMEOUT_MS): RequestInit {
  if (init.signal) return init;
  return { ...init, signal: AbortSignal.timeout(timeoutMs) };
}
