import { Platform } from "react-native";
import { HealthKitAdapter } from "./adapters/healthkit";
import { HealthConnectAdapter } from "./adapters/healthConnect";
import type { HealthAdapter } from "./types";

// Native only (ios/android) — see registry.web.ts for the web build. This
// file must never be reachable from a web bundle: both adapters below touch
// their native module (react-native-health / react-native-health-connect)
// at import time, which has no web implementation. Metro's platform
// extension resolution (this file vs. registry.web.ts) is what keeps them
// out of the web bundle — a runtime Platform.OS branch here would NOT be
// enough, since Metro still bundles every statically-imported module
// regardless of which runtime branch actually executes.

let cached: HealthAdapter | null = null;

/** One adapter per device platform — this is the entire "pluggable" seam; nothing else in the app imports react-native-health / react-native-health-connect directly. */
export function getHealthAdapter(): HealthAdapter {
  if (cached) return cached;
  cached = Platform.OS === "ios" ? new HealthKitAdapter() : new HealthConnectAdapter();
  return cached;
}
