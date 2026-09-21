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
import { showAlert } from "../../lib/alert";
import { shareCode } from "../../lib/shareCode";
import { iconFor } from "../../theme/metricIcons";
import { createRace, getLeagueStandings, getRaceTypes } from "../../api/raceClient";
import type { LeagueStandings, RaceFormat, RaceType } from "../../api/raceTypes";
import type { MetricKey } from "../../api/types";
import { raceUrl } from "../../lib/webLinks";

/**
 * Create a race.
 *
 * The creator sets the competition shape and entry fee. Prize money is
 * calculated from that fee and snapshotted server-side when the race is
 * created, so everyone sees the same fixed prize schedule before joining.
 *
 * Also deliberately absent, all of which the old create-wizard had: stake
 * amount, tier selection, multi-metric selection, pace targets, custom
 * duration, and the redemption / forgiven-miss purchase.
 */

const METRICS: Array<{ key: MetricKey; label: string; icon: string }> = [
  { key: "steps", label: "Walking", icon: "footprints" },
  { key: "running", label: "Running", icon: "running" },
  { key: "cycling", label: "Cycling", icon: "bike" },
  { key: "swimming", label: "Swimming", icon: "waves" },
];

const DURATIONS: Array<{ days: number; label: string; hint: string }> = [
  { days: 1, label: "1 day", hint: "One big push" },
  { days: 7, label: "7 days", hint: "A full week" },
  { days: 14, label: "14 days", hint: "Two-week test" },
  { days: 30, label: "30 days", hint: "Month-long" },
];

const LEAGUE_NAMES = ["Bronze", "Iron", "Steel", "Silver", "Gold", "Platinum"];
const PRIZE_MULTIPLIERS = [
  { position: 1, multiplier: 3 },
  { position: 2, multiplier: 2 },
  { position: 3, multiplier: 1.5 },
  { position: 4, multiplier: 1 },
  { position: 5, multiplier: 0.5 },
] as const;
const TROPHY_SCALE = [6, 4, 3, 2, 1, 0, -1, -2, -3, -4] as const;

const TROPHY_META: Record<MetricKey, { label: string; icon: string; color: string }> = {
  steps: { label: "Walking trophies", icon: "footprints", color: "#e6dcd0" },
  running: { label: "Running trophies", icon: "running", color: "#ff2f3f" },
  cycling: { label: "Cycling trophies", icon: "bike", color: "#64d48a" },
  swimming: { label: "Swimming trophies", icon: "waves", color: "#38bdf8" },
};

const METRIC_META: Record<MetricKey, RaceType["metricType"]> = {
  steps: { key: "steps", displayName: "Walking", unit: "steps", valueType: "COUNT", icon: "footprints" },
  running: { key: "running", displayName: "Running", unit: "km", valueType: "DISTANCE_METERS", icon: "running" },
  cycling: { key: "cycling", displayName: "Cycling", unit: "km", valueType: "DISTANCE_METERS", icon: "bike" },
  swimming: { key: "swimming", displayName: "Swimming", unit: "m", valueType: "DISTANCE_METERS", icon: "waves" },
};

const BASE_FEES = {
  individual7: 5000,
  individual1: 2500,
  squad7: 5000,
  squad1: 2500,
} as const;

function prizesForEntryFee(entryFeeCents: number, rankedPositions: number) {
  return PRIZE_MULTIPLIERS.filter((tier) => tier.position <= rankedPositions).map((tier) => ({
    position: tier.position,
    amountCents: Math.round(entryFeeCents * tier.multiplier),
  }));
}

function scaleSchedule(baseEntryFeeCents: number, level: number, rankedPositions: number) {
  const entryFeeCents = baseEntryFeeCents + (level - 1) * 500;
  const prizes = prizesForEntryFee(entryFeeCents, rankedPositions);
  return { entryFeeCents, prizes };
}

function baseScheduleFor(format: RaceFormat, durationDays: number) {
  if (format === "SQUAD") return durationDays === 1 ? BASE_FEES.squad1 : BASE_FEES.squad7;
  return durationDays === 1 ? BASE_FEES.individual1 : BASE_FEES.individual7;
}

function buildLaunchRaceTypes(): RaceType[] {
  return METRICS.flatMap((metric) =>
    DURATIONS.flatMap((duration) =>
      (["INDIVIDUAL", "SQUAD"] as const).map((format) => {
        const key = `${metric.key}_${duration.days}d_${format === "SQUAD" ? "squad" : "individual"}`;
        const entrantCount = format === "SQUAD" ? 2 : 10;
        const squadSize = format === "SQUAD" ? 4 : null;
        return {
          key,
          displayName: `${metric.label} · ${duration.days} day${duration.days === 1 ? "" : "s"} · ${format === "SQUAD" ? "Squad" : "Solo"}`,
          isActive: ["running_1d_individual", "running_7d_individual", "cycling_7d_individual"].includes(key),
          allowUserCreated: true,
          format,
          metricKey: metric.key,
          metricType: METRIC_META[metric.key],
          durationDays: duration.days,
          entrantCount,
          squadSize,
          totalEntrants: entrantCount * (squadSize ?? 1),
          schedules: LEAGUE_NAMES.map((leagueName, index) => {
            const leagueLevel = index + 1;
            const scaled = scaleSchedule(baseScheduleFor(format, duration.days), leagueLevel, entrantCount);
            return {
              leagueLevel,
              leagueName,
              leagueIsOpen: leagueLevel === 1,
              entryFeeCents: scaled.entryFeeCents,
              currency: "zar",
              prizes: scaled.prizes,
              totalPrizeCents: scaled.prizes.reduce((sum, prize) => sum + prize.amountCents, 0),
            };
          }),
        };
      })
    )
  );
}

const LAUNCH_RACE_TYPES = buildLaunchRaceTypes();

function fallbackStandings(): LeagueStandings {
  return {
    primaryMetricKey: "steps",
    standings: METRICS.map((metric) => ({
      metricKey: metric.key,
      metricName: metric.label,
      totalPoints: 0,
      racesEntered: 0,
      racesWon: 0,
      currentLeague: { level: 1, name: "Bronze", minPoints: 0 },
      nextLeague: { level: 2, name: "Iron", minPoints: 15, isOpen: false },
      pointsToNextLeague: 15,
      bandProgress: 0,
      qualifiedForUnopenedLevel: null,
    })),
  };
}

function formatCents(cents: number) {
  return `R${(cents / 100).toLocaleString()}`;
}

function parseEntryFeeCents(value: string) {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

function defaultRaceName(metricKey: MetricKey, durationDays: number, format: RaceFormat) {
  const metric = METRICS.find((m) => m.key === metricKey)?.label ?? "Competition";
  return `${metric} ${durationDays}-day ${format === "SQUAD" ? "squad" : "solo"} race`;
}

export function CreateRaceScreen() {
  const navigation = useNavigation<any>();

  const [name, setName] = useState("");
  const [metricKey, setMetricKey] = useState<MetricKey>("steps");
  const [durationDays, setDurationDays] = useState(7);
  const [durationText, setDurationText] = useState("7");
  const [format, setFormat] = useState<RaceFormat>("INDIVIDUAL");
  const [visibility, setVisibility] = useState<"PRIVATE" | "PUBLIC">("PRIVATE");
  const [entryFeeText, setEntryFeeText] = useState("");
  const [squadName, setSquadName] = useState("");
  const [busy, setBusy] = useState(false);

  const [raceTypes, setRaceTypes] = useState<RaceType[]>(LAUNCH_RACE_TYPES);
  const [standings, setStandings] = useState<LeagueStandings>(fallbackStandings());
  const [configLoading, setConfigLoading] = useState(false);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    const [typesResult, standingsResult] = await Promise.allSettled([getRaceTypes(), getLeagueStandings()]);

    if (typesResult.status === "fulfilled" && typesResult.value.raceTypes.length > 0) {
      setRaceTypes(typesResult.value.raceTypes);
    }
    if (standingsResult.status === "fulfilled") {
      setStandings(standingsResult.value);
    }
    setConfigLoading(false);
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // The race runs in the creator's league FOR THE SELECTED METRIC — someone
  // deep in the running leagues still creates a swimming race at their
  // swimming level, which for a first-time swimmer is Bronze.
  const metricStanding = standings.standings.find((s) => s.metricKey === metricKey) ?? null;
  const league = metricStanding?.currentLeague ?? null;

  // The selected combination's default config: fee, prizes, field size.
  const selected = useMemo(() => {
    const key = `${metricKey}_${durationDays}d_${format === "SQUAD" ? "squad" : "individual"}`;
    const type = raceTypes.find((t) => t.key === key);
    if (!league) return null;
    if (type) {
      const schedule = type.schedules.find((s) => s.leagueLevel === league.level);
      if (schedule) return { type, schedule };
    }
    const entrantCount = format === "SQUAD" ? 2 : 10;
    const squadSize = format === "SQUAD" ? 4 : null;
    const entryFeeCents = baseScheduleFor(format, durationDays) + (league.level - 1) * 500;
    return {
      type: {
        key,
        displayName: defaultRaceName(metricKey, durationDays, format),
        isActive: false,
        allowUserCreated: true,
        format,
        metricKey,
        metricType: METRIC_META[metricKey],
        durationDays,
        entrantCount,
        squadSize,
        totalEntrants: entrantCount * (squadSize ?? 1),
        schedules: [],
      },
      schedule: {
        leagueLevel: league.level,
        leagueName: league.name,
        leagueIsOpen: true,
        entryFeeCents,
        currency: "zar",
        prizes: prizesForEntryFee(entryFeeCents, entrantCount),
        totalPrizeCents: prizesForEntryFee(entryFeeCents, entrantCount).reduce((sum, prize) => sum + prize.amountCents, 0),
      },
    };
  }, [raceTypes, metricKey, durationDays, format, league]);

  const peopleNeeded = selected ? selected.type.totalEntrants : format === "SQUAD" ? 16 : 10;
  const resolvedRaceName = name.trim() || defaultRaceName(metricKey, durationDays, format);
  const resolvedSquadName = squadName.trim() || "My Squad";
  const defaultEntryFeeCents = selected?.schedule.entryFeeCents ?? baseScheduleFor(format, durationDays);
  const customEntryFeeCents = parseEntryFeeCents(entryFeeText);
  const resolvedEntryFeeCents = customEntryFeeCents ?? defaultEntryFeeCents;
  const entryFeeIsValid = resolvedEntryFeeCents >= 100 && resolvedEntryFeeCents <= 1_000_000;
  const displaySchedule = selected
    ? {
        entryFeeCents: resolvedEntryFeeCents,
        prizes: prizesForEntryFee(resolvedEntryFeeCents, selected.type.entrantCount),
      }
    : null;
  const trophyMeta = TROPHY_META[metricKey];
  const canSubmit = selected != null && entryFeeIsValid && !busy;

  const submit = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await createRace({
        name: resolvedRaceName,
        metricKey,
        durationDays,
        format,
        entryFeeCents: resolvedEntryFeeCents,
        visibility,
        squadName: format === "SQUAD" ? resolvedSquadName : undefined,
      });
      const code = result.inviteCode;
      const link = raceUrl(result.race.id, code);
      showAlert(
        "Race created",
        `You're entrant 1 of ${peopleNeeded}. ${
          visibility === "PRIVATE" ? "Share your race link with the people you invite." : "Anyone in your league can now find and join it."
        } The race starts the moment it's full, and if it doesn't fill everyone gets their entry back in full.` + (code ? `\n\nCode: ${code}` : ""),
        [
          {
            text: "Share link",
            onPress: () =>
              void shareCode({
                message: `Join my race "${resolvedRaceName}" on TrackTrek.\n${link}`,
                title: "Race link",
                code: link,
              }),
          },
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
  }, [selected, resolvedRaceName, metricKey, durationDays, format, resolvedEntryFeeCents, resolvedSquadName, visibility, peopleNeeded, navigation]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable
          style={styles.backRow}
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Competitions"))}
        >
          <Ionicons name="chevron-back" size={18} color={colors.sub} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
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
          placeholder={defaultRaceName(metricKey, durationDays, format)}
          placeholderTextColor={colors.sub}
          maxLength={50}
        />
        <Text style={styles.charCount}>{name.length ? `${name.length}/50` : "Optional"}</Text>

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

        {/* c) DURATION */}
        <Text style={styles.label}>Duration</Text>
        <Text style={styles.labelHint}>Choose how many days the competition lasts. Whole days only.</Text>
        <View style={styles.durationInputRow}>
          <TextInput
            style={[styles.input, styles.durationInput]}
            value={durationText}
            onChangeText={(value) => {
              const sanitized = value.replace(/[^\d]/g, "").slice(0, 2);
              setDurationText(sanitized);
              const days = Number(sanitized);
              if (Number.isInteger(days) && days >= 1 && days <= 30) setDurationDays(days);
            }}
            placeholder="7"
            placeholderTextColor={colors.sub}
            keyboardType="number-pad"
          />
          <Text style={styles.durationSuffix}>days</Text>
        </View>
        <View style={styles.rowWrap}>
          {DURATIONS.map((d) => {
            const active = durationDays === d.days;
            return (
              <Pressable
                key={d.days}
                style={[styles.durationChip, active && styles.rowItemActive]}
                onPress={() => {
                  setDurationDays(d.days);
                  setDurationText(String(d.days));
                }}
              >
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
              placeholder="My Squad"
              placeholderTextColor={colors.sub}
              maxLength={30}
            />
          </>
        )}

        {/* e) VISIBILITY */}
        <Text style={styles.label}>Who can join</Text>
        <View style={styles.row}>
          <Pressable
            style={[styles.rowItem, visibility === "PRIVATE" && styles.rowItemActive]}
            onPress={() => setVisibility("PRIVATE")}
          >
            <Text style={[styles.rowItemText, visibility === "PRIVATE" && styles.rowItemTextActive]}>Invite only</Text>
            <Text style={[styles.rowItemHint, visibility === "PRIVATE" && styles.rowItemHintActive]}>Only people with your code</Text>
          </Pressable>
          <Pressable
            style={[styles.rowItem, visibility === "PUBLIC" && styles.rowItemActive]}
            onPress={() => setVisibility("PUBLIC")}
          >
            <Text style={[styles.rowItemText, visibility === "PUBLIC" && styles.rowItemTextActive]}>Public</Text>
            <Text style={[styles.rowItemHint, visibility === "PUBLIC" && styles.rowItemHintActive]}>Anyone in your league</Text>
          </Pressable>
        </View>

        {/* Entry fee controls the fixed prize snapshot. */}
        <Text style={styles.label}>Entry fee and prizes</Text>
        <Text style={styles.labelHint}>
          Set the entry fee. Prizes calculate from it automatically and are fixed before anyone joins.
        </Text>

        {selected && displaySchedule ? (
          <View style={styles.feeCard}>
            {configLoading && <ActivityIndicator color={colors.accent} style={styles.inlineLoader} />}
            <Text style={styles.inputLabel}>Entry fee (R)</Text>
            <TextInput
              style={[styles.input, styles.entryFeeInput, !entryFeeIsValid && styles.inputError]}
              value={entryFeeText}
              onChangeText={setEntryFeeText}
              placeholder={(defaultEntryFeeCents / 100).toString()}
              placeholderTextColor={colors.sub}
              keyboardType="decimal-pad"
            />
            {!entryFeeIsValid && <Text style={styles.errorText}>Use an entry fee from R1 to R10,000.</Text>}

            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>Prize formula</Text>
              <Text style={styles.feeValue}>{formatCents(displaySchedule.entryFeeCents)}</Text>
            </View>
            <View style={styles.divider} />

            {displaySchedule.prizes.map((p) => (
              <View key={p.position} style={styles.prizeRow}>
                <Text style={styles.prizePos}>{ordinal(p.position)}</Text>
                <Text style={styles.prizeAmount}>{formatCents(p.amountCents)}</Text>
              </View>
            ))}

            <Text style={styles.prizeFootnote}>
              {format === "SQUAD"
                ? `Prizes are awarded by squad position and split evenly among each squad's ${selected.type.squadSize} members.`
                : `${ordinal(displaySchedule.prizes.length + 1)}–${ordinal(selected.type.entrantCount)} pay nothing.`}{" "}
              1st gets 3x entry, 2nd 2x, 3rd 1.5x, 4th 1x, and 5th 0.5x.
            </Text>

            <View style={styles.trophyCard}>
              <View style={styles.trophyHeader}>
                <Ionicons name={iconFor(trophyMeta.icon)} size={18} color={trophyMeta.color} />
                <Text style={styles.trophyTitle}>{trophyMeta.label}</Text>
              </View>
              <View style={styles.trophyGrid}>
                {TROPHY_SCALE.map((trophies, index) => {
                  const position = index + 1;
                  return (
                    <View key={position} style={[styles.trophyChip, { borderColor: trophyMeta.color }]}>
                      <Text style={[styles.trophyPosition, { color: trophyMeta.color }]}>{ordinal(position)}</Text>
                      <Text style={styles.trophyValue}>{trophies > 0 ? `+${trophies}` : trophies}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
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
            {format === "SQUAD" ? " people across 2 squads" : ""}. While it is still filling, entrants can withdraw
            and <Text style={styles.conditionStrong}>their entry fee is refunded in full</Text>.
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
              Create &amp; enter{selected ? ` · ${formatCents(resolvedEntryFeeCents)}` : ""}
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
  backRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.sub },
  header: { fontFamily: fonts.display, fontSize: 30, color: colors.text },
  subheader: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginTop: 2, marginBottom: spacing.lg },

  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  labelHint: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginBottom: spacing.md, lineHeight: 17 },

  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.lg,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  entryFeeInput: {
    borderColor: colors.accent2,
    borderWidth: 2,
    backgroundColor: colors.surfaceRaised,
    fontFamily: fonts.display,
    fontSize: 18,
  },
  inputLabel: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.sub, marginBottom: spacing.sm },
  inputError: { borderWidth: 1, borderColor: colors.fail },
  errorText: { fontFamily: fonts.body, fontSize: 11, color: colors.fail, marginTop: spacing.sm },
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
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  durationInputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  durationInput: { flex: 1, fontFamily: fonts.display, fontSize: 18 },
  durationSuffix: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  durationChip: { flexGrow: 1, flexBasis: "45%", backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md },
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
  inlineLoader: { alignSelf: "flex-start", marginBottom: spacing.sm },
  emptyConfig: { alignItems: "center", gap: spacing.sm },
  emptyConfigTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text, textAlign: "center" },
  emptyConfigText: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, textAlign: "center", lineHeight: 17 },
  retryButton: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  retryButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.text },
  feeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.md },
  feeLabel: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text },
  feeValue: { fontFamily: fonts.display, fontSize: 20, color: colors.accent },
  divider: { height: 1, backgroundColor: colors.surfaceRaised, marginVertical: spacing.md },
  prizeRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  prizePos: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.sub },
  prizeAmount: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.won },
  prizeFootnote: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: spacing.md, lineHeight: 16 },
  trophyCard: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.lg },
  trophyHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  trophyTitle: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.text },
  trophyGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  trophyChip: {
    width: "18%",
    minWidth: 52,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  trophyPosition: { fontFamily: fonts.bodySemiBold, fontSize: 11 },
  trophyValue: { fontFamily: fonts.display, fontSize: 14, color: colors.text, marginTop: 2 },

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
