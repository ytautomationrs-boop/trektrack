import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { LoadError } from "../../components/LoadError";
import { showAlert } from "../../lib/alert";
import { shareCode } from "../../lib/shareCode";
import { iconFor } from "../../theme/metricIcons";
import { createRace, getLeagueStandings, getRaceTypes } from "../../api/raceClient";
import type { LeagueStandings, RaceFormat, RaceType } from "../../api/raceTypes";
import type { MetricKey } from "../../api/types";

/**
 * Create a race.
 *
 * The creator sets exactly five things: name, metric, duration, format,
 * visibility. Everything with money attached — entry fee, prize breakdown,
 * field size — is platform configuration, shown here read-only.
 *
 * That split is the model, not a missing feature. A creator who could set
 * their own prize would make the prize a function of what entrants paid in,
 * which is the pooled structure this app deliberately does not use.
 *
 * Also deliberately absent, all of which the old create-wizard had: stake
 * amount, tier selection, multi-metric selection, pace targets, custom
 * duration, and the redemption / forgiven-miss purchase.
 */

const METRICS: Array<{ key: MetricKey; label: string; icon: string }> = [
  { key: "steps", label: "Steps", icon: "footprints" },
  { key: "running", label: "Running", icon: "running" },
  { key: "cycling", label: "Cycling", icon: "bike" },
  { key: "swimming", label: "Swimming", icon: "waves" },
];

const DURATIONS: Array<{ days: 1 | 7; label: string; hint: string }> = [
  { days: 1, label: "1 day", hint: "One big push" },
  { days: 7, label: "7 days", hint: "A full week" },
];

function formatCents(cents: number) {
  return `R${(cents / 100).toLocaleString()}`;
}

function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

export function CreateRaceScreen() {
  const navigation = useNavigation<any>();

  const [name, setName] = useState("");
  const [metricKey, setMetricKey] = useState<MetricKey>("steps");
  const [durationDays, setDurationDays] = useState<1 | 7>(7);
  const [format, setFormat] = useState<RaceFormat>("INDIVIDUAL");
  const [squadName, setSquadName] = useState("");
  const [busy, setBusy] = useState(false);

  const [raceTypes, setRaceTypes] = useState<RaceType[]>([]);
  const [standings, setStandings] = useState<LeagueStandings | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<Error | null>(null);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const [typesResult, standingsResult] = await Promise.all([getRaceTypes(), getLeagueStandings()]);
      if (typesResult.raceTypes.length === 0) throw new Error("Race fees and prizes are not configured yet.");
      setRaceTypes(typesResult.raceTypes);
      setStandings(standingsResult);
      setConfigError(null);
    } catch (err) {
      setRaceTypes([]);
      setStandings(null);
      setConfigError(err as Error);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // The race runs in the creator's league FOR THE SELECTED METRIC — someone
  // deep in the running leagues still creates a swimming race at their
  // swimming level, which for a first-time swimmer is Bronze.
  const metricStanding = standings?.standings.find((s) => s.metricKey === metricKey) ?? null;
  const league = metricStanding?.currentLeague ?? null;

  // The selected combination's platform config: fee, prizes, field size.
  // Read-only here — it comes from the league's standing schedule.
  const selected = useMemo(() => {
    const key = `${metricKey}_${durationDays}d_${format === "SQUAD" ? "squad" : "individual"}`;
    const type = raceTypes.find((t) => t.key === key);
    if (!type || !league) return null;
    const schedule = type.schedules.find((s) => s.leagueLevel === league.level);
    if (!schedule) return null;
    return { type, schedule };
  }, [raceTypes, metricKey, durationDays, format, league]);

  const peopleNeeded = selected ? selected.type.totalEntrants : format === "SQUAD" ? 16 : 10;
  const canSubmit =
    name.trim().length >= 3 && selected != null && !busy && (format === "INDIVIDUAL" || squadName.trim().length >= 2);

  const submit = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await createRace({
        name: name.trim(),
        metricKey,
        durationDays,
        format,
        squadName: format === "SQUAD" ? squadName.trim() : undefined,
      });
      const code = result.inviteCode;
      showAlert(
        "Race created",
        `You're entrant 1 of ${peopleNeeded}. Share your code — the race starts the moment it's full, and if it doesn't fill everyone gets their entry back in full.` +
          (code ? `\n\nCode: ${code}` : ""),
        [
          code
            ? {
                text: "Share code",
                onPress: () =>
                  void shareCode({
                    message: `Join my race "${name.trim()}" on Streak — race code: ${code}`,
                    title: "Race code",
                    code,
                  }),
              }
            : { text: "OK" },
          {
            text: "View race",
            onPress: () => navigation.navigate("Races", { screen: "RaceDetail", params: { raceId: result.race.id } }),
          },
        ]
      );
      setName("");
      setSquadName("");
    } catch (err: any) {
      showAlert(
        err.code === "insufficient_balance" ? "Top up first" : "Couldn't create race",
        err.message ?? "Something went wrong."
      );
    } finally {
      setBusy(false);
    }
  }, [selected, name, metricKey, durationDays, format, squadName, peopleNeeded, navigation]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>Create a race</Text>
        <Text style={styles.subheader}>
          Private race in your {metricStanding?.metricName ?? ""} league — you invite the entrants.
        </Text>

        {/* a) NAME */}
        <Text style={styles.label}>Race name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Friday Night Steps"
          placeholderTextColor={colors.sub}
          maxLength={50}
        />
        <Text style={styles.charCount}>{name.length}/50</Text>

        {/* b) METRIC — exactly one */}
        <Text style={styles.label}>Metric</Text>
        <Text style={styles.labelHint}>
          One metric per race. Mixing them would mean weighting, say, swum metres against run
          metres — there's no fair way to do that in a single ranking.
        </Text>
        <View style={styles.grid}>
          {METRICS.map((m) => {
            const active = metricKey === m.key;
            return (
              <Pressable key={m.key} style={[styles.gridItem, active && styles.gridItemActive]} onPress={() => setMetricKey(m.key)}>
                <Ionicons name={iconFor(m.icon)} size={20} color={active ? colors.bg : colors.accent} />
                <Text style={[styles.gridItemText, active && styles.gridItemTextActive]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* c) DURATION — exactly two options */}
        <Text style={styles.label}>Duration</Text>
        <View style={styles.row}>
          {DURATIONS.map((d) => {
            const active = durationDays === d.days;
            return (
              <Pressable key={d.days} style={[styles.rowItem, active && styles.rowItemActive]} onPress={() => setDurationDays(d.days)}>
                <Text style={[styles.rowItemText, active && styles.rowItemTextActive]}>{d.label}</Text>
                <Text style={[styles.rowItemHint, active && styles.rowItemHintActive]}>{d.hint}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* d) FORMAT — fixed headcount either way */}
        <Text style={styles.label}>Format</Text>
        <View style={styles.row}>
          <Pressable
            style={[styles.rowItem, format === "INDIVIDUAL" && styles.rowItemActive]}
            onPress={() => setFormat("INDIVIDUAL")}
          >
            <Text style={[styles.rowItemText, format === "INDIVIDUAL" && styles.rowItemTextActive]}>Solo</Text>
            <Text style={[styles.rowItemHint, format === "INDIVIDUAL" && styles.rowItemHintActive]}>Exactly 10 racers</Text>
          </Pressable>
          <Pressable style={[styles.rowItem, format === "SQUAD" && styles.rowItemActive]} onPress={() => setFormat("SQUAD")}>
            <Text style={[styles.rowItemText, format === "SQUAD" && styles.rowItemTextActive]}>Squad</Text>
            <Text style={[styles.rowItemHint, format === "SQUAD" && styles.rowItemHintActive]}>Exactly 2 squads of 4</Text>
          </Pressable>
        </View>

        {format === "SQUAD" && (
          <>
            <Text style={styles.label}>Your squad's name</Text>
            <TextInput
              style={styles.input}
              value={squadName}
              onChangeText={setSquadName}
              placeholder="Trail Blazers"
              placeholderTextColor={colors.sub}
              maxLength={30}
            />
          </>
        )}

        {/* e) VISIBILITY */}
        <Text style={styles.label}>Who can join</Text>
        <View style={styles.visibilityCard}>
          <View style={styles.visibilityRow}>
            <Ionicons name="lock-closed" size={16} color={colors.sage} />
            <Text style={styles.visibilityTitle}>Invite only</Text>
          </View>
          <Text style={styles.visibilityBody}>
            You'll get a code to share. Only people with the code can enter.
          </Text>
          {/*
            Public races exist, but Streak opens them — not users. Everyone in
            a league queues for the same public races, which is what lets them
            reach their exact headcount at all. Explaining that beats hiding
            the option and leaving the absence unexplained.
          */}
          <Text style={styles.visibilityNote}>
            Public races are opened by Streak so everyone in the same {metricStanding?.metricName ?? ""}{" "}
            league queues for the same ones. Browse those under Discover.
          </Text>
        </View>

        {/* READ-ONLY: what the platform sets */}
        <Text style={styles.label}>Entry fee and prizes</Text>
        <Text style={styles.labelHint}>
          Set by Streak for {metricStanding?.metricName ?? ""} {league?.name ?? "your league"} — not by you.
          Each metric has its own leagues, so this changes with the metric you pick.
        </Text>

        {configError ? (
          <View style={styles.feeCard}>
            <LoadError error={configError} onRetry={loadConfig} />
          </View>
        ) : selected ? (
          <View style={styles.feeCard}>
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>Entry fee</Text>
              <Text style={styles.feeValue}>{formatCents(selected.schedule.entryFeeCents)}</Text>
            </View>
            <View style={styles.divider} />

            {selected.schedule.prizes.map((p) => (
              <View key={p.position} style={styles.prizeRow}>
                <Text style={styles.prizePos}>{ordinal(p.position)}</Text>
                <Text style={styles.prizeAmount}>{formatCents(p.amountCents)}</Text>
              </View>
            ))}

            <Text style={styles.prizeFootnote}>
              {format === "SQUAD"
                ? `One prize to the winning squad, split evenly among its ${selected.type.squadSize} members.`
                : `${ordinal(selected.schedule.prizes.length + 1)}–${ordinal(selected.type.entrantCount)} pay nothing.`}{" "}
              These are fixed in advance. They don't change with how many people enter or what the
              entry fees add up to.
            </Text>
          </View>
        ) : (
          <View style={styles.feeCard}>
            {configLoading ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <View style={styles.emptyConfig}>
                <Text style={styles.emptyConfigTitle}>No pricing found for this setup.</Text>
                <Text style={styles.emptyConfigText}>Try a different metric or press retry to reload the race catalog.</Text>
                <Pressable style={styles.retryButton} onPress={loadConfig}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* The existence condition, stated before they commit money. */}
        <View style={styles.conditionCard}>
          <Text style={styles.conditionTitle}>This race needs exactly {peopleNeeded} racers</Text>
          <Text style={styles.conditionBody}>
            It doesn't start until all {peopleNeeded} are in — you'll need {peopleNeeded - 1} more
            {format === "SQUAD" ? " people across 2 squads" : ""}. If it doesn't fill before entries close,
            the race doesn't run and <Text style={styles.conditionStrong}>every entry fee is refunded in full</Text>.
          </Text>
          <Text style={styles.conditionBody}>
            Creating it enters you as racer 1 and charges your entry fee now.
          </Text>
        </View>

        <Pressable style={[styles.cta, !canSubmit && styles.ctaDisabled]} disabled={!canSubmit} onPress={submit}>
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.ctaText}>
              Create &amp; enter{selected ? ` · ${formatCents(selected.schedule.entryFeeCents)}` : ""}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { fontFamily: fonts.display, fontSize: 30, color: colors.text },
  subheader: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginTop: 2, marginBottom: spacing.lg },

  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  labelHint: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginBottom: spacing.md, lineHeight: 17 },

  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  charCount: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, textAlign: "right", marginTop: 4 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  gridItem: {
    flexGrow: 1,
    flexBasis: "45%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  gridItemActive: { backgroundColor: colors.accent },
  gridItemText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text },
  gridItemTextActive: { color: colors.bg },

  row: { flexDirection: "row", gap: spacing.sm },
  rowItem: { flex: 1, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg },
  rowItemActive: { backgroundColor: colors.accent },
  rowItemText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  rowItemTextActive: { color: colors.bg },
  rowItemHint: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 2 },
  rowItemHintActive: { color: colors.bg, opacity: 0.75 },

  visibilityCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg },
  visibilityRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  visibilityTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  visibilityBody: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: spacing.sm, lineHeight: 17 },
  visibilityNote: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.sub,
    marginTop: spacing.md,
    lineHeight: 16,
    fontStyle: "italic",
  },

  feeCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg },
  emptyConfig: { alignItems: "center", gap: spacing.sm },
  emptyConfigTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text, textAlign: "center" },
  emptyConfigText: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, textAlign: "center", lineHeight: 17 },
  retryButton: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  retryButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.text },
  feeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  feeLabel: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text },
  feeValue: { fontFamily: fonts.display, fontSize: 20, color: colors.accent },
  divider: { height: 1, backgroundColor: colors.surfaceRaised, marginVertical: spacing.md },
  prizeRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  prizePos: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.sub },
  prizeAmount: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.won },
  prizeFootnote: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: spacing.md, lineHeight: 16 },

  conditionCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  conditionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  conditionBody: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: spacing.sm, lineHeight: 18 },
  conditionStrong: { fontFamily: fonts.bodySemiBold, color: colors.sage },

  cta: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    marginTop: spacing.xl,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.bg },
});
