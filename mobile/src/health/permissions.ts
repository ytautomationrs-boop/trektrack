import { getHealthAdapter } from "./registry";
import type { DataSourceCategory, PermissionResult } from "./types";

export type ConnectHealthOutcome = "connected" | "partially_denied" | "denied" | "unavailable";

/** Drives the onboarding connect-health step's simulated-connecting → result states. */
export async function connectHealth(categories: DataSourceCategory[]): Promise<{ outcome: ConnectHealthOutcome; result: PermissionResult }> {
  const adapter = getHealthAdapter();

  const available = await adapter.isAvailable();
  if (!available) {
    return { outcome: "unavailable", result: { granted: [], denied: categories } };
  }

  const result = await adapter.requestPermissions(categories);
  const outcome: ConnectHealthOutcome =
    result.denied.length === 0 ? "connected" : result.granted.length === 0 ? "denied" : "partially_denied";

  return { outcome, result };
}
