import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, TextInput, RefreshControl , Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { showAlert } from "../../lib/alert";
import { shareCode } from "../../lib/shareCode";
import { confirmVerifiable, isUnverifiable } from "../../lib/verifiability";
import { pickWorkoutFile, importChallengeWorkout, ACCEPTED_EXTENSIONS } from "../../lib/workoutImport";
import { LoadError } from "../../components/LoadError";
import { getChallenge, joinChallenge, withdrawFromChallenge, getChallengeHistory } from "../../api/challengeClient";
import { purchaseRedemption as purchaseRedemptionCall } from "../../api/challengeClient";
import { syncChallengeCheckIn } from "../../health/sync";
import type { Challenge } from "../../api/challengeTypes";
import type { DataSourceCategory } from "../../health/types";

// dailyTarget/unit come straight off the metric registry already, so all
// that's missing to drive a device read is which health category backs it —
// same fixed mapping seed.ts uses server-side.
const METRIC_TO_CATEGORY: Record<string, DataSourceCategory> = {
  steps: "STEPS",
  running: "RUNNING_WORKOUT",
  cycling: "CYCLING_WORKOUT",
  swimming: "SWIMMING_WORKOUT",
  sleep: "SLEEP",
};

function formatCents(cents: number) {
  return `R${(cents / 100).toLocaleString()}`;
}

function formatTarget(dailyTarget: number, unit: string) {
  if (unit === "km") return `${(dailyTarget / 1000).toLocaleString()} km`;
  return `${dailyTarget.toLocaleString()} ${unit}`;
}

/**
 * One StreakPot challenge: join/withdraw while it's still OPEN, sync and
 * check in once it's ACTIVE, buy a redemption if you miss a day.
 *
 * Contrast with RaceDetailScreen deliberately kept visible in the copy
 * throughout: a stake is not an entry fee (it can be forfeited to OTHER
 * participants, not just refunded or paid out by the platform), and a
 * daily target is pass/fail against yourself, never a ranked position.
 */
export function ChallengeDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const challengeId: string = route.params?.challengeId;

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChallenge(await getChallenge(challengeId));
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Same reasoning as entering a race from the list: the warning card
  // above is passive, and staking money on a challenge a browser cannot
  // score should be a decision, not something you scroll past.
  function handleJoin() {
    const keys = challenge?.metricRequirements.map((r) => r.metricKey) ?? [];
    // hasHealthSync: this screen keeps the native Health sync below, which
    // reads steps and sleep. So a metric a workout file cannot carry is still
    // scoreable here on a native build — just not in a browser.
    confirmVerifiable(keys, formatCents(challenge?.stakeCents ?? 0), () => void doJoin(), { hasHealthSync: true });
  }

  async function doJoin() {
    setBusy(true);
    try {
      await joinChallenge(challengeId, challenge?.visibility === "INVITE_ONLY" ? inviteCodeInput.trim() : undefined);
      setInviteCodeInput("");
      showAlert("You're in", "Your stake is held until the challenge starts. You can withdraw for a full refund any time before then.");
      await load();
    } catch (err: any) {
      showAlert(err.code === "insufficient_balance" ? "Top up first" : "Couldn't join", err.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function handleWithdraw() {
    showAlert("Withdraw your stake?", "You'll get it back in full. Once the challenge starts, this won't be possible.", [
      { text: "Stay in", style: "cancel" },
      {
        text: "Withdraw",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            const result = await withdrawFromChallenge(challengeId);
            showAlert("Withdrawn", `${formatCents(result.refundedCents)} refunded to your wallet.`);
            await load();
          } catch (err: any) {
            showAlert("Couldn't withdraw", err.message ?? "Something went wrong.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function handleShare() {
    if (!challenge?.inviteCode) return;
    await shareCode({
      message: `Join my TrackTrek Pool "${challenge.title}" — code: ${challenge.inviteCode}`,
      title: "Invite code",
      code: challenge.inviteCode,
    });
  }

  async function handlePurchaseRedemption(participantId: string) {
    showAlert(
      "Buy a redemption?",
      "Forgives ONE missed day for the rest of this challenge. The fee goes straight into the pool — Streak never keeps it.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Buy it",
          onPress: async () => {
            setBusy(true);
            try {
              const result = await purchaseRedemptionCall(participantId);
              showAlert("Redemption bought", `${formatCents(result.feeCents)} charged — added to the pool.`);
              await load();
            } catch (err: any) {
              showAlert(err.code === "insufficient_balance" ? "Top up first" : "Couldn't buy redemption", err.message ?? "Something went wrong.");
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  if (!challenge) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        {loadError ? (
          <LoadError error={loadError} onRetry={load} />
        ) : (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <Pressable style={styles.backRow} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={20} color={colors.sub} />
          <Text style={styles.backText}>Pool</Text>
        </Pressable>

        <Text style={styles.title}>{challenge.title}</Text>
        <Text style={styles.subtitle}>
          {challenge.durationDays} {challenge.durationDays === 1 ? "day" : "days"} · {formatCents(challenge.stakeCents)} stake ·{" "}
          {challenge.mode === "SQUAD" ? "Squad" : "Solo"}
        </Text>

        <View style={styles.statusCard}>
          {challenge.status === "OPEN" ? (
            <>
              <Text style={styles.statusHeadline}>{challenge.participantCount} staking so far</Text>
              <Text style={styles.statusBody}>
                Starts {new Date(challenge.startDate).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}. Everyone who
                completes every required day splits the full pool — nothing kept by Streak.
              </Text>
            </>
          ) : challenge.status === "ACTIVE" ? (
            <>
              <Text style={styles.statusHeadline}>In progress</Text>
              <Text style={styles.statusBody}>
                {challenge.myStatus === "ELIMINATED"
                  ? "You missed a required day and are no longer in the running for the pool."
                  : challenge.myStatus === "ACTIVE"
                  ? "Upload each day's activity to keep your streak going. Miss a required day and your stake goes to whoever finishes."
                  : "Following along without a stake in this one."}
              </Text>
              {/* The single most important number in a streak challenge, and
                  the screen showed it nowhere: a participant reloading the
                  page had no way to tell whether the day they just uploaded
                  had counted. */}
              {challenge.myStatus === "ACTIVE" && challenge.myCurrentStreak != null && (
                <Text style={styles.streakLine}>
                  {challenge.myCurrentStreak === 0
                    ? "No days banked yet."
                    : `${challenge.myCurrentStreak} day${challenge.myCurrentStreak === 1 ? "" : "s"} banked so far.`}
                </Text>
              )}
            </>
          ) : challenge.status === "COMPLETED" ? (
            <>
              <Text style={styles.statusHeadline}>Finished</Text>
              <Text style={styles.statusBody}>
                {challenge.myStatus === "FINISHED"
                  ? "You finished — your share of the pool has been paid out."
                  : challenge.myStatus === "ELIMINATED"
                  ? "You missed a required day — your stake went to whoever finished."
                  : "This challenge is over."}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.statusHeadline}>Cancelled</Text>
              <Text style={styles.statusBody}>Nobody staked before the start date — every stake was refunded in full.</Text>
            </>
          )}
        </View>

        <UnverifiableWarning challenge={challenge} />

        <Text style={styles.sectionTitle}>Daily targets</Text>
        <View style={styles.targetsCard}>
          {challenge.metricRequirements.map((r) => (
            <View key={r.metricKey} style={styles.targetRow}>
              <Text style={styles.targetMetric}>{r.displayName}</Text>
              <Text style={styles.targetValue}>{formatTarget(r.dailyTarget, r.unit)} / day</Text>
            </View>
          ))}
          {challenge.metricRequirements.length > 1 && (
            <Text style={styles.targetFootnote}>Multi-metric — every one of these has to pass on a given day for that day to count.</Text>
          )}
        </View>

        {challenge.hasJoined && challenge.inviteCode && (
          <Pressable style={styles.codeChip} onPress={handleShare}>
            <Ionicons name="share-outline" size={13} color={colors.accent} />
            <Text style={styles.codeChipText}>{challenge.inviteCode}</Text>
          </Pressable>
        )}

        {!challenge.hasJoined && challenge.status === "OPEN" && (
          <>
            {challenge.visibility === "INVITE_ONLY" && (
              <TextInput
                style={styles.input}
                value={inviteCodeInput}
                onChangeText={setInviteCodeInput}
                placeholder="Invite code"
                placeholderTextColor={colors.sub}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
            <Pressable
              style={[styles.cta, (busy || (challenge.visibility === "INVITE_ONLY" && inviteCodeInput.trim().length < 4)) && styles.ctaDisabled]}
              disabled={busy || (challenge.visibility === "INVITE_ONLY" && inviteCodeInput.trim().length < 4)}
              onPress={handleJoin}
            >
              {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.ctaText}>Stake {formatCents(challenge.stakeCents)} and join</Text>}
            </Pressable>
          </>
        )}

        {challenge.hasJoined && challenge.status === "OPEN" && (
          <Pressable style={[styles.withdrawBtn, busy && styles.ctaDisabled]} disabled={busy} onPress={handleWithdraw}>
            <Text style={styles.withdrawBtnText}>Withdraw · full refund</Text>
          </Pressable>
        )}

        {challenge.hasJoined && challenge.status === "ACTIVE" && challenge.myStatus === "ACTIVE" && (
          <ActiveParticipantActions challenge={challenge} onAfterAction={load} onBuyRedemption={handlePurchaseRedemption} busy={busy} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Warns before someone stakes money on a target this platform physically
 * cannot verify for them.
 *
 * A browser has no health store, and a workout file only describes an
 * ACTIVITY — so steps and sleep, which are daily totals, have no web-reachable
 * evidence at all. Staking on one from a browser would mean forfeiting the
 * stake no matter what the person actually did, which is the single most
 * unfair outcome this app could produce. Better to say so plainly before they
 * join than to take the money and score them as missing.
 *
 * Native is different, and the advice reflects that: this screen keeps a
 * Health sync that reads steps and sleep, so the mobile app genuinely is the
 * answer here rather than a brush-off.
 */
function UnverifiableWarning({ challenge }: { challenge: Challenge }) {
  const unverifiable = challenge.metricRequirements.filter((r) => isUnverifiable(r.metricKey, { hasHealthSync: true }));
  if (unverifiable.length === 0) return null;

  const names = unverifiable.map((r) => r.displayName.toLowerCase()).join(" and ");
  return (
    <View style={styles.warningCard}>
      <Ionicons name="warning-outline" size={18} color={colors.risk} />
      <Text style={styles.warningText}>
        {`Streak scores from a workout file you export from your watch, and there's no such file for ${names} — it's a daily total rather than a recorded activity, and a browser can't read your phone's health data. `}
        {challenge.hasJoined
          ? "Use the mobile app for this challenge, or your days will score as missed."
          : "Join from the mobile app instead, or your days will score as missed."}
      </Text>
    </View>
  );
}

/**
 * Split out because it needs the participant's OWN id and redemption state
 * — neither is on the decorated Challenge shape (that's shared with people
 * who haven't joined) — so it resolves its own participant record once via
 * /me/challenge-history, the same list the Pool history view reads.
 */
function ActiveParticipantActions({
  challenge,
  onAfterAction,
  onBuyRedemption,
  busy,
}: {
  challenge: Challenge;
  onAfterAction: () => Promise<void>;
  onBuyRedemption: (participantId: string) => void;
  busy: boolean;
}) {
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [redemptionPurchased, setRedemptionPurchased] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getChallengeHistory()
        .then(({ entries }) => {
          const mine = entries.find((e) => e.challengeId === challenge.id);
          setParticipantId(mine?.id ?? null);
          setRedemptionPurchased(mine?.redemptionPurchased ?? false);
        })
        .catch(() => {});
    }, [challenge.id])
  );

  /**
   * Uploads a workout file for whichever day the activity actually happened
   * on — the server works that out from the file's start time in this
   * participant's timezone.
   *
   * This is the only way to check in on the web at all: handleSync below
   * reads the device health store, and a browser has none.
   */
  async function handleImport() {
    if (!participantId) return;
    setImporting(true);
    setLastResult(null);
    try {
      const file = await pickWorkoutFile();
      if (!file) return;
      const result = await importChallengeWorkout(participantId, file);
      const km = (result.imported.distanceMeters / 1000).toFixed(2);
      const verdict =
        result.dayResult === "PASSED"
          ? "that day's target is met."
          : result.dayResult === "FAILED"
            ? "that day's target isn't met yet."
            : "it's counted.";
      setLastResult(`Added ${km} km for ${result.imported.localDate} — ${verdict}`);
      await onAfterAction();
    } catch (err: any) {
      showAlert("Couldn't add that file", err.message ?? "Something went wrong.");
    } finally {
      setImporting(false);
    }
  }

  async function handleSync() {
    if (!participantId) return;
    setSyncing(true);
    setLastResult(null);
    try {
      let anyFailed = false;
      for (const req of challenge.metricRequirements) {
        const category = METRIC_TO_CATEGORY[req.metricKey] ?? "GENERIC_WORKOUT";
        const result = await syncChallengeCheckIn({ participantId, metricKey: req.metricKey, category });
        if (result.dayResult === "FAILED") anyFailed = true;
      }
      setLastResult(anyFailed ? "Synced — today's target isn't met yet." : "Synced — today looks good so far.");
      await onAfterAction();
    } catch (err: any) {
      showAlert("Couldn't sync", err.message ?? "Something went wrong.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      {/* Upload is the primary action: it is the only one that works in a
          browser, and it works on native too. The device sync stays below it
          for native users, where reading Health is genuinely less effort
          than exporting a file. */}
      <Pressable style={[styles.cta, (importing || !participantId) && styles.ctaDisabled]} disabled={importing || !participantId} onPress={handleImport}>
        {importing ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.ctaText}>Sync data</Text>}
      </Pressable>
      <Text style={styles.importHint}>
        Export it from your watch or training app — Streak reads {ACCEPTED_EXTENSIONS.join(", ")}. It counts for the day you did it.
      </Text>

      {Platform.OS !== "web" && (
        <Pressable
          style={[styles.secondaryCta, (syncing || !participantId) && styles.ctaDisabled]}
          disabled={syncing || !participantId}
          onPress={handleSync}
        >
          {syncing ? <ActivityIndicator color={colors.sub} /> : <Text style={styles.secondaryCtaText}>Sync today from Health</Text>}
        </Pressable>
      )}
      {!!lastResult && <Text style={styles.syncResult}>{lastResult}</Text>}

      {!redemptionPurchased && participantId && (
        <Pressable style={[styles.secondaryCta, busy && styles.ctaDisabled]} disabled={busy} onPress={() => onBuyRedemption(participantId)}>
          <Text style={styles.secondaryCtaText}>Buy a redemption — forgive one missed day</Text>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  backRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.sub },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.text },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginTop: 2 },

  statusCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginTop: spacing.lg },
  statusHeadline: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.text },
  streakLine: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.sage, marginTop: spacing.xs },
  statusBody: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginTop: spacing.sm, lineHeight: 19 },

  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.risk,
  },
  warningText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.text, lineHeight: 19 },

  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  targetsCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg },
  targetRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.sm },
  targetMetric: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text },
  targetValue: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.accent },
  targetFootnote: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: spacing.md, lineHeight: 17 },

  codeChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  codeChipText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.accent, letterSpacing: 1 },

  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    padding: spacing.md,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
    marginTop: spacing.lg,
  },
  cta: { backgroundColor: colors.accent, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.bg },
  secondaryCta: { borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md, borderWidth: 1, borderColor: colors.surfaceRaised },
  secondaryCtaText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.sub },
  importHint: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, lineHeight: 17, marginTop: spacing.xs, marginBottom: spacing.sm },
  syncResult: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, textAlign: "center", marginTop: spacing.sm },

  withdrawBtn: { borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg, borderWidth: 1, borderColor: colors.sub },
  withdrawBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.sub },
});
