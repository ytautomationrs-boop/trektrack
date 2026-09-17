import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { LoadError } from "../../components/LoadError";
import { iconFor } from "../../theme/metricIcons";
import { getMyRaces, getLeagueStandings } from "../../api/raceClient";
import type { LeagueStandings, RaceHistoryEntry } from "../../api/raceTypes";
import { LeagueHeader } from "./LeagueHeader";
import { shareCode } from "../../lib/shareCode";
import { useAppState } from "../../state/useAppState";

/**
 * "Your races" — the races this user is actually in.
 *
 * Lives inside the Competitions stack rather than owning a tab: with
 * StreakPot restored, the root tabs are one per MODEL (Pool /
 * Competitions), and "the ones I'm in" is a view within a model rather than
 * a peer of it.
 *
 * The framing is deliberate: a user enters a race, they do not place a bet,
 * and there is no daily target to tick off — so this shows standing and
 * progress rather than a row of pass/fail rings. (Pool's own screens do
 * show daily pass/fail, because that genuinely is StreakPot's shape.)
 */

function formatCents(cents: number) {
  return `${cents < 0 ? "-" : ""}R${Math.abs(cents / 100).toLocaleString()}`;
}

function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "Steps Bronze · 7 days · Solo" — one string, so casing stays predictable. */
function subtitleFor(entry: RaceHistoryEntry): string {
  const metric = entry.race.metricKey.charAt(0).toUpperCase() + entry.race.metricKey.slice(1);
  const days = `${entry.race.durationDays} day${entry.race.durationDays === 1 ? "" : "s"}`;
  const format = entry.race.format === "SQUAD" ? "Squad" : "Solo";
  const leagueName = entry.race.league?.name ?? `League ${entry.race.league?.level ?? entry.race.leagueLevel ?? 1}`;
  return `${metric} ${leagueName} · ${days} · ${format}`;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  FILLING: { label: "Waiting for racers", color: colors.risk },
  LOCKED: { label: "Locked — starts at midnight", color: colors.accent },
  RUNNING: { label: "Under way", color: colors.sage },
  RESOLVING: { label: "Working out results", color: colors.accent },
  COMPLETED: { label: "Finished", color: colors.won },
  CANCELLED_UNFILLED: { label: "Didn't fill — refunded", color: colors.sub },
};

export function MyRacesScreen() {
  const navigation = useNavigation<any>();
  const app = useAppState();
  const [entries, setEntries] = useState<RaceHistoryEntry[]>([]);
  const [standings, setStandings] = useState<LeagueStandings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [mine, leagues] = await Promise.allSettled([getMyRaces(), getLeagueStandings()]);

    if (mine.status === "fulfilled") {
      setEntries(mine.value.entries);
      setLoadError(null);
    } else {
      setLoadError(mine.reason as Error);
    }

    setStandings(leagues.status === "fulfilled" ? leagues.value : null);
    setLoading(false);
  }, []);

  // Refresh on focus: entering a race from the Competitions list should show
  // up here immediately, not after a manual pull.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const active = entries.filter((e) => e.race.status === "FILLING" || e.race.status === "LOCKED" || e.race.status === "RUNNING");
  const past = entries.filter((e) => e.race.status !== "FILLING" && e.race.status !== "LOCKED" && e.race.status !== "RUNNING");

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <Pressable style={styles.backRow} onPress={() => navigation.navigate("Competitions")}>
          <Ionicons name="chevron-back" size={18} color={colors.sub} />
          <Text style={styles.backText}>Competitions</Text>
        </Pressable>
        <Text style={styles.header}>Your races</Text>

        {!(loadError && !standings) && <LeagueHeader standings={standings} onSelectMetric={() => navigation.navigate("Profile")} />}

        {loading && entries.length === 0 && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />}

        {!loading && loadError && entries.length === 0 && <LoadError error={loadError} onRetry={load} />}

        {!loading && !loadError && active.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No races yet</Text>
            <Text style={styles.emptyBody}>
              Browse the open races and enter one — every race pays a fixed prize that's published before you join.
            </Text>
            <Pressable style={styles.emptyCta} onPress={() => navigation.navigate("Competitions")}>
              <Text style={styles.emptyCtaText}>Browse races</Text>
            </Pressable>
          </View>
        )}

        {active.length > 0 && <Text style={styles.sectionTitle}>Active</Text>}
        {active.map((e) => (
          <RaceRow key={e.id} entry={e} viewerUserId={app.session?.userId ?? null} onPress={() => navigation.navigate("RaceDetail", { raceId: e.raceId })} />
        ))}

        {past.length > 0 && <Text style={styles.sectionTitle}>Past</Text>}
        {past.map((e) => (
          <RaceRow key={e.id} entry={e} viewerUserId={app.session?.userId ?? null} onPress={() => navigation.navigate("RaceDetail", { raceId: e.raceId })} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function RaceRow({ entry, viewerUserId, onPress }: { entry: RaceHistoryEntry; viewerUserId: string | null; onPress: () => void }) {
  const meta = STATUS_META[entry.race.status] ?? { label: entry.race.status, color: colors.sub };
  const finished = entry.finishPosition != null;
  const canShareRace = entry.race.visibility === "PRIVATE" && entry.race.createdByUserId === viewerUserId && entry.race.inviteCode != null;

  const shareRace = () => {
    if (!entry.race.inviteCode) return;
    void shareCode({
      message: `Join my TrackTrek competition "${entry.race.name}" — race code: ${entry.race.inviteCode}`,
      title: "Race code",
      code: entry.race.inviteCode,
    });
  };

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardHead}>
        <View style={styles.metricBadge}>
          <Ionicons name={iconFor(entry.race.metricKey === "steps" ? "footprints" : entry.race.metricKey)} size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {entry.race.name}
          </Text>
          {/* League is always named with its metric — "Bronze" alone is
              ambiguous now that each metric has its own ladder. Built as one
              string rather than split text nodes: textTransform capitalize
              applies per node, which turned "7 days" into "7 DayS". */}
          <Text style={styles.cardSub}>{subtitleFor(entry)}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: meta.color + "22" }]}>
          <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {finished && (
        <View style={styles.resultRow}>
          <Text style={styles.resultPos}>{ordinal(entry.finishPosition!)}</Text>
          <Text style={styles.resultPoints}>
            {entry.pointsAwarded != null && entry.pointsAwarded >= 0 ? "+" : ""}
            {entry.pointsAwarded ?? 0} pts
          </Text>
          {entry.prizeCents != null && entry.prizeCents > 0 && (
            <Text style={styles.resultPrize}>{formatCents(entry.prizeCents)}</Text>
          )}
        </View>
      )}

      {canShareRace && (
        <Pressable
          style={styles.shareButton}
          onPress={(event) => {
            event.stopPropagation();
            shareRace();
          }}
        >
          <Ionicons name="share-outline" size={16} color={colors.bg} />
          <Text style={styles.shareButtonText}>Share race</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  backRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.sub },
  header: { fontFamily: fonts.display, fontSize: 30, color: colors.text, marginBottom: spacing.lg },
  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.md },

  emptyCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center" },
  emptyTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.text },
  emptyBody: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, textAlign: "center", marginTop: spacing.sm, lineHeight: 19 },
  emptyCta: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  emptyCtaText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.bg },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  metricBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  cardSub: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 1 },
  statusPill: { borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  statusPillText: { fontFamily: fonts.bodyMedium, fontSize: 10 },

  resultRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.md },
  resultPos: { fontFamily: fonts.display, fontSize: 20, color: colors.accent },
  resultPoints: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.sub },
  resultPrize: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.won, marginLeft: "auto" },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  shareButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.bg },
});
