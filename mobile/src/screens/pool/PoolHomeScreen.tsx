import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl, ImageBackground } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { LoadError } from "../../components/LoadError";
import { iconFor } from "../../theme/metricIcons";
import { getChallenges } from "../../api/challengeClient";
import type { Challenge } from "../../api/challengeTypes";
import { sportImageFor } from "../../theme/sportImages";

/**
 * Pool — StreakPot's home. The pooled-stakes model, reintroduced as a free,
 * zero-commission engagement layer alongside the race/league model (which
 * lives on the Competitions tab instead). Two things distinguish a
 * challenge card from a race card, both from the model:
 *
 *  1. It shows a STAKE, not an entry fee — the payout depends on who else
 *     stays in, which is exactly the structure races are built to avoid.
 *  2. There's a target per day, not a cumulative ranking — a challenge is
 *     pass/fail against yourself, never a position against a field.
 */

function formatCents(cents: number) {
  return `R${(cents / 100).toLocaleString()}`;
}

function metricIconFor(challenge: Challenge): string {
  const first = challenge.metricRequirements[0]?.metricKey ?? "steps";
  return first === "steps" ? "footprints" : first === "sleep" ? "moon" : first;
}

function summaryFor(challenge: Challenge): string {
  const metrics = challenge.metricRequirements.map((r) => r.displayName).join(" + ");
  const days = `${challenge.durationDays} day${challenge.durationDays === 1 ? "" : "s"}`;
  const mode = challenge.mode === "SQUAD" ? "Squad" : "Solo";
  return `${metrics} · ${days} · ${mode}`;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "In progress", color: colors.sage },
  ELIMINATED: { label: "Eliminated", color: colors.fail },
  FINISHED: { label: "Finished — paid out", color: colors.won },
  WITHDRAWN: { label: "Withdrawn", color: colors.sub },
};

export function PoolHomeScreen() {
  const navigation = useNavigation<any>();
  const [mine, setMine] = useState<Challenge[]>([]);
  const [discover, setDiscover] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mineResult, discoverResult] = await Promise.all([getChallenges({ scope: "mine" }), getChallenges({ scope: "discover" })]);
      setMine(mineResult.challenges);
      // Discover already excludes anything you've joined server-side isn't
      // guaranteed, so filter defensively rather than show a duplicate card.
      setDiscover(discoverResult.challenges.filter((c) => !c.hasJoined));
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openTo = (id: string) => navigation.navigate("ChallengeDetail", { challengeId: id });

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <Text style={styles.header}>Pool</Text>
        <Text style={styles.subheader}>Stake with others, split the pool if you finish — zero platform cut, ever.</Text>

        {loading && mine.length === 0 && discover.length === 0 && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />}

        {mine.length > 0 && <Text style={styles.sectionTitle}>Your challenges</Text>}
        {mine.map((c) => (
          <ChallengeCard key={c.id} challenge={c} onPress={() => openTo(c.id)} />
        ))}

        <Text style={styles.sectionTitle}>Open to join</Text>
        {!loading && loadError && discover.length === 0 && <LoadError error={loadError} onRetry={load} />}

        {!loading && !loadError && discover.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No public challenges right now</Text>
            <Text style={styles.emptyText}>Ask for an invite code to join a private one, or check back soon.</Text>
          </View>
        )}
        {discover.map((c) => (
          <ChallengeCard key={c.id} challenge={c} onPress={() => openTo(c.id)} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function ChallengeCard({ challenge, onPress }: { challenge: Challenge; onPress: () => void }) {
  const statusMeta = challenge.myStatus ? STATUS_META[challenge.myStatus] : null;
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <ImageBackground source={{ uri: sportImageFor(challenge.metricRequirements[0]?.metricKey) }} style={styles.cardImage} imageStyle={styles.cardImageStyle}>
        <View style={styles.cardOverlay} />
        <View style={styles.cardHead}>
          <View style={styles.metricBadge}>
            <Ionicons name={iconFor(metricIconFor(challenge))} size={18} color={colors.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {challenge.title}
            </Text>
            <Text style={styles.cardSub}>{summaryFor(challenge)}</Text>
          </View>
          {statusMeta && (
            <View style={[styles.statusPill, { backgroundColor: statusMeta.color + "22" }]}>
              <Text style={[styles.statusPillText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
            </View>
          )}
        </View>

        <View style={styles.stakeRow}>
          <Text style={styles.stakeLabel}>Stake</Text>
          <Text style={styles.stakeValue}>{formatCents(challenge.stakeCents)}</Text>
          <Text style={styles.participantCount}>
            {challenge.participantCount} {challenge.participantCount === 1 ? "person" : "people"} staking
          </Text>
        </View>

        {challenge.hasJoined && challenge.myStatus === "ACTIVE" && (challenge.myCurrentStreak ?? 0) > 0 && (
          <View style={styles.streakRow}>
            <Ionicons name="flame" size={14} color={colors.accent} />
            <Text style={styles.streakText}>{challenge.myCurrentStreak}-day streak</Text>
          </View>
        )}

        {!challenge.hasJoined && (
          <View style={styles.cta}>
            <Text style={styles.ctaText}>Join · {formatCents(challenge.stakeCents)} stake</Text>
          </View>
        )}
      </ImageBackground>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { fontFamily: fonts.display, fontSize: 30, color: colors.text },
  subheader: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.md },

  emptyCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center" },
  emptyTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  emptyText: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, textAlign: "center", marginTop: spacing.sm, lineHeight: 18 },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, marginBottom: spacing.md, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  cardImage: { padding: spacing.lg, minHeight: 190 },
  cardImageStyle: { opacity: 0.88 },
  cardOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.48)" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  metricBadge: { width: 36, height: 36, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  cardSub: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 1 },
  statusPill: { borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  statusPillText: { fontFamily: fonts.bodyMedium, fontSize: 10 },

  stakeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg },
  stakeLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.sub },
  stakeValue: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  participantCount: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginLeft: "auto" },

  streakRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  streakText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.accent },

  cta: { backgroundColor: colors.accent, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.bg },
});
