import type { MetricTypeDefinition } from "../api/types";

/**
 * Distance is always stored and compared in metres, everywhere — schema
 * fields, health samples, anti-fraud pace checks. This is the one place that
 * converts for display: km where the metric's `unit` says "km"
 * (running/cycling — "5.2 km" reads better), raw metres otherwise
 * (swimming — "1000m" reads better than "1.0km").
 */
export function formatDistance(meters: number, unit: string): string {
  if (unit === "km") return (meters / 1000).toFixed(1);
  return Math.round(meters).toLocaleString();
}

/** Full "value + unit" label — counts display raw, distance metrics convert. */
export function formatMetricValue(value: number, metric: Pick<MetricTypeDefinition, "unit" | "valueType">): string {
  if (metric.valueType === "DISTANCE_METERS") return `${formatDistance(value, metric.unit)} ${metric.unit}`;
  return `${value.toLocaleString()} ${metric.unit}`;
}
