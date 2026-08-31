import { z } from "zod";

// What the mobile app sends after reading from HealthKit / Health Connect.
// This mirrors the platform's own record shape closely on purpose — we want
// the mobile adapter layer to do minimal transformation, so there's less
// surface area for a "translation bug" to accidentally launder a bad value.
export const HealthSampleInputSchema = z.object({
  metricKey: z.string().min(1),
  value: z.number().nonnegative(),
  unit: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  deviceId: z.string().optional(),

  sourceBundleId: z.string().min(1),
  sourceName: z.string().min(1),
  wasManualEntry: z.boolean(),
  isWearableSourced: z.boolean(),

  // Shape depends on dataSourceCategory — validated by the rule registry,
  // not by this generic transport schema.
  corroboration: z.record(z.unknown()).optional(),
});

export const SubmitSamplesSchema = z.object({
  samples: z.array(HealthSampleInputSchema).min(1).max(200),
});

export type HealthSampleInput = z.infer<typeof HealthSampleInputSchema>;
