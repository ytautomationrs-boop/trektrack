import {syncWatchSession} from './watch';
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
const SESSION_KEY = "asta_session";
let memoryToken: string | null | undefined;

export type StoredSession = {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  bio: string | null;
  isAdmin: boolean;
};

export async function getToken(): Promise<string | null> {
  if (memoryToken !== undefined) return memoryToken;

  if (Platform.OS === "web") {
    try {
      const token = window.localStorage.getItem(KEY);
      if (token) {
        memoryToken = token;
        return token;
      }
      const legacyToken = window.localStorage.getItem(LEGACY_KEY);
      if (!legacyToken) {
        memoryToken = null;
        return null;
      }
      window.localStorage.setItem(KEY, legacyToken);
      window.localStorage.removeItem(LEGACY_KEY);
      memoryToken = legacyToken;
      return legacyToken;
    } catch {
      memoryToken = null;
      return null; // private-browsing / storage disabled
    }
  }
  memoryToken = await SecureStore.getItemAsync(KEY);
  return memoryToken;
}

export async function setToken(token: string): Promise<void> {
  memoryToken = token;
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
  memoryToken = null;
  void syncWatchSession(null);
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

export function getStoredSession(): StoredSession | null {
  if (Platform.OS !== "web") return null;
  try {
    const value = window.localStorage.getItem(SESSION_KEY);
    return value ? (JSON.parse(value) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function setStoredSession(session: StoredSession | null): void {
  if (Platform.OS !== "web") return;
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // A private browser may deny storage. The app still works for this run.
  }
}
