// StreakPot — API calls. Separate module from client.ts/raceClient.ts for
// the same reason those two are separate from each other: they share
// ./http.ts and nothing else.

import type { RawSample } from "../health/types";
import type {
  Challenge,
  ChallengeHistoryEntry,
  ChallengeInvite,
  CheckInIngestResult,
  CreateChallengeInput,
  JoinChallengeResult,
  PurchaseRedemptionResult,
  StreakPotMetricType,
  WithdrawChallengeResult,
} from "./challengeTypes";

import { request } from "./http";

/** StreakPot's metric registry — includes sleep and the daily-target config, unlike the race-only /metric-types. */
export function getStreakPotMetricTypes() {
  return request<{ metricTypes: StreakPotMetricType[] }>("/streakpot/metric-types");
}

/** `scope: "discover"` (default) is every open PUBLIC challenge; `"mine"` is every challenge you've ever joined, any status. */
export function getChallenges(params: { scope?: "mine" | "discover"; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (params.scope) q.set("scope", params.scope);
  if (params.limit) q.set("limit", String(params.limit));
  const suffix = q.toString() ? `?${q}` : "";
  return request<{ challenges: Challenge[] }>(`/challenges${suffix}`);
}

export function getChallenge(challengeId: string) {
  return request<Challenge>(`/challenges/${challengeId}`);
}

export function lookUpChallengeCode(code: string) {
  return request<{ challenge: Challenge }>(`/challenges/by-code/${encodeURIComponent(code.trim().toLowerCase())}`);
}

/**
 * Creates a challenge. Pilot: admin-only — regular accounts get
 * `err.code === "admin_only"`.
 */
export function createChallenge(input: CreateChallengeInput) {
  return request<{ challenge: Challenge }>("/challenges", { method: "POST", body: JSON.stringify(input) });
}

/**
 * Joins a challenge, staking its fixed amount immediately.
 *
 * Throws with `err.code === "insufficient_balance"` (402), `"challenge_not_open"`,
 * `"invalid_invite_code"` (403), `"already_joined"`, `"challenge_full"`.
 */
export function joinChallenge(challengeId: string, inviteCode?: string) {
  return request<JoinChallengeResult>(`/challenges/${challengeId}/join`, { method: "POST", body: JSON.stringify({ inviteCode }) });
}

/** Only while the challenge is still OPEN (before its startDate) — refunds the stake in full. Once ACTIVE, entries are final. */
export function withdrawFromChallenge(challengeId: string) {
  return request<WithdrawChallengeResult>(`/challenges/${challengeId}/withdraw`, { method: "POST" });
}

export function createChallengeInvite(challengeId: string, inviteeEmail?: string) {
  return request<{ invite: ChallengeInvite }>(`/challenges/${challengeId}/invites`, { method: "POST", body: JSON.stringify({ inviteeEmail }) });
}

/** Submits a batch of samples for one local calendar day of one participant's check-in. Same evidence pipeline as races — see raceClient.ts submitRaceSamples. */
export function submitCheckIn(participantId: string, localDate: string, samples: RawSample[]) {
  return request<CheckInIngestResult>(`/challenge-participants/${participantId}/check-in`, {
    method: "POST",
    body: JSON.stringify({ localDate, samples }),
  });
}

/**
 * Buys back one otherwise-disqualifying missed day — one per participant per
 * challenge. The fee is folded into the pool at resolution, never kept by
 * the platform (see backend/src/modules/challenges/resolution.ts).
 */
export function purchaseRedemption(participantId: string) {
  return request<PurchaseRedemptionResult>(`/challenge-participants/${participantId}/redemption`, { method: "POST" });
}

export function getChallengeHistory() {
  return request<{ entries: ChallengeHistoryEntry[] }>("/me/challenge-history");
}
