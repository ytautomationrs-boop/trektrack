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
