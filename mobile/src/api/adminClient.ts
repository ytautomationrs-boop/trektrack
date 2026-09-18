import { request } from "./http";

// Admin-only calls, all backed by routes that require requireAuth +
// requireAdmin (see backend/src/modules/wallet/routes.ts and
// modules/auth/routes.ts). A non-admin session gets 403 from every one of
// them — the screen hides itself, but the server is what enforces it.

export type PendingWithdrawal = {
  id: string;
  amountCents: number;
  createdAt: string;
  manualBankName: string | null;
  manualAccountNumber: string | null;
  manualAccountName: string | null;
  user: { id: string; displayName: string; email: string };
};

export type InviteCode = {
  id: string;
  code: string;
  label: string | null;
  maxUses: number;
  useCount: number;
  revokedAt: string | null;
  createdAt: string;
};

export type AdminOverview = {
  stats: {
    totalUsers: number;
    activeNow: number;
    activeToday: number;
    userWalletBalanceCents: number;
    pendingWithdrawals: number;
    openReports: number;
    racesByStatus: Record<string, number>;
    challengesByStatus: Record<string, number>;
  };
  users: Array<{
    id: string;
    email: string;
    displayName: string;
    isAdmin: boolean;
    walletBalanceCents: number;
    suspendedAt: string | null;
    suspendedReason: string | null;
    bannedAt: string | null;
    createdAt: string;
    lastSeenAt: string | null;
    counts: { races: number; challenges: number; withdrawals: number; deposits: number };
  }>;
  ledger: Array<{
    id: string;
    userId: string;
    type: string;
    status: string;
    amountCents: number;
    createdAt: string;
    user: { displayName: string; email: string };
  }>;
};

export type RaceFillBucket = {
  raceTypeKey: string;
  leagueLevel: number;
  filled: number;
  cancelled: number;
  filling: number;
  fillRate: number | null;
};

export type LeagueReadiness = {
  metricKey: string;
  level: number;
  name: string;
  isOpen: boolean;
  qualifiedCount: number;
  requiredEntrants: number;
  recommendedMinimum: number;
  ready: boolean;
  activeRaceTypes: string[];
};

export type RaceReviewQueue = {
  flags: Array<{
    id: string;
    reason: string;
    severity: number;
    createdAt: string;
    sample?: {
      raceEntry?: {
        id: string;
        user?: { id: string; displayName: string };
        race?: { id: string; name: string; metricKey: string; status: string };
      };
    };
  }>;
  heldPrizes: Array<{
    id: string;
    amountCents: number;
    createdAt: string;
    user?: { id: string; displayName: string };
    race?: { id: string; name: string; metricKey: string; status: string };
  }>;
};

export type OpenReport = {
  id: string;
  reason: string;
  createdAt: string;
  reporter: { id: string; displayName: string };
  reported: { id: string; displayName: string };
  race: { id: string; name: string } | null;
};

/**
 * Funds a sponsored account — the pilot's only way money enters a wallet.
 *
 * `grantRef` is an idempotency handle: repeating one is refused with 409
 * rather than paying twice. The caller builds it from the recipient and the
 * amount so a double-tap or a retry after a timeout cannot double-fund.
 */
export function grantSponsoredCredit(input: { email: string; amountCents: number; grantRef: string; note?: string }) {
  return request<{ granted: boolean; email: string; wallet: { balanceCents: number } }>("/admin/sponsored-credit", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Everything waiting to be paid out by hand. */
export function getPendingWithdrawals() {
  return request<{ withdrawals: PendingWithdrawal[] }>("/admin/withdrawals");
}

/** Closes the record after the EFT has actually gone out. Moves no money — the wallet was debited at request time. */
export function markWithdrawalPaid(withdrawalId: string, reference?: string) {
  return request<{ withdrawalId: string; status: string }>(`/admin/withdrawals/${withdrawalId}/mark-paid`, {
    method: "POST",
    body: JSON.stringify({ reference }),
  });
}

/** Refuses a payout and refunds it in full, by the same path a failed provider payout uses. */
export function rejectWithdrawal(withdrawalId: string, reason: string) {
  return request<{ withdrawalId: string; status: string; refundedCents: number }>(`/admin/withdrawals/${withdrawalId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function getInviteCodes() {
  return request<{ codes: InviteCode[] }>("/admin/invite-codes");
}

export function mintInviteCodes(count: number, label?: string) {
  return request<{ codes: InviteCode[] }>("/admin/invite-codes", { method: "POST", body: JSON.stringify({ count, label }) });
}

export function createCustomInviteCode(code: string, label?: string) {
  return request<{ codes: InviteCode[] }>("/admin/invite-codes", { method: "POST", body: JSON.stringify({ count: 1, code, label }) });
}

export function getAdminOverview() {
  return request<AdminOverview>("/admin/overview");
}

export function updateUserStatus(userId: string, status: "ACTIVE" | "SUSPENDED" | "BANNED", reason?: string) {
  return request<{ user: AdminOverview["users"][number] }>(`/admin/users/${encodeURIComponent(userId)}/status`, {
    method: "POST",
    body: JSON.stringify({ status, reason }),
  });
}

export function revokeInviteCode(id: string) {
  return request<{ ok: boolean }>(`/admin/invite-codes/${id}/revoke`, { method: "POST" });
}

export function getRaceFillReport() {
  return request<{ buckets: RaceFillBucket[]; note: string }>("/admin/races/fill-report");
}

export function getLeagueReadiness(metricKey?: string) {
  const suffix = metricKey ? `?metricKey=${encodeURIComponent(metricKey)}` : "";
  return request<{ levels: LeagueReadiness[] }>(`/admin/leagues/readiness${suffix}`);
}

export function openLeague(metricKey: string, level: number, force = false) {
  return request<LeagueReadiness & { opened: boolean; promotedUsers: number; reason: string | null }>(
    `/admin/leagues/${encodeURIComponent(metricKey)}/${level}/open`,
    { method: "POST", body: JSON.stringify({ force }) }
  );
}

export function getRaceReviewQueue() {
  return request<RaceReviewQueue>("/admin/races/review-queue");
}

export function getOpenReports() {
  return request<{ reports: OpenReport[] }>("/admin/reports");
}

export function resolveRaceFlag(flagId: string, decision: "DISMISSED" | "CONFIRMED_CHEAT") {
  return request<{ ok: boolean; decision: string }>(`/admin/race-flags/${flagId}`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export function disqualifyRaceEntry(entryId: string, reason: string) {
  return request<{ ok?: boolean }>(`/admin/race-entries/${entryId}/disqualify`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function cancelRace(raceId: string, reason: string) {
  return request<{ ok?: boolean }>(`/admin/races/${raceId}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function forfeitHeldPrize(ledgerEntryId: string, reason: string) {
  return request<{ ok?: boolean }>(`/admin/race-prizes/${ledgerEntryId}/forfeit`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
