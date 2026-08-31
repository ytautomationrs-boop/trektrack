import { Platform } from "react-native";

/**
 * Where the API lives, resolved once for every client module
 * (client.ts, raceClient.ts, challengeClient.ts).
 *
 * Web deliberately ignores EXPO_PUBLIC_API_URL:
 *
 *  - In a PRODUCTION web build, the bundle is served by the API server
 *    itself (one Node.js web app — see backend/src/server.ts
 *    registerWebApp), so same-origin relative paths are correct by
 *    construction. That is strictly safer than an absolute URL, because
 *    EXPO_PUBLIC_* values are inlined at BUILD time: a bundle built with the
 *    wrong host stays wrong until someone rebuilds it, and nothing at
 *    runtime can tell. Relative paths cannot go stale.
 *
 *  - In web DEV (`expo start --web`), the browser and the API are on the
 *    same machine, so localhost always works. This matters because
 *    EXPO_PUBLIC_API_URL is normally set to 10.0.2.2 — the ANDROID
 *    EMULATOR's alias for the host — which a browser cannot resolve at all.
 *    Hardcoding localhost here is what lets web and Android dev coexist
 *    without editing .env between them.
 *
 * Native keeps reading the env var, because there the API genuinely is on a
 * different host from the app and only the developer knows which (emulator
 * alias, LAN IP, or deployed URL).
 */
function resolveApiBaseUrl(): string {
  if (Platform.OS === "web") {
    return __DEV__ ? "http://localhost:4000" : "";
  }
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
}

export const API_BASE_URL = resolveApiBaseUrl();
