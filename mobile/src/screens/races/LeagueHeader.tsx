import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { iconFor } from "../../theme/metricIcons";
import type { LeagueStandings, MetricStanding } from "../../api/raceTypes";

/**
 * League standing, per metric.
 *
 * Leads with the selected metric — the progression they're inspecting — and
 * shows all four compactly beneath it so the large panel can be switched
 * directly. There is
 * deliberately no combined total and no global rank: a user's running league
 * says nothing about their swimming, so summing them would invent a number
 * that means nothing, and a rank that slides backwards during a bad run is
 * the one signal they cannot improve by trying harder.
 */

const METRIC_ICON: Record<string, string> = {
  steps: "footprints",
  running: "running",
  cycling: "bike",
  swimming: "waves",
};

export function LeagueHeader({
  standings,
  onSelectMetric,
}: {
  standings: LeagueStandings | null;
  onSelectMetric?: (metricKey: string) => void;
}) {
  if (!standings) {
    return (
      <View style={styles.card}>
        <Text style={styles.loading}>Loading your leagues…</Text>
      </View>
    );
  }

  const primary =
    standings.standings.find((s) => s.metricKey === standings.primaryMetricKey) ?? standings.standings[0];

  if (!primary) return null;

  return (
    <View style={styles.card}>
      <PrimaryStanding standing={primary} />

      {standings.standings.length > 0 && (
        <View style={styles.otherRow}>
          {standings.standings.map((s) => (
            <CompactStanding
              key={s.metricKey}
              standing={s}
              active={s.metricKey === primary.metricKey}
              onPress={() => onSelectMetric?.(s.metricKey)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function PrimaryStanding({ standing }: { standing: MetricStanding }) {
  const progress = standing.bandProgress ?? 0;

  return (
    <>
      <View style={styles.topRow}>
        <View style={styles.metricLabelRow}>
          <Ionicons name={iconFor(METRIC_ICON[standing.metricKey] ?? "")} size={14} color={colors.sub} />
          <Text style={styles.label}>{standing.metricName} league</Text>
        </View>
        <View style={styles.pointsBlock}>
          <Text style={styles.pointsValue}>{standing.totalPoints}</Text>
          <Text style={styles.label}>points</Text>
        </View>
      </View>

      <Text style={styles.leagueName}>{standing.currentLeague?.name ?? "Unranked"}</Text>

      {standing.nextLeague && (
        <>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {standing.pointsToNextLeague === 0
              ? `You've earned ${standing.nextLeague.name}`
              : `${standing.pointsToNextLeague} ${standing.pointsToNextLeague === 1 ? "point" : "points"} to ${standing.nextLeague.name}`}
          </Text>
        </>
      )}

      {/*
        Promotion earned but the league is not open yet. Worth saying plainly:
        the user did the work, and the delay is about there being enough
        racers at that level in THIS metric, not about them.
      */}
      {standing.qualifiedForUnopenedLevel !== null && (
        <View style={styles.pendingBanner}>
          <Text style={styles.pendingText}>
            Promotion earned — opens once enough {standing.metricName.toLowerCase()} racers reach this level.
          </Text>
        </View>
      )}

      <View style={styles.statsRow}>
        <Stat label="Races" value={String(standing.racesEntered)} />
        <Stat label="Wins" value={String(standing.racesWon)} />
      </View>
    </>
  );
}

/**
 * One of the four metric selector blocks.
 *
 * Shown even at zero, because "you have a swimming league and it starts at
 * Bronze" is information — hiding untouched metrics would make the four
 * independent progressions invisible until you happened to race one.
 */
function CompactStanding({ standing, active, onPress }: { standing: MetricStanding; active: boolean; onPress?: () => void }) {
  return (
    <Pressable style={[styles.compact, active && styles.compactActive]} onPress={onPress} disabled={!onPress}>
      <Ionicons name={iconFor(METRIC_ICON[standing.metricKey] ?? "")} size={14} color={active ? colors.accent : colors.sub} />
      <Text style={[styles.compactMetric, active && styles.compactMetricActive]} numberOfLines={1}>
        {standing.metricName}
      </Text>
      <Text style={styles.compactLeague} numberOfLines={1}>
        {standing.currentLeague?.name ?? "—"}
      </Text>
      <Text style={styles.compactPoints}>{standing.totalPoints} pts</Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg },
  loading: { fontFamily: fonts.body, fontSize: 13, color: colors.sub },

  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  metricLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, textTransform: "uppercase", letterSpacing: 0.6 },
  leagueName: { fontFamily: fonts.display, textTransform: "uppercase", fontSize: 24, color: colors.text, marginTop: 2 },
  pointsBlock: { alignItems: "flex-end" },
  pointsValue: { fontFamily: fonts.bodyBold, fontSize: 26, color: colors.accent },

  track: { height: 8, backgroundColor: colors.surfaceRaised, borderRadius: radii.pill, marginTop: spacing.lg, overflow: "hidden" },
  fill: { height: 8, backgroundColor: colors.accent, borderRadius: radii.pill },
  progressText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.sub, marginTop: spacing.sm },

  pendingBanner: { marginTop: spacing.md, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md },
  pendingText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.won },

  statsRow: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.lg },
  statValue: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.text },

  otherRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceRaised,
    paddingTop: spacing.md,
  },
  compact: {
    flex: 1,
    minWidth: 118,
    alignItems: "center",
    gap: 2,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
  },
  compactActive: { borderWidth: 1, borderColor: colors.accent },
  compactMetric: { fontFamily: fonts.bodySemiBold, fontSize: 10, color: colors.sub, textTransform: "uppercase" },
  compactMetricActive: { color: colors.accent },
  compactLeague: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.text },
  compactPoints: { fontFamily: fonts.body, fontSize: 10, color: colors.sub },
});
