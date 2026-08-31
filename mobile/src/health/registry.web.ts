import { WebUnavailableAdapter } from "./adapters/webUnavailable";
import type { HealthAdapter } from "./types";

// Metro's platform-extension resolution picks THIS file for web builds
// instead of registry.ts — see the comment there for why a runtime branch
// isn't sufficient. This file must never import healthkit.ts / healthConnect.ts.

let cached: HealthAdapter | null = null;

export function getHealthAdapter(): HealthAdapter {
  if (!cached) cached = new WebUnavailableAdapter();
  return cached;
}
