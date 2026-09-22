import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// expo-secure-store has no web implementation (it throws if called there).
// The web pilot keeps the JWT in localStorage instead — a normal, accepted
// tradeoff for a web app; it loses the OS-keychain protection SecureStore
// gives native, but that protection was never available to a browser tab
// anyway. Every other caller in the app goes through this one module rather
// than branching on Platform.OS itself.
const KEY = "asta_jwt";
const LEGACY_KEY = "streak_jwt";

export async function getToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      const token = window.localStorage.getItem(KEY);
      if (token) return token;
      const legacyToken = window.localStorage.getItem(LEGACY_KEY);
      if (!legacyToken) return null;
      window.localStorage.setItem(KEY, legacyToken);
      window.localStorage.removeItem(LEGACY_KEY);
      return legacyToken;
    } catch {
      return null; // private-browsing / storage disabled
    }
  }
  return SecureStore.getItemAsync(KEY);
}

export async function setToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      window.localStorage.setItem(KEY, token);
      window.localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Storage unavailable — the session simply won't persist across a
      // reload, which is a degraded-but-safe outcome, not a crash.
    }
    return;
  }
  await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === "web") {
    try {
      window.localStorage.removeItem(KEY);
      window.localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* nothing to clear */
    }
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}
