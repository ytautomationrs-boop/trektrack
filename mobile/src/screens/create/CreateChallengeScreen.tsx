import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { LoadError } from "../../components/LoadError";
import { showAlert } from "../../lib/alert";
import { shareCode } from "../../lib/shareCode";
import { iconFor } from "../../theme/metricIcons";
import { createChallenge, getStreakPotMetricTypes } from "../../api/challengeClient";
import type { StreakPotMetricType } from "../../api/challengeTypes";

/**
 * Create a StreakPot challenge. Pilot: admin-only — the backend refuses a
 * non-admin with `admin_only`, and CreateGateScreen never routes one here.
 *
 * Unlike a race, the creator DOES set the stake and the targets. That is not
 * an inconsistency: a challenge's pot is just the participants' own money
 * redistributed among themselves with no platform cut, so there is no
 * house-edge question to protect against. A race's prize is a platform
 * liability fixed in advance, which is exactly why a race creator can't
 * touch its fee or prizes.
 *
 * SOLO only for now. The backend supports SQUAD challenges (including
 * WHOLE_GROUP elimination), but there is no squad-formation UI on the
 * challenge detail screen yet — offering the mode here would create
 * challenges nobody could actually take part in properly.
 */

const DURATION_OPTIONS = [3, 7, 14, 30];
const STAKE_PRESETS_CENTS = [2000, 5000, 10000, 20000];
const START_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 1, label: "Tomorrow" },
  { days: 2, label: "In 2 days" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "Next week" },
];

function formatCents(cents: number) {
  return `R${(cents / 100).toLocaleString()}`;
}

/** Targets are stored in the metric's base unit (metres for distance), but "5 km" reads better than "5000 m" in an input. */
function displayTarget(value: number, metric: StreakPotMetricType): string {
  if (metric.unit === "km") return String(value / 1000);
  return String(value);
}
function parseTarget(text: string, metric: StreakPotMetricType): number {
  const n = parseFloat(text);
  if (Number.isNaN(n)) return 0;
  return metric.unit === "km" ? Math.round(n * 1000) : n;
}

/** The next local midnight `days` from now — matches how races schedule their start. */
function startDateFor(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

type Requirement = { metricKey: string; target: number };

export function CreateChallengeScreen() {
  const navigation = useNavigation<any>();

  const [metrics, setMetrics] = useState<StreakPotMetricType[]>([]);
  const [title, setTitle] = useState("");
  const [durationDays, setDurationDays] = useState(7);
  const [stakeCents, setStakeCents] = useState(5000);
  const [customStake, setCustomStake] = useState("");
  const [startInDays, setStartInDays] = useState(1);
  const [isPublic, setIsPublic] = useState(true);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [busy, setBusy] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<Error | null>(null);

  const loadMetrics = useCallback(async () => {
    setConfigLoading(true);
    try {
      const result = await getStreakPotMetricTypes();
      if (result.metricTypes.length === 0) throw new Error("Pool daily targets are not configured yet.");
      setMetrics(result.metricTypes);
      setRequirements((current) => {
        if (current.length > 0) return current;
        const steps = result.metricTypes.find((m) => m.key === "steps");
        return steps ? [{ metricKey: steps.key, target: steps.defaultTarget ?? 8000 }] : [];
      });
      setConfigError(null);
    } catch (err) {
      setMetrics([]);
      setRequirements([]);
      setConfigError(err as Error);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const resolvedStake = customStake.trim() ? Math.round(parseFloat(customStake) * 100) : stakeCents;
  const canSubmit =
    title.trim().length >= 3 &&
    requirements.length > 0 &&
    requirements.every((r) => r.target > 0) &&
    !!resolvedStake &&
    resolvedStake > 0 &&
    !Number.isNaN(resolvedStake) &&
    !busy;

  function toggleMetric(metric: StreakPotMetricType) {
    setRequirements((prev) => {
      const existing = prev.find((r) => r.metricKey === metric.key);
      if (existing) {
        // Never leave a challenge with no target at all — that would be a
        // challenge nobody can fail, and so nobody can win.
        if (prev.length === 1) return prev;
        return prev.filter((r) => r.metricKey !== metric.key);
      }
      return [...prev, { metricKey: metric.key, target: metric.defaultTarget ?? 0 }];
    });
  }

  async function submit() {
    setBusy(true);
    try {
      const { challenge } = await createChallenge({
        title: title.trim(),
        durationDays,
        startDate: startDateFor(startInDays).toISOString(),
        stakeCents: resolvedStake,
        visibility: isPublic ? "PUBLIC" : "INVITE_ONLY",
        mode: "SOLO",
        metricRequirements: requirements.map((r) => ({ metricKey: r.metricKey as never, dailyTarget: r.target })),
      });

      const code = challenge.inviteCode;
      showAlert(
        "Challenge created",
        isPublic
          ? `"${challenge.title}" is open to anyone. It starts ${START_OPTIONS.find((o) => o.days === startInDays)?.label.toLowerCase()}.`
          : `Share the code to invite people.${code ? `\n\nCode: ${code}` : ""}`,
        [
          !isPublic && code
            ? {
                text: "Share code",
                onPress: () =>
                  void shareCode({
                    message: `Join my Streak challenge "${challenge.title}" — code: ${code}`,
                    title: "Challenge code",
                    code,
                  }),
              }
            : { text: "OK" },
          { text: "View", onPress: () => navigation.navigate("Pool", { screen: "ChallengeDetail", params: { challengeId: challenge.id } }) },
        ]
      );
      setTitle("");
    } catch (err: any) {
      showAlert(err.code === "admin_only" ? "Not available" : "Couldn't create challenge", err.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const poolPreview = useMemo(() => resolvedStake * 10, [resolvedStake]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>New Pool</Text>
        <Text style={styles.subheader}>Pooled stakes, zero platform cut — finishers split everything.</Text>

        <Text style={styles.label}>Title</Text>
        <TextInput keyboardAppearance="dark"
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. October Step Streak"
          placeholderTextColor={colors.sub}
          maxLength={60}
        />

        <Text style={styles.label}>Daily targets</Text>
        <Text style={styles.hint}>Pick one, or several for a multi-metric challenge — every one has to pass for the day to count.</Text>
        {configError ? (
          <LoadError error={configError} onRetry={loadMetrics} />
        ) : configLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
        ) : (
          <View style={styles.metricRow}>
            {metrics.map((m) => {
              const active = requirements.some((r) => r.metricKey === m.key);
              return (
                <Pressable key={m.key} style={[styles.metricChip, active && styles.metricChipActive]} onPress={() => toggleMetric(m)}>
                  <Ionicons name={iconFor(m.key === "steps" ? "footprints" : m.key === "sleep" ? "moon" : m.key)} size={16} color={active ? colors.bg : colors.sub} />
                  <Text style={[styles.metricChipText, active && styles.metricChipTextActive]}>{m.displayName}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {requirements.map((req) => {
          const metric = metrics.find((m) => m.key === req.metricKey);
          if (!metric) return null;
          return (
            <View key={req.metricKey} style={styles.targetRow}>
              <Text style={styles.targetLabel}>{metric.displayName}</Text>
              <TextInput keyboardAppearance="dark"
                style={styles.targetInput}
                value={displayTarget(req.target, metric)}
                onChangeText={(t) => setRequirements((prev) => prev.map((r) => (r.metricKey === req.metricKey ? { ...r, target: parseTarget(t, metric) } : r)))}
                keyboardType="decimal-pad"
                placeholderTextColor={colors.sub}
              />
              <Text style={styles.targetUnit}>{metric.unit} / day</Text>
            </View>
          );
        })}

        <Text style={styles.label}>Runs for</Text>
        <View style={styles.optionRow}>
          {DURATION_OPTIONS.map((d) => (
            <Pressable key={d} style={[styles.option, durationDays === d && styles.optionActive]} onPress={() => setDurationDays(d)}>
              <Text style={[styles.optionText, durationDays === d && styles.optionTextActive]}>{d} days</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Starts</Text>
        <View style={styles.optionRow}>
          {START_OPTIONS.map((o) => (
            <Pressable key={o.days} style={[styles.option, startInDays === o.days && styles.optionActive]} onPress={() => setStartInDays(o.days)}>
              <Text style={[styles.optionText, startInDays === o.days && styles.optionTextActive]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>Begins at midnight. People can join and withdraw for a full refund up until then.</Text>

        <Text style={styles.label}>Stake per person</Text>
        <View style={styles.optionRow}>
          {STAKE_PRESETS_CENTS.map((c) => (
            <Pressable
              key={c}
              style={[styles.option, !customStake.trim() && stakeCents === c && styles.optionActive]}
              onPress={() => { setStakeCents(c); setCustomStake(""); }}
            >
              <Text style={[styles.optionText, !customStake.trim() && stakeCents === c && styles.optionTextActive]}>{formatCents(c)}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput keyboardAppearance="dark"
          style={styles.input}
          value={customStake}
          onChangeText={setCustomStake}
          placeholder="Custom amount (R)"
          placeholderTextColor={colors.sub}
          keyboardType="decimal-pad"
        />
        {resolvedStake > 0 && !Number.isNaN(resolvedStake) && (
          <Text style={styles.hint}>
            With 10 people staking {formatCents(resolvedStake)}, the pool would be {formatCents(poolPreview)} — split among whoever finishes.
          </Text>
        )}

        <Text style={styles.label}>Who can join</Text>
        <View style={styles.optionRow}>
          <Pressable style={[styles.option, isPublic && styles.optionActive]} onPress={() => setIsPublic(true)}>
            <Text style={[styles.optionText, isPublic && styles.optionTextActive]}>Anyone</Text>
          </Pressable>
          <Pressable style={[styles.option, !isPublic && styles.optionActive]} onPress={() => setIsPublic(false)}>
            <Text style={[styles.optionText, !isPublic && styles.optionTextActive]}>Invite code</Text>
          </Pressable>
        </View>

        <Pressable style={[styles.cta, !canSubmit && styles.ctaDisabled]} disabled={!canSubmit} onPress={submit}>
          {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.ctaText}>Create Pool</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { fontFamily: fonts.display, fontSize: 24, color: colors.text },
  subheader: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginTop: 2, marginBottom: spacing.lg },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: spacing.sm, lineHeight: 17 },
  input: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, fontFamily: fonts.body, fontSize: 14, color: colors.text },

  metricRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  metricChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface, borderRadius: radii.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  metricChipActive: { backgroundColor: colors.accent },
  metricChipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.sub },
  metricChipTextActive: { color: colors.onAccent },

  targetRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  targetLabel: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.text, width: 90 },
  targetInput: { flex: 1, backgroundColor: colors.surface, borderRadius: radii.sm, padding: spacing.md, fontFamily: fonts.body, fontSize: 14, color: colors.text },
  targetUnit: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, width: 70 },

  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: { backgroundColor: colors.surface, borderRadius: radii.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  optionActive: { backgroundColor: colors.accent },
  optionText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.sub },
  optionTextActive: { color: colors.onAccent },

  cta: { backgroundColor: colors.accent, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xxl },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.onAccent },
});
