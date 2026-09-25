import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { showAlert } from "../../lib/alert";
import { shareCode } from "../../lib/shareCode";
import { LoadError } from "../../components/LoadError";
import { useAppState } from "../../state/useAppState";
import {
  getPendingWithdrawals,
  getInviteCodes,
  grantSponsoredCredit,
  markWithdrawalPaid,
  rejectWithdrawal,
  mintInviteCodes,
  createCustomInviteCode,
  getAdminOverview,
  revokeInviteCode,
  getRaceFillReport,
  getLeagueReadiness,
  openLeague,
  getRaceReviewQueue,
  getOpenReports,
  getAdminUsers,
  resolveRaceFlag,
  disqualifyRaceEntry,
  cancelRace,
  forfeitHeldPrize,
  updateUserStatus,
  type PendingWithdrawal,
  type InviteCode,
  type AdminOverview,
  type AdminUser,
  type RaceFillBucket,
  type LeagueReadiness,
  type RaceReviewQueue,
  type OpenReport,
} from "../../api/adminClient";

/**
 * Running the pilot, from inside the app.
 *
 * Every action here already existed as an admin HTTP route, and
 * DEPLOYMENT.md documents the curl for each. That is fine for a one-off and
 * bad as a daily habit: funding fifty accounts and clearing a payout queue
 * by hand means pasting a bearer token into a shell over and over, where a
 * mistyped amount or a reused grant reference moves real money. The session
 * is already authenticated here.
 *
 * Admin-only, and hidden otherwise — but the hiding is a convenience, not
 * the control. Every route below returns 403 to a non-admin regardless of
 * what the client renders, and a smoke test sweeps all 17 admin routes to
 * keep that true.
 */

function formatCents(cents: number) {
  return `R${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type Tab = "overview" | "users" | "controls" | "fund" | "payouts" | "invites" | "leagues" | "review";

export function AdminScreen() {
  const app = useAppState();
  const [tab, setTab] = useState<Tab>("overview");

  // Belt and braces with the navigator, which only registers this screen for
  // an admin. If a session somehow lands here without the flag, say so rather
  // than rendering controls whose every call would 403.
  if (!app.session?.isAdmin) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>This account isn't an admin.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin console</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroller} contentContainerStyle={styles.tabs}>
        <TabChip label="Overview" active={tab === "overview"} onPress={() => setTab("overview")} />
        <TabChip label="Users" active={tab === "users"} onPress={() => setTab("users")} />
        <TabChip label="Controls" active={tab === "controls"} onPress={() => setTab("controls")} />
        <TabChip label="Fund" active={tab === "fund"} onPress={() => setTab("fund")} />
        <TabChip label="Payouts" active={tab === "payouts"} onPress={() => setTab("payouts")} />
        <TabChip label="Invites" active={tab === "invites"} onPress={() => setTab("invites")} />
        <TabChip label="Leagues" active={tab === "leagues"} onPress={() => setTab("leagues")} />
        <TabChip label="Review" active={tab === "review"} onPress={() => setTab("review")} />
      </ScrollView>

      {tab === "overview" ? (
        <OverviewPanel />
      ) : tab === "users" ? (
        <UsersPanel />
      ) : tab === "controls" ? (
        <ControlsPanel onSelect={setTab} />
      ) : tab === "fund" ? (
        <FundPanel />
      ) : tab === "payouts" ? (
        <PayoutsPanel />
      ) : tab === "invites" ? (
        <InvitesPanel />
      ) : tab === "leagues" ? (
        <LeaguesPanel />
      ) : (
        <ReviewPanel />
      )}
    </SafeAreaView>
  );
}

function OverviewPanel() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!overview) setLoading(true);
    try {
      setOverview(await getAdminOverview());
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [overview]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && !overview) {
    return <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />;
  }
  if (loadError && !overview) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <LoadError error={loadError} onRetry={load} />
      </ScrollView>
    );
  }
  if (!overview) return null;

  const suspendedUsers = overview.users.filter((u) => u.suspendedAt || u.bannedAt).length;
  const statCards = [
    { label: "Users", value: String(overview.stats.totalUsers) },
    { label: "Suspended", value: String(suspendedUsers) },
    { label: "Races", value: String(Object.values(overview.stats.racesByStatus).reduce((sum, n) => sum + n, 0)) },
    { label: "Wallets", value: formatCents(overview.stats.userWalletBalanceCents) },
    { label: "Payouts", value: String(overview.stats.pendingWithdrawals) },
    { label: "Reports", value: String(overview.stats.openReports) },
  ];

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <View style={styles.statGrid}>
        {statCards.map((item) => (
          <View key={item.label} style={styles.statCard}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{item.value}</Text>
            <Text style={styles.statLabel}>{item.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Control overview</Text>
      <View style={styles.controlStrip}>
        {Object.entries(overview.stats.racesByStatus).map(([status, count]) => (
          <View key={status} style={styles.controlPill}>
            <Text style={styles.controlPillValue}>{count}</Text>
            <Text style={styles.controlPillLabel}>{status.toLowerCase()}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Recent users</Text>
      {overview.users.map((user) => (
        <View key={user.id} style={styles.userRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>{user.displayName}{user.isAdmin ? " · admin" : ""}</Text>
            <Text style={styles.userMeta} numberOfLines={1}>{user.email}</Text>
            <Text style={styles.userMeta}>
              Joined {formatWhen(user.createdAt)} · {user.counts.races} races · {user.counts.challenges} challenges
            </Text>
            {user.bannedAt || user.suspendedAt ? (
              <Text style={styles.userStatusBad}>
                {user.bannedAt ? "Banned" : "Suspended"}{user.suspendedReason ? ` · ${user.suspendedReason}` : ""}
              </Text>
            ) : null}
          </View>
          <Text style={styles.userBalance}>{formatCents(user.walletBalanceCents)}</Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Recent wallet activity</Text>
      {overview.ledger.map((entry) => (
        <View key={entry.id} style={styles.ledgerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>{entry.user.displayName}</Text>
            <Text style={styles.userMeta}>{entry.type} · {entry.status} · {formatWhen(entry.createdAt)}</Text>
          </View>
          <Text style={[styles.userBalance, { color: entry.amountCents < 0 ? colors.fail : colors.sage }]}>{formatCents(entry.amountCents)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (users.length === 0) setLoading(true);
    try {
      const result = await getAdminUsers();
      setUsers(result.users);
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [users.length]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function setStatus(user: AdminUser, status: "ACTIVE" | "SUSPENDED" | "BANNED") {
    setBusyId(user.id);
    try {
      await updateUserStatus(user.id, status, status === "ACTIVE" ? undefined : `${status.toLowerCase()} by admin`);
      await load();
    } catch (err: any) {
      showAlert("Couldn't update user", err.message ?? "Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={styles.panelHint}>All signed-up users. Suspend blocks login and app actions temporarily; ban blocks the account until restored.</Text>
      {loading && users.length === 0 ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} /> : null}
      {!loading && loadError ? <LoadError error={loadError} onRetry={load} /> : null}
      {users.map((user) => {
        const disabled = !!user.bannedAt || !!user.suspendedAt;
        return (
          <View key={user.id} style={styles.opsCard}>
            <View style={styles.opsTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{user.displayName}{user.isAdmin ? " · admin" : ""}</Text>
                <Text style={styles.userMeta}>{user.email}</Text>
                <Text style={styles.userMeta}>{formatCents(user.walletBalanceCents)} · {user.counts.races} races · {user.counts.withdrawals} withdrawals</Text>
                {disabled ? <Text style={styles.userStatusBad}>{user.bannedAt ? "Banned" : "Suspended"}{user.suspendedReason ? ` · ${user.suspendedReason}` : ""}</Text> : null}
              </View>
              <View style={[styles.statePill, disabled ? styles.stateWarn : styles.stateGood]}>
                <Text style={styles.statePillText}>{user.bannedAt ? "banned" : user.suspendedAt ? "suspended" : "active"}</Text>
              </View>
            </View>
            <View style={styles.payoutActions}>
              {disabled ? (
                <Pressable style={[styles.cta, styles.payoutCta, busyId === user.id && styles.ctaDisabled]} disabled={busyId === user.id} onPress={() => setStatus(user, "ACTIVE")}>
                  <Text style={styles.ctaText}>Restore</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable style={[styles.secondaryCta, styles.payoutCta, busyId === user.id && styles.ctaDisabled]} disabled={busyId === user.id} onPress={() => setStatus(user, "SUSPENDED")}>
                    <Text style={styles.secondaryCtaText}>Suspend</Text>
                  </Pressable>
                  <Pressable style={[styles.dangerCtaInline, styles.payoutCta, busyId === user.id && styles.ctaDisabled]} disabled={busyId === user.id} onPress={() => setStatus(user, "BANNED")}>
                    <Text style={styles.dangerCtaText}>Ban</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function TabChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tabChip, active && styles.tabChipActive]} onPress={onPress}>
      <Text style={[styles.tabChipText, active && styles.tabChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ControlsPanel({ onSelect }: { onSelect: (tab: Tab) => void }) {
  const features: Array<{ title: string; body: string; icon: keyof typeof Ionicons.glyphMap; tab: Tab }> = [
    { title: "Pilot health", body: "Live totals for users, races, wallets, reports, and recent account activity.", icon: "pulse", tab: "overview" },
    { title: "User control", body: "See signed-up users, balances, race counts, and suspend or ban accounts.", icon: "people", tab: "users" },
    { title: "Fund users", body: "Grant sponsored wallet credit with an idempotent daily reference.", icon: "wallet", tab: "fund" },
    { title: "Payout queue", body: "Mark EFT withdrawals as paid or refuse and refund them.", icon: "cash", tab: "payouts" },
    { title: "Invite codes", body: "Create, share, and revoke signup codes for the closed pilot.", icon: "ticket", tab: "invites" },
    { title: "League operations", body: "Check fill rates, readiness, and open sport-specific league levels.", icon: "podium", tab: "leagues" },
    { title: "Race review", body: "Resolve flags, disqualify entries, cancel stuck races, and forfeit held prizes.", icon: "shield-checkmark", tab: "review" },
  ];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.panelHint}>Admin controls available in this console. Each item opens the live tool for that job.</Text>
      {features.map((feature) => (
        <Pressable key={feature.title} style={styles.featureCard} onPress={() => onSelect(feature.tab)}>
          <View style={styles.featureIcon}>
            <Ionicons name={feature.icon} size={18} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.featureTitle}>{feature.title}</Text>
            <Text style={styles.featureBody}>{feature.body}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.sub} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ── Fund ────────────────────────────────────────────────────────────────

const PRESET_AMOUNTS_CENTS = [10000, 25000, 50000];
const MAX_SPONSORED_CREDIT_CENTS = 500_000;

function parseRandAmountToCents(value: string) {
  const raw = value.trim().replace(/[rR\s]/g, "");
  if (!raw) return null;

  let normalized = raw;
  if (raw.includes(",") && raw.includes(".")) {
    normalized = raw.replace(/,/g, "");
  } else if (raw.includes(",")) {
    const parts = raw.split(",");
    normalized = parts.length === 2 && parts[1].length <= 2 ? parts.join(".") : raw.replace(/,/g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function FundPanel() {
  const [email, setEmail] = useState("");
  const [amountText, setAmountText] = useState("250");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastGrant, setLastGrant] = useState<string | null>(null);

  const amountCents = parseRandAmountToCents(amountText);
  const amountIsValid =
    amountCents != null && amountCents > 0 && amountCents <= MAX_SPONSORED_CREDIT_CENTS;

  async function doGrant() {
    if (!email.trim() || !amountIsValid || amountCents == null) {
      showAlert("Check the details", "Enter the account's email and a Rand amount from R0.01 to R5,000.");
      return;
    }

    // The grant reference is what makes this safe to press twice. Derived
    // from recipient + amount + today, so a double tap or a retry after a
    // timeout is refused with 409 rather than funding twice — while funding
    // the same person again tomorrow, or a different amount, still works.
    const grantRef = `${email.trim().toLowerCase()}:${amountCents}:${new Date().toISOString().slice(0, 10)}`;

    setBusy(true);
    try {
      const result = await grantSponsoredCredit({ email: email.trim(), amountCents, grantRef, note: note.trim() || undefined });
      setLastGrant(`${email.trim()} — balance now ${formatCents(result.wallet.balanceCents)}`);
      setEmail("");
      setNote("");
      showAlert("Funded", `${result.email} now has ${formatCents(result.wallet.balanceCents)}.`);
    } catch (err: any) {
      showAlert(
        err.code === "duplicate_grant" ? "Already funded" : err.code === "user_not_found" ? "No such account" : "Couldn't fund that account",
        err.message ?? "Something went wrong."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.panelHint}>
        Nobody pays in during the pilot, so a new account has nothing to enter a race with until you fund it.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Their email"
        placeholderTextColor={colors.sub}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <View style={styles.presetRow}>
        {PRESET_AMOUNTS_CENTS.map((cents) => (
          <Pressable
            key={cents}
            style={[styles.preset, amountCents === cents && styles.presetActive]}
            onPress={() => setAmountText(String(cents / 100))}
          >
            <Text style={[styles.presetText, amountCents === cents && styles.presetTextActive]}>{formatCents(cents)}</Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        style={[styles.input, amountText.trim().length > 0 && !amountIsValid && styles.inputError]}
        placeholder="Amount (R)"
        placeholderTextColor={colors.sub}
        keyboardType="decimal-pad"
        value={amountText}
        onChangeText={setAmountText}
      />
      {amountText.trim() && !amountIsValid ? (
        <Text style={styles.errorText}>Use any Rand amount from R0.01 to R5,000.</Text>
      ) : null}
      <TextInput
        style={styles.input}
        placeholder="Note (e.g. pilot wave 1)"
        placeholderTextColor={colors.sub}
        value={note}
        onChangeText={setNote}
      />

      <Pressable style={[styles.cta, (busy || !amountIsValid) && styles.ctaDisabled]} disabled={busy || !amountIsValid} onPress={doGrant}>
        {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.ctaText}>Fund {amountCents ? formatCents(amountCents) : ""}</Text>}
      </Pressable>

      {lastGrant ? <Text style={styles.successLine}>Last: {lastGrant}</Text> : null}

      <Text style={styles.footnote}>
        Pressing this twice for the same person and amount on the same day is refused rather than paying twice. Every grant also
        debits the platform account, so what you have handed out stays answerable from the ledger.
      </Text>
    </ScrollView>
  );
}

// ── Payouts ─────────────────────────────────────────────────────────────

function PayoutsPanel() {
  const [withdrawals, setWithdrawals] = useState<PendingWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPendingWithdrawals();
      setWithdrawals(result.withdrawals);
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function confirmPaid(w: PendingWithdrawal) {
    showAlert(
      `Sent ${formatCents(w.amountCents)}?`,
      `Only mark this paid once the EFT to ${w.manualAccountName} has actually gone out. It moves no money — ${w.user.displayName}'s balance was debited when they asked.`,
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "Mark paid",
          onPress: async () => {
            setBusyId(w.id);
            try {
              await markWithdrawalPaid(w.id);
              await load();
            } catch (err: any) {
              showAlert("Couldn't mark it paid", err.message ?? "Something went wrong.");
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  }

  function confirmReject(w: PendingWithdrawal) {
    showAlert(
      `Refuse ${formatCents(w.amountCents)}?`,
      `${w.user.displayName} gets the full amount back in their wallet. Use this if the bank details look wrong, or if the result behind it doesn't stand up.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Refuse and refund",
          style: "destructive",
          onPress: async () => {
            setBusyId(w.id);
            try {
              const result = await rejectWithdrawal(w.id, "Refused by an admin during review");
              showAlert("Refunded", `${formatCents(result.refundedCents)} is back in their wallet.`);
              await load();
            } catch (err: any) {
              showAlert("Couldn't refuse it", err.message ?? "Something went wrong.");
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={styles.panelHint}>
        Money has already left these wallets. Send the EFT, then mark it paid. This list is the reliable record, whether or not a
        notification reached you.
      </Text>

      {loading && withdrawals.length === 0 ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} /> : null}
      {!loading && loadError ? <LoadError error={loadError} onRetry={load} /> : null}
      {!loading && !loadError && withdrawals.length === 0 ? <Text style={styles.emptyText}>Nothing waiting to be paid out.</Text> : null}

      {withdrawals.map((w) => (
        <View key={w.id} style={styles.payoutCard}>
          <View style={styles.payoutTop}>
            <Text style={styles.payoutAmount}>{formatCents(w.amountCents)}</Text>
            <Text style={styles.payoutWhen}>asked {formatWhen(w.createdAt)}</Text>
          </View>
          <Text style={styles.payoutWho}>
            {w.user.displayName} · {w.user.email}
          </Text>
          <View style={styles.bankBlock}>
            <Text style={styles.bankLine}>{w.manualAccountName}</Text>
            <Text style={styles.bankLine}>
              {w.manualBankName} · {w.manualAccountNumber}
            </Text>
          </View>
          <Text style={styles.payoutWarn}>Nobody checks the name against the number — an EFT to a wrong one can't be pulled back.</Text>
          <View style={styles.payoutActions}>
            <Pressable
              style={[styles.cta, styles.payoutCta, busyId === w.id && styles.ctaDisabled]}
              disabled={busyId === w.id}
              onPress={() => confirmPaid(w)}
            >
              {busyId === w.id ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.ctaText}>Mark paid</Text>}
            </Pressable>
            <Pressable style={[styles.secondaryCta, styles.payoutCta]} disabled={busyId === w.id} onPress={() => confirmReject(w)}>
              <Text style={styles.secondaryCtaText}>Refuse</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ── Invites ─────────────────────────────────────────────────────────────

function InvitesPanel() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [minting, setMinting] = useState(false);
  const [busyCodeId, setBusyCodeId] = useState<string | null>(null);
  const [customCode, setCustomCode] = useState("");
  const [customLabel, setCustomLabel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getInviteCodes();
      setCodes(result.codes);
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function mint(count: number) {
    setMinting(true);
    try {
      const result = await mintInviteCodes(count, `pilot ${new Date().toISOString().slice(0, 10)}`);
      await load();
      showAlert(`${result.codes.length} code${result.codes.length === 1 ? "" : "s"} minted`, result.codes.map((c) => c.code).join("\n"));
    } catch (err: any) {
      showAlert("Couldn't mint codes", err.message ?? "Something went wrong.");
    } finally {
      setMinting(false);
    }
  }

  async function createCustom() {
    if (customCode.trim().length < 4) {
      showAlert("Code too short", "Use at least 4 letters or numbers.");
      return;
    }
    setMinting(true);
    try {
      const result = await createCustomInviteCode(customCode.trim(), customLabel.trim() || undefined);
      setCustomCode("");
      setCustomLabel("");
      await load();
      showAlert("Invite created", result.codes.map((c) => c.code).join("\n"));
    } catch (err: any) {
      showAlert("Couldn't create that code", err.message ?? "It may already exist.");
    } finally {
      setMinting(false);
    }
  }

  function confirmRevoke(code: InviteCode) {
    showAlert("Revoke invite code?", `${code.code} will stop working immediately. Accounts already created with it stay active.`, [
      { text: "Keep it", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: async () => {
          setBusyCodeId(code.id);
          try {
            await revokeInviteCode(code.id);
            await load();
          } catch (err: any) {
            showAlert("Couldn't revoke it", err.message ?? "Something went wrong.");
          } finally {
            setBusyCodeId(null);
          }
        },
      },
    ]);
  }

  const unused = codes.filter((c) => !c.revokedAt && c.useCount < c.maxUses);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={styles.panelHint}>
        There is no public signup — an account can only be created with an unused code. {unused.length} unused right now.
      </Text>

      <View style={styles.customInviteCard}>
        <Text style={styles.sectionTitle}>Make your own code</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. reece-friends"
          placeholderTextColor={colors.sub}
          autoCapitalize="none"
          autoCorrect={false}
          value={customCode}
          onChangeText={setCustomCode}
        />
        <TextInput
          style={styles.input}
          placeholder="Label"
          placeholderTextColor={colors.sub}
          value={customLabel}
          onChangeText={setCustomLabel}
        />
        <Pressable style={[styles.cta, minting && styles.ctaDisabled]} disabled={minting} onPress={createCustom}>
          <Text style={styles.ctaText}>Create invite code</Text>
        </Pressable>
      </View>

      <View style={styles.presetRow}>
        {[1, 10, 25].map((n) => (
          <Pressable key={n} style={[styles.preset, minting && styles.ctaDisabled]} disabled={minting} onPress={() => mint(n)}>
            <Text style={styles.presetText}>Mint {n}</Text>
          </Pressable>
        ))}
      </View>

      {loading && codes.length === 0 ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} /> : null}
      {!loading && loadError ? <LoadError error={loadError} onRetry={load} /> : null}
      {!loading && !loadError && codes.length === 0 ? (
        <Text style={styles.emptyText}>No codes yet — mint some to open the pilot.</Text>
      ) : null}

      {codes.map((c) => {
        const spent = c.useCount >= c.maxUses;
        const dead = spent || !!c.revokedAt;
        return (
          <Pressable
            key={c.id}
            style={styles.codeRow}
            disabled={dead}
            onPress={() => void shareCode({ message: `Your ASTA invite code: ${c.code}`, title: "Invite code", code: c.code })}
          >
            <View style={styles.codeBody}>
              <Text style={[styles.codeText, dead && styles.codeSpent]}>{c.code}</Text>
              {c.label ? <Text style={styles.codeLabel}>{c.label}</Text> : null}
            </View>
            <Text style={styles.codeState}>{c.revokedAt ? "revoked" : spent ? "used" : "unused"}</Text>
            {!dead ? <Ionicons name="share-outline" size={15} color={colors.accent} /> : null}
            {!dead ? (
              <Pressable
                style={styles.smallDanger}
                disabled={busyCodeId === c.id}
                onPress={(event) => {
                  event.stopPropagation();
                  confirmRevoke(c);
                }}
              >
                <Text style={styles.smallDangerText}>{busyCodeId === c.id ? "..." : "Revoke"}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── Leagues ─────────────────────────────────────────────────────────────

function LeaguesPanel() {
  const [levels, setLevels] = useState<LeagueReadiness[]>([]);
  const [buckets, setBuckets] = useState<RaceFillBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [readiness, fillReport] = await Promise.all([getLeagueReadiness(), getRaceFillReport()]);
      setLevels(readiness.levels);
      setBuckets(fillReport.buckets);
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function doOpen(level: LeagueReadiness, force: boolean) {
    const key = `${level.metricKey}:${level.level}`;
    setBusyKey(key);
    try {
      const result = await openLeague(level.metricKey, level.level, force);
      showAlert(
        result.opened ? "League opened" : "Already open",
        `${result.metricKey} ${result.name}: ${result.promotedUsers ?? 0} users promoted.`
      );
      await load();
    } catch (err: any) {
      showAlert("Couldn't open league", err.message ?? "Something went wrong.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={styles.panelHint}>
        Open a league only when enough users have qualified to fill its largest active race format.
      </Text>
      {loading && levels.length === 0 ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} /> : null}
      {!loading && loadError ? <LoadError error={loadError} onRetry={load} /> : null}

      <Text style={styles.sectionTitle}>League readiness</Text>
      {levels.map((level) => {
        const key = `${level.metricKey}:${level.level}`;
        return (
          <View key={key} style={styles.opsCard}>
            <View style={styles.opsTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{level.metricKey} · {level.name}</Text>
                <Text style={styles.userMeta}>
                  {level.qualifiedCount}/{level.recommendedMinimum} qualified · needs {level.requiredEntrants} entrants
                </Text>
                <Text style={styles.userMeta} numberOfLines={2}>
                  Active: {level.activeRaceTypes.length ? level.activeRaceTypes.join(", ") : "none"}
                </Text>
              </View>
              <View style={[styles.statePill, level.isOpen ? styles.stateGood : level.ready ? styles.stateWarn : styles.stateMuted]}>
                <Text style={styles.statePillText}>{level.isOpen ? "open" : level.ready ? "ready" : "closed"}</Text>
              </View>
            </View>
            {!level.isOpen ? (
              <View style={styles.payoutActions}>
                <Pressable
                  style={[styles.cta, styles.payoutCta, (!level.ready || busyKey === key) && styles.ctaDisabled]}
                  disabled={!level.ready || busyKey === key}
                  onPress={() => doOpen(level, false)}
                >
                  <Text style={styles.ctaText}>{busyKey === key ? "Opening..." : "Open"}</Text>
                </Pressable>
                <Pressable style={[styles.secondaryCta, styles.payoutCta]} disabled={busyKey === key} onPress={() => doOpen(level, true)}>
                  <Text style={styles.secondaryCtaText}>Force open</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>Fill report</Text>
      {buckets.length === 0 ? <Text style={styles.emptyText}>No race fill history yet.</Text> : null}
      {buckets.map((bucket) => (
        <View key={`${bucket.raceTypeKey}:${bucket.leagueLevel}`} style={styles.reportRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{bucket.raceTypeKey} · L{bucket.leagueLevel}</Text>
            <Text style={styles.userMeta}>filled {bucket.filled} · cancelled {bucket.cancelled} · filling {bucket.filling}</Text>
          </View>
          <Text style={styles.userBalance}>{bucket.fillRate == null ? "n/a" : `${Math.round(bucket.fillRate * 100)}%`}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ── Review ──────────────────────────────────────────────────────────────

function ReviewPanel() {
  const [queue, setQueue] = useState<RaceReviewQueue | null>(null);
  const [reports, setReports] = useState<OpenReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reviewQueue, reportResult] = await Promise.all([getRaceReviewQueue(), getOpenReports()]);
      setQueue(reviewQueue);
      setReports(reportResult.reports);
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function runAction(id: string, action: () => Promise<unknown>, success: string) {
    setBusyId(id);
    try {
      await action();
      showAlert(success, "The review queue has been refreshed.");
      await load();
    } catch (err: any) {
      showAlert("Action failed", err.message ?? "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  const flags = queue?.flags ?? [];
  const heldPrizes = queue?.heldPrizes ?? [];

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={styles.panelHint}>
        These controls affect results and money. Use them only after checking the user, race, and evidence.
      </Text>
      {loading && !queue ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} /> : null}
      {!loading && loadError ? <LoadError error={loadError} onRetry={load} /> : null}

      <Text style={styles.sectionTitle}>Race flags</Text>
      {flags.length === 0 ? <Text style={styles.emptyText}>No open race flags.</Text> : null}
      {flags.map((flag) => {
        const entry = flag.sample?.raceEntry;
        const race = entry?.race;
        return (
          <View key={flag.id} style={styles.opsCard}>
            <Text style={styles.userName}>{entry?.user?.displayName ?? "Unknown racer"}</Text>
            <Text style={styles.userMeta}>{race?.name ?? "Unknown race"} · severity {flag.severity}</Text>
            <Text style={styles.reviewReason}>{flag.reason}</Text>
            <View style={styles.payoutActions}>
              <Pressable
                style={[styles.cta, styles.payoutCta, busyId === flag.id && styles.ctaDisabled]}
                disabled={busyId === flag.id}
                onPress={() => runAction(flag.id, () => resolveRaceFlag(flag.id, "DISMISSED"), "Flag dismissed")}
              >
                <Text style={styles.ctaText}>Dismiss</Text>
              </Pressable>
              {entry?.id ? (
                <Pressable
                  style={[styles.secondaryCta, styles.payoutCta]}
                  disabled={busyId === flag.id}
                  onPress={() =>
                    runAction(flag.id, () => disqualifyRaceEntry(entry.id, "Confirmed by admin review"), "Entry disqualified")
                  }
                >
                  <Text style={styles.secondaryCtaText}>Disqualify</Text>
                </Pressable>
              ) : null}
            </View>
            {race?.id ? (
              <Pressable
                style={[styles.dangerCta, busyId === `${flag.id}:cancel` && styles.ctaDisabled]}
                disabled={busyId === `${flag.id}:cancel`}
                onPress={() => runAction(`${flag.id}:cancel`, () => cancelRace(race.id, "Cancelled by admin review"), "Race cancelled")}
              >
                <Text style={styles.dangerCtaText}>Cancel race and refund entrants</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>Held prizes</Text>
      {heldPrizes.length === 0 ? <Text style={styles.emptyText}>No held race prizes.</Text> : null}
      {heldPrizes.map((prize) => (
        <View key={prize.id} style={styles.reportRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{prize.user?.displayName ?? "Unknown user"}</Text>
            <Text style={styles.userMeta}>{prize.race?.name ?? "Unknown race"} · {formatWhen(prize.createdAt)}</Text>
          </View>
          <Text style={styles.userBalance}>{formatCents(prize.amountCents)}</Text>
          <Pressable
            style={styles.smallDanger}
            disabled={busyId === prize.id}
            onPress={() => runAction(prize.id, () => forfeitHeldPrize(prize.id, "Forfeited by admin review"), "Prize forfeited")}
          >
            <Text style={styles.smallDangerText}>Forfeit</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.sectionTitle}>User reports</Text>
      {reports.length === 0 ? <Text style={styles.emptyText}>No open user reports.</Text> : null}
      {reports.map((report) => (
        <View key={report.id} style={styles.opsCard}>
          <Text style={styles.userName}>{report.reported.displayName}</Text>
          <Text style={styles.userMeta}>Reported by {report.reporter.displayName}{report.race ? ` · ${report.race.name}` : ""}</Text>
          <Text style={styles.reviewReason}>{report.reason}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.text, marginBottom: spacing.md },

  tabScroller: { flexGrow: 0, flexShrink: 0, maxHeight: 54 },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  tabChip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.pill, backgroundColor: colors.surface },
  tabChipActive: { backgroundColor: colors.accent },
  tabChipText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.sub },
  tabChipTextActive: { color: colors.bg },

  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  panelHint: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, lineHeight: 18 },
  footnote: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, lineHeight: 17, marginTop: spacing.sm },
  emptyText: { fontFamily: fonts.body, fontSize: 14, color: colors.sub, textAlign: "center", marginTop: spacing.lg },
  successLine: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.sage },

  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
  },
  inputError: { borderWidth: 1, borderColor: colors.fail },
  errorText: { fontFamily: fonts.body, fontSize: 12, color: colors.fail, marginTop: -spacing.sm },

  presetRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  preset: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.pill, backgroundColor: colors.surface },
  presetActive: { backgroundColor: colors.surfaceRaised },
  presetText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.sub },
  presetTextActive: { color: colors.text },

  cta: { backgroundColor: colors.accent, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center" },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.bg },
  secondaryCta: { backgroundColor: colors.surface, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center" },
  secondaryCtaText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.sub },
  dangerCta: { backgroundColor: colors.fail, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  dangerCtaInline: { backgroundColor: colors.fail, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center" },
  dangerCtaText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.text },
  smallDanger: {
    backgroundColor: colors.fail + "22",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  smallDangerText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.fail },

  featureCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  featureBody: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, lineHeight: 17, marginTop: 2 },

  payoutCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, gap: spacing.sm },
  payoutTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  payoutAmount: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.text },
  payoutWhen: { fontFamily: fonts.body, fontSize: 12, color: colors.sub },
  payoutWho: { fontFamily: fonts.body, fontSize: 13, color: colors.sub },
  bankBlock: { backgroundColor: colors.surfaceRaised, borderRadius: radii.sm, padding: spacing.md, gap: 2 },
  bankLine: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  payoutWarn: { fontFamily: fonts.body, fontSize: 12, color: colors.risk, lineHeight: 16 },
  payoutActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  payoutCta: { flex: 1 },

  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  codeBody: { flex: 1 },
  codeText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text, letterSpacing: 1 },
  codeSpent: { color: colors.sub, textDecorationLine: "line-through" },
  codeLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.sub },
  codeState: { fontFamily: fonts.body, fontSize: 12, color: colors.sub },
  customInviteCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, gap: spacing.sm },
  opsCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, gap: spacing.sm },
  opsTop: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  statePill: { borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  stateGood: { backgroundColor: colors.sage + "22" },
  stateWarn: { backgroundColor: colors.risk + "22" },
  stateMuted: { backgroundColor: colors.surfaceRaised },
  statePillText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.text },
  reportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  reviewReason: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, lineHeight: 17 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCard: { width: "31%", minWidth: 94, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md },
  statValue: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.text },
  statLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 2 },
  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.md },
  controlStrip: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  controlPill: { backgroundColor: colors.surface, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minWidth: 92 },
  controlPillValue: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text },
  controlPillLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 2 },
  userRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md },
  ledgerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: spacing.md },
  userName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  userMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 2 },
  userStatusBad: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.risk, marginTop: 4 },
  userBalance: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
});
