// Fixed-prize races / leagues — parallel model.
//
// Kept in its own file rather than appended to types.ts so the two models
// stay visibly separate on the client too: nothing here is referenced by the
// pooled-challenge screens, and nothing in types.ts is referenced here
// except the shared MetricTypeDefinition.
//
// Mirrors backend/src/modules/races/**/schemas.ts by hand, same as types.ts
// mirrors the challenge schemas.

import type { MetricTypeDefinition } from "./types";

export type RaceFormat = "INDIVIDUAL" | "SQUAD";
/** PUBLIC races are opened by the platform; PRIVATE ones are user-created. */
export type RaceVisibility = "PUBLIC" | "PRIVATE";
/**
 * FILLING waits indefinitely for the exact headcount — there is no deadline.
 * LOCKED is the instant it fills: entries are final and fees are revenue,
 * but scoring has not started — that waits for the scheduled midnight.
 * RUNNING is the scoring window, from scheduledStartAt.
 */
export type RaceStatus = "FILLING" | "LOCKED" | "RUNNING" | "RESOLVING" | "COMPLETED" | "CANCELLED_UNFILLED";
export type RaceEntryStatus = "ENTERED" | "WITHDRAWN" | "REFUNDED" | "DISQUALIFIED" | "SCORED";

/** One position in a pre-announced prize schedule. Positions absent from the list pay nothing. */
export type RacePrize = { position: number; amountCents: number };

export type LeagueLevel = {
  level: number;
  name: string;
  minPoints: number;
  isOpen: boolean;
  openedAt: string | null;
};

/**
 * A standing race format plus its per-league prize schedules. Readable
 * without entering anything — a prize is only "pre-announced" if it is
 * actually announced up front.
 */
export type RaceType = {
  key: string;
  displayName: string;
  /** Does the platform run PUBLIC races of this format? */
  isActive: boolean;
  /** May a user create a PRIVATE race of this format? */
  allowUserCreated: boolean;
  format: RaceFormat;
  metricKey: string;
  metricType: Pick<MetricTypeDefinition, "key" | "displayName" | "unit" | "valueType" | "icon">;
  durationDays: number;
  /** Exact headcount: entrants for a solo race, SQUADS for a squad race. */
  entrantCount: number;
  squadSize: number | null;
  /** Actual bodies required — entrantCount × squadSize for squad races. */
  totalEntrants: number;
  schedules: Array<{
    leagueLevel: number;
    leagueName: string;
    leagueIsOpen: boolean;
    entryFeeCents: number;
    currency: string;
    prizes: RacePrize[];
    totalPrizeCents: number;
  }>;
};

export type RaceSquadJoinPolicy = "INVITE_ONLY" | "OPEN";

export type RaceSquadSummary = {
  id: string;
  name: string;
  slotIndex: number;
  captainUserId: string;
  /** INVITE_ONLY squads reject a bare squadId — they need the captain's code. */
  joinPolicy: RaceSquadJoinPolicy;
  memberCount: number;
  capacity: number;
  isMine: boolean;
  isCaptain: boolean;
  /** Only ever populated for a squad the viewer is already in — null otherwise. */
  inviteCode: string | null;
};

/** The subset of MetricTypeDefinition a race payload carries — enough to pick the right glyph and format a total. */
export type RaceMetricType = Pick<MetricTypeDefinition, "key" | "displayName" | "unit" | "valueType"> & { icon: string };

export type Race = {
  id: string;
  /** Display name. Creator-supplied for private races, generated for public. */
  name: string;
  visibility: RaceVisibility;
  /** Null for platform-opened races. */
  createdByUserId: string | null;
  /** Only present on a private race the viewer is in — share it to invite. */
  inviteCode: string | null;
  raceTypeKey: string;
  raceType?: { key: string; displayName: string; metricKey: string; format: RaceFormat; metricType: RaceMetricType };
  leagueLevel: number;
  status: RaceStatus;
  metricKey: string;
  format: RaceFormat;
  durationDays: number;
  entrantCount: number;
  squadSize: number | null;
  entryFeeCents: number;
  currency: string;
  /** Frozen at creation — what this race pays, regardless of its own entry-fee total. */
  prizes: RacePrize[];
  totalPrizeCents: number;

  /** The timezone "next midnight" is computed against, fixed at creation. */
  anchorTimezone: string;
  /** When it first opened for entries. There is no deadline — fill is indefinite. */
  signupOpensAt: string;
  /** Set the instant the exact headcount is reached. */
  lockedAt: string | null;
  /** The next local midnight after lockedAt, in anchorTimezone — when LOCKED becomes RUNNING. */
  scheduledStartAt: string | null;
  startedAt: string | null;
  endsAt: string | null;
  resolvedAt: string | null;

  entrantsNow: number;
  entrantsRequired: number;
  slotsRemaining: number;
  hasEntered: boolean;
  mySquadId: string | null;
  squads: RaceSquadSummary[];
  /** Present on the "all leagues" listing — false means visible but not joinable. */
  enterable?: boolean;
  /**
   * True only on the "my league is empty" fallback races surfaced by
   * GET /races?scope=my_league — a race in a league BELOW the viewer's own
   * for this metric. Entering it requires the explicit acceptLowerLeague
   * flag and pays/wins that lower league's fixed schedule, but never moves
   * the viewer's real league standing.
   */
  isLowerLeagueOption?: boolean;
  league?: { level: number; name: string };
};

export type RaceStandingRow = {
  entryId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  squadId: string | null;
  status: RaceEntryStatus;
  total: number;
  /** 1-based finishing order in this sort — provisional until the race resolves. */
  position: number;
  /** How far behind the leader, in the metric's own unit. 0 for the leader. */
  gapFromLeader: number;
};

export type RaceStandingSquadRow = {
  squadId: string;
  name: string;
  total: number;
  position: number;
  gapFromLeader: number;
  members: RaceStandingRow[];
};

export type RaceStandings = {
  format: RaceFormat;
  metricKey: string;
  individuals: RaceStandingRow[];
  squads: RaceStandingSquadRow[];
};

export type RaceDetail = {
  race: Race & { entries: Array<{ id: string; userId: string; user: { id: string; displayName: string; avatarUrl: string | null } }> };
  standings: RaceStandings | null;
  /** Mid-race ordering is provisional — positions are only final once resolved. */
  standingsAreProvisional: boolean;
  /** The viewer's own user id — cross-reference against race.entries[].userId to find "my" row in standings. */
  viewerUserId: string;
};

export type EnterRaceResult = {
  entry: { id: string; raceId: string; status: RaceEntryStatus; entryFeeCents: number; lowerLeagueOptIn: boolean };
  race: Race;
  /** True when this entry completed the headcount and LOCKED the race. */
  lockedRace: boolean;
  entrantsNow: number;
  entrantsRequired: number;
};

/**
 * A user's league standing IN ONE METRIC.
 *
 * Leagues are tracked independently per metric — a user can be deep into the
 * running leagues and at League 1 for swimming simultaneously, because races
 * are single-metric and skill in one says nothing about another.
 *
 * Note what is not here: any global position, and any combined total across
 * metrics. Summing four independent progressions would invent a number that
 * means nothing.
 */
export type MetricStanding = {
  metricKey: string;
  metricName: string;
  totalPoints: number;
  racesEntered: number;
  racesWon: number;
  currentLeague: { level: number; name: string; minPoints: number } | null;
  nextLeague: { level: number; name: string; minPoints: number; isOpen: boolean } | null;
  pointsToNextLeague: number | null;
  /** 0..1 across the current band, for a progress bar. Null at the top level. */
  bandProgress: number | null;
  /** Earned a league that has not opened yet — shown as "promotion pending". */
  qualifiedForUnopenedLevel: number | null;
};

/** All four standings, plus which one to lead with. */
export type LeagueStandings = {
  standings: MetricStanding[];
  /** The metric this user races most — steps for someone who has never raced. */
  primaryMetricKey: string;
};

export type RacePointEntry = {
  id: string;
  raceId: string;
  /** Which metric's league these points went to. */
  metricKey: string;
  points: number;
  pointsBefore: number;
  pointsAfter: number;
  position: number;
  /** True when this result came from a voluntary lower-league entry — points is 0 by rule, not because the finish was poor. */
  lowerLeagueOptIn: boolean;
  createdAt: string;
};

export type RaceHistoryEntry = {
  id: string;
  raceId: string;
  status: RaceEntryStatus;
  entryFeeCents: number;
  aggregateValue: number | null;
  finishPosition: number | null;
  pointsAwarded: number | null;
  prizeCents: number | null;
  /** See Race.isLowerLeagueOption — mirrors it onto the entry so history can label it. */
  lowerLeagueOptIn: boolean;
  joinedAt: string;
  race: {
    id: string;
    name: string;
    visibility: RaceVisibility;
    createdByUserId: string | null;
    inviteCode: string | null;
    metricKey: string;
    format: RaceFormat;
    status: RaceStatus;
    entrantCount: number;
    durationDays: number;
    raceType: { displayName: string };
    leagueLevel: number;
    /** The league this race ran in — always within the race's own metric. */
    league: { level: number; name: string };
  };
  squad: { id: string; name: string; finishPosition: number | null } | null;
};

/** What GET /race-squads/by-code/:code returns — enough to decide before paying. */
export type SquadCodeLookup = {
  squad: {
    id: string;
    name: string;
    joinPolicy: RaceSquadJoinPolicy;
    captain: { id: string; displayName: string };
    memberCount: number;
    capacity: number;
  };
  race: Race;
  alreadyIn: boolean;
  joinable: boolean;
  reason: "race_not_open" | "already_in_squad" | "squad_full" | null;
};

export type RaceSampleIngestResult = {
  accepted: number;
  rejected: Array<{ reasonCode: string; reason: string }>;
  flagsRaised: number;
};

/** Result of POST /races. */
export type CreateRaceResult = {
  race: Race;
  entry: { id: string; raceId: string; status: RaceEntryStatus };
  /** Share this to invite entrants — a private race is joined by code. */
  inviteCode: string | null;
};

/** Result of POST /races/:id/withdraw. */
export type WithdrawRaceResult = { withdrawn: true; refundedCents: number };
