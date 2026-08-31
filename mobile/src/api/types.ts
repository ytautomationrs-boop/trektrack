// Shared API types — identity, metrics, wallet.
//
// Race and league types live in ./raceTypes.ts. Mirrors
// backend/src/modules/**/schemas.ts and prisma/schema.prisma by hand; in a
// longer-lived project these would be generated from the Zod schemas.
//
// The pooled-stake model's types (Challenge, ChallengeParticipant,
// DashboardCard, SquadStatus, tiers, stakes, pots, streaks, redemption,
// daily targets, pace targets) have been removed along with that model.

/** How a metric's value is expressed. Formatting only — never a target. */
export type MetricValueType = "COUNT" | "DISTANCE_METERS" | "DURATION_MINUTES";

/** The only four metrics. Sleep is not raceable and is not supported. */
export type MetricKey = "steps" | "running" | "cycling" | "swimming";

export type MetricTypeDefinition = {
  key: string;
  displayName: string;
  /** Display label only. DISTANCE_METERS values are always stored in metres. */
  unit: string;
  valueType: MetricValueType;
  dataSourceCategory: "STEPS" | "CYCLING_WORKOUT" | "RUNNING_WORKOUT" | "SWIMMING_WORKOUT" | "GENERIC_WORKOUT";
  icon: string;
  isActive: boolean;
};

// ─────────────────────────────────────────────────────────────────────────
// Wallet
// ─────────────────────────────────────────────────────────────────────────

export type Wallet = { balanceCents: number; currency: string };

/**
 * Must stay in step with LedgerEntryType in backend/prisma/schema.prisma.
 *
 * A value the backend can emit but this union omits is worse than a type
 * error: consumers keyed by this union still typecheck as exhaustive while
 * missing a case at runtime. WalletScreen therefore also has a runtime
 * fallback — see metaFor() there.
 */
export type LedgerEntryType =
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "RACE_ENTRY_FEE"
  | "RACE_ENTRY_REVENUE"
  | "RACE_PRIZE"
  | "RACE_PRIZE_EXPENSE"
  | "RACE_ENTRY_REFUND"
  // StreakPot. Note there is no *_REVENUE/*_EXPENSE pair here, matching the
  // backend enum — that pair is what a platform cut would look like, and
  // StreakPot takes none.
  | "STAKE_HOLD"
  | "STAKE_REFUND"
  | "STAKE_FORFEITED"
  | "POOL_PAYOUT"
  | "REDEMPTION_FEE"
  // Pilot sponsorship — the only way money enters a wallet while deposits
  // are off. The EXPENSE half is the platform mirror; a normal user never
  // sees it, but the platform account uses this same screen.
  | "SPONSORED_CREDIT"
  | "SPONSORED_CREDIT_EXPENSE"
  | "ADJUSTMENT"
  | "DISPUTE_REVERSAL";

/**
 * Which model a transaction belongs to. Derived server-side from which FK
 * is set rather than stored (see the LedgerEntry comment in schema.prisma):
 * a race id means "race", a challenge id means "streakpot", neither means a
 * wallet-level movement that belongs to no competition model at all.
 */
export type LedgerEntryModel = "race" | "streakpot";

export type LedgerEntry = {
  id: string;
  type: LedgerEntryType;
  model: LedgerEntryModel | null;
  status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
  amountCents: number;
  currency: string;
  description: string;
  createdAt: string;
  race?: {
    id: string;
    name: string;
    metricKey: string;
    format: "INDIVIDUAL" | "SQUAD";
    durationDays: number;
  } | null;
};

export type PaystackDepositIntent = { authorizationUrl: string; reference: string };

export type PaystackBank = { name: string; code: string };

export type WithdrawDestination =
  | { method: "PAYSTACK"; bankCode: string; accountNumber: string; accountName: string }
  | { method: "PAYPAL"; email: string }
  // Pilot default: no provider call at all. The request is queued for an
  // admin, who sends the EFT by hand and marks it paid.
  | { method: "MANUAL"; bankName: string; accountNumber: string; accountName: string };

// ─────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────

/**
 * Profile stat row.
 *
 * Deliberately contains no rank of any kind. Progress is league standing and
 * points (see LeagueStanding in ./raceTypes) — a global position that can sit
 * flat or slide backwards through a bad run is the one signal a user cannot
 * improve by trying harder in the short term.
 */
export type ProfileStats = {
  racesEntered: number;
  racesFinished: number;
  wins: number;
  podiums: number;
  totalWonCents: number;
  primaryMetric: {
    key: string;
    displayName: string;
    unit: string;
    valueType: MetricValueType;
    total: number;
  } | null;
};

export type StravaStatus = {
  connected: boolean;
  athleteId?: string | null;
  connectedAt?: string | null;
};
