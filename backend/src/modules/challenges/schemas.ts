import { z } from "zod";
import { HealthSampleInputSchema } from "../health/schemas.js";

/**
 * Creating a challenge. Pilot: admin-only (see requireAdmin) — everyone can
 * still join/check-in/leave normally.
 *
 * metricRequirements is an ARRAY on purpose: a multi-metric challenge (e.g.
 * "8000 steps AND 30 minutes of sleep tracked") requires more than one row,
 * and a day only passes if every required metric passes.
 */
export const ChallengeMetricRequirementSchema = z.object({
  metricKey: z.enum(["steps", "running", "cycling", "swimming", "sleep"]),
  dailyTarget: z.number().positive(),
  // Only meaningful for metrics with supportsPaceTarget — a personal floor,
  // never a ranking input (there is no ranking in StreakPot).
  paceTargetSecPerKm: z.number().positive().optional(),
  // Optional time-of-day window, minutes since local midnight.
  startTimeMinutes: z.number().int().min(0).max(1439).optional(),
  endTimeMinutes: z.number().int().min(0).max(1439).optional(),
});

export const CreateChallengeSchema = z
  .object({
    title: z.string().trim().min(3).max(60),
    durationDays: z.number().int().min(1).max(90),
    // ISO date-time — when the challenge moves OPEN -> ACTIVE and daily
    // scoring begins. Must be in the future at creation time.
    startDate: z.string().datetime(),
    stakeCents: z.number().int().positive(),
    currency: z.string().default("zar"),
    visibility: z.enum(["PUBLIC", "INVITE_ONLY"]).default("INVITE_ONLY"),
    mode: z.enum(["SOLO", "SQUAD"]),
    maxParticipants: z.number().int().positive().max(500).optional(),
    // Required for SQUAD, ignored for SOLO.
    eliminationScope: z.enum(["INDIVIDUAL", "WHOLE_GROUP"]).optional(),
    tier: z.string().trim().max(30).optional(),
    metricRequirements: z.array(ChallengeMetricRequirementSchema).min(1).max(4),
  })
  .refine((b) => b.mode !== "SQUAD" || !!b.eliminationScope, {
    message: "eliminationScope is required for a SQUAD challenge.",
    path: ["eliminationScope"],
  })
  // Squad challenges are not implementable yet and must not be created.
  //
  // The schema carries `mode` and `eliminationScope`, but unlike races there
  // is no squad entity — no ChallengeSquad table, no slots, no captain, no
  // invite code — so there is no way to form a squad, and no way for
  // WHOLE_GROUP elimination to know whose squad to eliminate (see
  // resolution.ts eliminateParticipant). Accepting one here would create a
  // challenge people could stake real money into and never take part in
  // properly.
  .refine((b) => b.mode !== "SQUAD", {
    message: "Squad challenges aren't available yet — squads can't be formed, so there'd be no way to take part properly. Create a solo challenge instead.",
    path: ["mode"],
  });

export type CreateChallengeInput = z.infer<typeof CreateChallengeSchema>;

export const JoinChallengeSchema = z.object({
  // Required for an INVITE_ONLY challenge; ignored for PUBLIC.
  inviteCode: z.string().min(4).max(32).optional(),
});

export const CreateChallengeInviteSchema = z.object({
  inviteeEmail: z.string().email().optional(),
});

export const SubmitCheckInSamplesSchema = z.object({
  // Which local calendar day this batch is for, e.g. "2026-08-26" — the
  // client knows its own local date; the server never derives "today" from
  // its own clock, which could be a different day than the participant's.
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  samples: z.array(HealthSampleInputSchema).min(1).max(200),
});

export const ListChallengesQuerySchema = z.object({
  scope: z.enum(["mine", "discover"]).default("discover"),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export type ListChallengesQuery = z.infer<typeof ListChallengesQuerySchema>;
