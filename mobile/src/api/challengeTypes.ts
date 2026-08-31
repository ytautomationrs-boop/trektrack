// StreakPot — pooled-stake challenges. Mirrors backend/src/modules/challenges/**
// by hand, same convention as raceTypes.ts mirrors modules/races.
//
// Kept fully separate from raceTypes.ts on purpose: the two models share
// nothing but the auth token and the request helper, and mixing their types
// would blur the exact distinction that matters (fixed prize vs. pooled
// stake) at the one layer — the client — where a reader can't fall back on
// "well, check the database" to tell them apart.

export type ChallengeVisibility = "PUBLIC" | "INVITE_ONLY";
export type ChallengeStatus = "DRAFT" | "OPEN" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type ChallengeMode = "SOLO" | "SQUAD";
export type ChallengeEliminationScope = "INDIVIDUAL" | "WHOLE_GROUP";
export type ChallengeParticipantStatus = "ACTIVE" | "ELIMINATED" | "WITHDRAWN" | "FINISHED";
export type DailyCheckInResult = "PENDING" | "PASSED" | "FAILED" | "SYNC_ISSUE";

export type ChallengeMetricRequirement = {
  metricKey: string;
  displayName: string;
  unit: string;
  dailyTarget: number;
  paceTargetSecPerKm: number | null;
  startTimeMinutes: number | null;
  endTimeMinutes: number | null;
};

export type Challenge = {
  id: string;
  title: string;
  durationDays: number;
  startDate: string;
  stakeCents: number;
  currency: string;
  visibility: ChallengeVisibility;
  status: ChallengeStatus;
  mode: ChallengeMode;
  maxParticipants: number | null;
  eliminationScope: ChallengeEliminationScope | null;
  tier: string | null;
  metricRequirements: ChallengeMetricRequirement[];
  participantCount: number;
  hasJoined: boolean;
  myStatus: ChallengeParticipantStatus | null;
  /** Consecutive days passed so far. Null if you were never a participant, 0 is a real "day one" or post-elimination value. */
  myCurrentStreak: number | null;
  /** Only present once you've joined — same "the code is the invitation" pattern as Race. */
  inviteCode: string | null;
};

export type ChallengeParticipant = {
  id: string;
  challengeId: string;
  userId: string;
  status: ChallengeParticipantStatus;
  timezone: string;
  joinedAt: string;
  eliminatedOnDay: number | null;
  currentStreak: number;
  stakeCents: number;
  redemptionPurchased: boolean;
  redemptionUsed: boolean;
};

export type JoinChallengeResult = { participant: ChallengeParticipant; challenge: Challenge };
export type WithdrawChallengeResult = { withdrawn: true; refundedCents: number };
export type PurchaseRedemptionResult = { purchased: true; feeCents: number };

export type CheckInIngestResult = {
  accepted: number;
  rejected: Array<{ reasonCode: string; reason: string }>;
  flagsRaised: number;
  dayResult: DailyCheckInResult;
};

export type ChallengeInvite = { id: string; challengeId: string; code: string; inviteeEmail: string | null; status: string };

export type ChallengeHistoryEntry = {
  id: string;
  challengeId: string;
  status: ChallengeParticipantStatus;
  stakeCents: number;
  currentStreak: number;
  eliminatedOnDay: number | null;
  redemptionPurchased: boolean;
  redemptionUsed: boolean;
  joinedAt: string;
  challenge: {
    id: string;
    title: string;
    status: ChallengeStatus;
    durationDays: number;
    mode: ChallengeMode;
    metricRequirements: Array<{ metricKey: string; dailyTarget: number }>;
  };
};

/**
 * StreakPot's view of a metric — the counterpart to MetricTypeDefinition in
 * types.ts, which is race-only. Includes sleep, and carries the daily-target
 * configuration a challenge's creation flow needs and a race has no use for.
 */
export type StreakPotMetricType = {
  key: string;
  displayName: string;
  unit: string;
  valueType: string;
  icon: string;
  minTarget: number | null;
  maxTarget: number | null;
  defaultTarget: number | null;
  beginnerTarget: number | null;
  advancedTarget: number | null;
  stepSize: number | null;
  supportsPaceTarget: boolean;
  vizType: string | null;
};

/** What a creator picks — see backend/src/modules/challenges/schemas.ts CreateChallengeSchema. Pilot: admin-only. */
export type CreateChallengeInput = {
  title: string;
  durationDays: number;
  startDate: string; // ISO
  stakeCents: number;
  visibility: ChallengeVisibility;
  mode: ChallengeMode;
  maxParticipants?: number;
  eliminationScope?: ChallengeEliminationScope;
  metricRequirements: Array<{
    metricKey: "steps" | "running" | "cycling" | "swimming" | "sleep";
    dailyTarget: number;
    paceTargetSecPerKm?: number;
    startTimeMinutes?: number;
    endTimeMinutes?: number;
  }>;
};
