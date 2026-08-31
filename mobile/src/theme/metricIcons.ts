import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

// Maps MetricTypeDefinition.icon (a backend-owned string token) to a
// concrete glyph. Adding a metric type on the backend with an icon token
// not yet listed here falls back to "stats-chart-outline" rather than
// crashing — the card still renders, just with a generic icon until this
// map is updated.
export const metricIconMap: Record<string, ComponentProps<typeof Ionicons>["name"]> = {
  footprints: "footsteps-outline",
  bike: "bicycle-outline",
  running: "walk-outline",
  waves: "water-outline",
  moon: "moon-outline",
};

export function iconFor(token: string): ComponentProps<typeof Ionicons>["name"] {
  return metricIconMap[token] ?? "stats-chart-outline";
}
