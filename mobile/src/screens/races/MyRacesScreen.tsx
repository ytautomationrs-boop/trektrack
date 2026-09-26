import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { LoadError } from "../../components/LoadError";
import { iconFor } from "../../theme/metricIcons";
import { getMyRaces, getLeagueStandings, cancelRaceEntry } from "../../api/raceClient";
import type { LeagueStandings, RaceHistoryEntry } from "../../api/raceTypes";
import { LeagueHeader } from "./LeagueHeader";
import { shareCode } from "../../lib/shareCode";
import { showAlert } from "../../lib/alert";
import { raceUrl } from "../../lib/webLinks";

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

function creatorLabel(entry: RaceHistoryEntry) {
  return entry.race.createdBy?.displayName ?? (entry.race.createdByUserId ? "ASTA racer" : "ASTA");
}

function visibilityLabel(entry: RaceHistoryEntry) {
  return entry.race.visibility === "PUBLIC" ? "Public" : "Invite only";
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
  const [entries, setEntries] = useState<RaceHistoryEntry[]>([]);
  const [standings, setStandings] = useState<LeagueStandings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (entries.length === 0) setLoading(true);
    const standingsPromise = getLeagueStandings()
      .then((value) => {
        setStandings(value);
      })
      .catch(() => {
        setStandings(null);
      });

    try {
      const mine = await getMyRaces();
      setEntries(mine.entries);
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }

    await standingsPromise;
  }, [entries.length]);

  // Refresh on focus: entering a race from the Competitions list should show
  // up here immediately, not after a manual pull.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const uniqueEntries = entries.filter((entry, index, all) => all.findIndex((item) => item.raceId === entry.raceId) === index);
  const isActiveRaceStatus = (status: string) => status === "FILLING" || status === "LOCKED" || status === "RUNNING";
  const active = uniqueEntries.filter((e) => e.status === "ENTERED" && isActiveRaceStatus(e.race.status));
  const past = uniqueEntries.filter((e) => e.status !== "ENTERED" || !isActiveRaceStatus(e.race.status));

  const withdraw = (entry: RaceHistoryEntry) => {
    showAlert("Withdraw from race?", "Your entry fee will be refunded in full while the race is still waiting to fill.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Withdraw",
        style: "destructive",
        onPress: async () => {
          setWithdrawingId(entry.raceId);
          try {
            const result = await cancelRaceEntry(entry.raceId);
            setEntries((items) =>
              items.map((item) =>
                item.raceId === entry.raceId
                  ? {
                      ...item,
                      status: "WITHDRAWN",
                      race: {
                        ...item.race,
                        hasEntered: false,
                        entrantsNow: Math.max(0, item.race.entrantsNow - 1),
                        slotsRemaining: Math.min(item.race.entrantsRequired, item.race.slotsRemaining + 1),
                        participants: item.race.participants.filter((participant) => !participant.isViewer),
                      },
                    }
                  : item
              )
            );
            showAlert("Refunded", `${formatCents(result.refundedCents)} is back in your wallet.`);
            await load();
          } catch (err: any) {
            showAlert("Couldn't withdraw", err.message ?? "Try again.");
          } finally {
            setWithdrawingId(null);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
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
          <RaceRow
            key={e.raceId}
            entry={e}
            busy={withdrawingId === e.raceId}
            onWithdraw={() => withdraw(e)}
            onPress={() => navigation.navigate("RaceDetail", { raceId: e.raceId })}
          />
        ))}

        {past.length > 0 && <Text style={styles.sectionTitle}>Past</Text>}
        {past.map((e) => (
          <RaceRow
            key={e.raceId}
            entry={e}
            busy={false}
            onWithdraw={() => {}}
            onPress={() => navigation.navigate("RaceDetail", { raceId: e.raceId })}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function RaceRow({
  entry,
  busy,
  onWithdraw,
  onPress,
}: {
  entry: RaceHistoryEntry;
  busy: boolean;
  onWithdraw: () => void;
  onPress: () => void;
}) {
  const meta = STATUS_META[entry.race.status] ?? { label: entry.race.status, color: colors.sub };
  const finished = entry.finishPosition != null;
  const canWithdraw = entry.race.status === "FILLING" && entry.status === "ENTERED";
  const participants = entry.race.participants ?? [];
  const participantPreview = participants.slice(0, 3);

  const shareRace = () => {
    const link = raceUrl(entry.race.id, entry.race.inviteCode);
    void shareCode({
      message: `Join my ASTA competition "${entry.race.name}".\n${link}`,
      title: "Race link",
      code: link,
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
          <View style={styles.metaRow}>
            <View style={styles.visibilityPill}>
              <Ionicons name={entry.race.visibility === "PUBLIC" ? "earth" : "lock-closed"} size={10} color={colors.text} />
              <Text style={styles.visibilityPillText}>{visibilityLabel(entry)}</Text>
            </View>
            <Text style={styles.creatorText} numberOfLines={1}>
              Created by {creatorLabel(entry)}
            </Text>
          </View>
        </View>
        <View style={[styles.statusPill, { backgroundColor: meta.color + "22" }]}>
          <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      <View style={styles.registerPreview}>
        <View style={styles.registerTop}>
          <Text style={styles.registerTitle}>Competitors</Text>
          <Text style={styles.registerCount}>
            {entry.race.entrantsNow}/{entry.race.entrantsRequired} · {entry.race.slotsRemaining} open
          </Text>
        </View>
        {participantPreview.length > 0 ? (
          <View style={styles.participantChips}>
            {participantPreview.map((participant) => (
              <View key={participant.entryId} style={[styles.participantChip, participant.isViewer && styles.participantChipMine]}>
                <Text style={styles.participantChipText} numberOfLines={1}>
                  {participant.displayName}
                </Text>
              </View>
            ))}
            {participants.length > participantPreview.length && (
              <Text style={styles.moreParticipants}>+{participants.length - participantPreview.length}</Text>
            )}
          </View>
        ) : (
          <Text style={styles.noParticipants}>No active entrants.</Text>
        )}
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

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.actionButton, styles.shareButton]}
          onPress={(event) => {
            event.stopPropagation();
            shareRace();
          }}
        >
          <Ionicons name="share-outline" size={16} color={colors.onAccent} />
          <Text style={styles.shareButtonText}>Share race</Text>
        </Pressable>
        {canWithdraw && (
          <Pressable
            style={[styles.actionButton, styles.withdrawButton, busy && styles.disabled]}
            disabled={busy}
            onPress={(event) => {
              event.stopPropagation();
              onWithdraw();
            }}
          >
            {busy ? <ActivityIndicator color={colors.sub} /> : <Text style={styles.withdrawButtonText}>Withdraw · refund</Text>}
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { fontFamily: fonts.display, fontSize: 24, color: colors.text, marginBottom: spacing.lg },
  sectionTitle: { fontFamily: fonts.display, fontSize: 15, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.md },

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
  emptyCtaText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onAccent },

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
  cardTitle: { fontFamily: fonts.display, fontSize: 15, color: colors.text },
  cardSub: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.sm },
  visibilityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  visibilityPillText: { fontFamily: fonts.bodySemiBold, fontSize: 10, color: colors.text },
  creatorText: { flexShrink: 1, fontFamily: fonts.body, fontSize: 11, color: colors.sub },
  statusPill: { borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  statusPillText: { fontFamily: fonts.bodyMedium, fontSize: 10 },

  registerPreview: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.md },
  registerTop: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  registerTitle: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.text },
  registerCount: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.sub },
  participantChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  participantChip: {
    maxWidth: 110,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  participantChipMine: { backgroundColor: colors.accent },
  participantChipText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.text },
  moreParticipants: { alignSelf: "center", fontFamily: fonts.body, fontSize: 11, color: colors.sub },
  noParticipants: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: spacing.sm },

  resultRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.md },
  resultPos: { fontFamily: fonts.display, fontSize: 20, color: colors.accent },
  resultPoints: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.sub },
  resultPrize: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.won, marginLeft: "auto" },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
  },
  shareButton: { backgroundColor: colors.accent },
  shareButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onAccent },
  withdrawButton: { borderWidth: 1, borderColor: colors.sub },
  withdrawButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.sub },
  disabled: { opacity: 0.5 },
});
