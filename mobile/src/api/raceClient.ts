// Fixed-prize races / leagues — API calls.
//
// Separate module from client.ts for the same reason raceTypes.ts is
// separate from types.ts: the two models share ./http.ts — the request
// helper and the auth token it attaches — and nothing else.

import type { RawSample } from "../health/types";
import type {
  CreateRaceResult,
  EnterRaceResult,
  LeagueLevel,
  LeagueStandings,
  MetricStanding,
  Race,
  RaceDetail,
  RaceHistoryEntry,
  RacePointEntry,
  RaceSampleIngestResult,
  RaceType,
  SquadCodeLookup,
  WithdrawRaceResult,
} from "./raceTypes";

import { request } from "./http";

/** Every active race format and its pre-announced prize schedule, per league. */
export function getRaceTypes() {
  return request<{ raceTypes: RaceType[] }>("/race-types");
}

export function getLeagues() {
  return request<{ leagues: LeagueLevel[] }>("/leagues");
}

/**
 * Races currently accepting entrants.
 *
 * `scope: "all"` includes leagues above the user's own, flagged
 * `enterable: false` — shown so progression is legible, never as something
 * they failed to qualify for.
 */
export function getRaces(params: { scope?: "my_league" | "all"; metricKey?: string; format?: "INDIVIDUAL" | "SQUAD" } = {}) {
  const q = new URLSearchParams();
  if (params.scope) q.set("scope", params.scope);
  if (params.metricKey) q.set("metricKey", params.metricKey);
  if (params.format) q.set("format", params.format);
  const suffix = q.toString() ? `?${q}` : "";
  return request<{ races: Race[] }>(`/races${suffix}`);
}

export function getRace(raceId: string) {
  return request<RaceDetail>(`/races/${raceId}`);
}

/**
 * Enters a race, debiting the entry fee.
 *
 * `lockedRace: true` in the result means this entry completed the exact
 * headcount and the race just locked — worth surfacing, since it is the
 * moment the entry stops being withdrawable (it now waits, final, for the
 * scheduled midnight start).
 *
 * Throws with `err.code === "insufficient_balance"` (402), `"race_not_open"`,
 * `"already_entered"`, `"wrong_league"`, `"squad_full"`, or
 * `"lower_league_available"` — the last one means the race is below the
 * user's own league for this metric and needs `acceptLowerLeague: true` to
 * confirm they still want in (at that lower league's fee/prize, for zero
 * league points either way).
 */
export function enterRace(
  raceId: string,
  opts: {
    /** Only works for a squad whose captain marked it open to anyone. */
    squadId?: string;
    /** The captain's shared code — how an invite-only squad is joined. */
    squadInviteCode?: string;
    /** Founds a new squad. */
    squadName?: string;
    /** Only read when founding. Omitted means invite-only. */
    squadJoinPolicy?: "INVITE_ONLY" | "OPEN";
    /** Confirms entry into a race below the user's own league for this metric. */
    acceptLowerLeague?: boolean;
  } = {}
) {
  return request<EnterRaceResult>(`/races/${raceId}/enter`, { method: "POST", body: JSON.stringify(opts) });
}

/**
 * Withdraws from a race while it is still FILLING, refunding the entry fee
 * in full. Once a race is LOCKED (or later), entries are final — the
 * backend rejects the call rather than silently no-op'ing.
 */
export function cancelRaceEntry(raceId: string) {
  return request<WithdrawRaceResult>(`/races/${raceId}/withdraw`, { method: "POST" });
}

/** Looks up a shared squad code without joining, so the invitee can see the squad, race, fee and prizes first. */
export function lookUpSquadCode(code: string) {
  return request<SquadCodeLookup>(`/race-squads/by-code/${encodeURIComponent(code.trim().toLowerCase())}`);
}

/** Uploads health samples against a race entry. Same validation pipeline as pooled-challenge check-ins. */
export function submitRaceSamples(raceEntryId: string, samples: RawSample[]) {
  return request<RaceSampleIngestResult>(`/race-entries/${raceEntryId}/samples`, {
    method: "POST",
    body: JSON.stringify({ samples }),
  });
}

export function syncRaceStrava(raceEntryId: string) {
  return request<RaceSampleIngestResult>(`/race-entries/${raceEntryId}/sync-strava`, { method: "POST" });
}

/**
 * All four league standings — one per metric — plus which to lead with.
 * No global rank and no combined total, by design.
 */
export function getLeagueStandings() {
  return request<LeagueStandings>("/me/leagues");
}

/** One metric's standing on its own. */
export function getMetricStanding(metricKey: string) {
  return request<MetricStanding>(`/me/leagues/${encodeURIComponent(metricKey)}`);
}

/** Point movements, optionally narrowed to one metric's league. */
export function getLeagueHistory(metricKey?: string) {
  const q = metricKey ? `?metricKey=${encodeURIComponent(metricKey)}` : "";
  return request<{ entries: RacePointEntry[] }>(`/me/league/history${q}`);
}

export function getMyRaces() {
  return request<{ entries: RaceHistoryEntry[] }>("/me/races");
}

/**
 * Creates a PRIVATE race and enters the creator as racer 1, charging the
 * league's fixed entry fee.
 *
 * Note what is not in the payload: no entry fee, no prize amounts, no league,
 * no field size. All of it is platform configuration resolved server-side —
 * a creator who could set their own prize would turn it into a share of what
 * entrants paid in, which is the structure this model avoids.
 *
 * Throws with err.code "insufficient_balance" (402),
 * "race_type_not_user_creatable", or "public_race_not_user_creatable".
 */
export function createRace(input: {
  name: string;
  metricKey: "steps" | "running" | "cycling" | "swimming";
  durationDays: 1 | 7;
  format: "INDIVIDUAL" | "SQUAD";
  squadName?: string;
  squadJoinPolicy?: "INVITE_ONLY" | "OPEN";
}) {
  return request<CreateRaceResult>("/races", { method: "POST", body: JSON.stringify(input) });
}

/** Resolves a private race's invite code so an invitee can see it before entering. */
export function lookUpRaceCode(code: string) {
  return request<{ race: Race }>(`/races/by-code/${encodeURIComponent(code.trim().toLowerCase())}`);
}
