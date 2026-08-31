import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
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
  type PendingWithdrawal,
  type InviteCode,
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

type Tab = "fund" | "payouts" | "invites";

export function AdminScreen() {
  const navigation = useNavigation<any>();
  const app = useAppState();
  const [tab, setTab] = useState<Tab>("fund");

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
        <Pressable style={styles.backRow} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={18} color={colors.sub} />
          <Text style={styles.backText}>Profile</Text>
        </Pressable>
        <Text style={styles.title}>Run the pilot</Text>
      </View>

      <View style={styles.tabs}>
        <TabChip label="Fund" active={tab === "fund"} onPress={() => setTab("fund")} />
        <TabChip label="Payouts" active={tab === "payouts"} onPress={() => setTab("payouts")} />
        <TabChip label="Invites" active={tab === "invites"} onPress={() => setTab("invites")} />
      </View>

      {tab === "fund" ? <FundPanel /> : tab === "payouts" ? <PayoutsPanel /> : <InvitesPanel />}
    </SafeAreaView>
  );
}

function TabChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tabChip, active && styles.tabChipActive]} onPress={onPress}>
      <Text style={[styles.tabChipText, active && styles.tabChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

// ── Fund ────────────────────────────────────────────────────────────────

const PRESET_AMOUNTS_CENTS = [10000, 25000, 50000];

function FundPanel() {
  const [email, setEmail] = useState("");
  const [amountText, setAmountText] = useState("250");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastGrant, setLastGrant] = useState<string | null>(null);

  const amountCents = amountText.trim() ? Math.round(parseFloat(amountText) * 100) : null;

  async function doGrant() {
    if (!email.trim() || !amountCents || amountCents <= 0 || Number.isNaN(amountCents)) {
      showAlert("Check the details", "Enter the account's email and an amount above zero.");
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
        style={styles.input}
        placeholder="Amount (R)"
        placeholderTextColor={colors.sub}
        keyboardType="decimal-pad"
        value={amountText}
        onChangeText={setAmountText}
      />
      <TextInput
        style={styles.input}
        placeholder="Note (e.g. pilot wave 1)"
        placeholderTextColor={colors.sub}
        value={note}
        onChangeText={setNote}
      />

      <Pressable style={[styles.cta, busy && styles.ctaDisabled]} disabled={busy} onPress={doGrant}>
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

  const unused = codes.filter((c) => !c.revokedAt && c.useCount < c.maxUses);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={styles.panelHint}>
        There is no public signup — an account can only be created with an unused code. {unused.length} unused right now.
      </Text>

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
            onPress={() => void shareCode({ message: `Your Streak invite code: ${c.code}`, title: "Invite code", code: c.code })}
          >
            <View style={styles.codeBody}>
              <Text style={[styles.codeText, dead && styles.codeSpent]}>{c.code}</Text>
              {c.label ? <Text style={styles.codeLabel}>{c.label}</Text> : null}
            </View>
            <Text style={styles.codeState}>{c.revokedAt ? "revoked" : spent ? "used" : "unused"}</Text>
            {!dead ? <Ionicons name="share-outline" size={15} color={colors.accent} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.sub },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.text, marginBottom: spacing.md },

  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
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
});
