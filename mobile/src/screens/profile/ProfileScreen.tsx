import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, TextInput, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { showAlert } from "../../lib/alert";
import { getProfileStats, getStravaStatus, disconnectStrava, getAppConfig } from "../../api/client";
import { getLeagueStandings, getLeagueHistory, lookUpRaceCode } from "../../api/raceClient";
import { connectStravaAccount } from "../../integrations/strava";
import { useAppState } from "../../state/useAppState";
import { formatMetricValue } from "../../utils/metricValue";
import type { ProfileStats, StravaStatus } from "../../api/types";
import type { LeagueStandings, MetricStanding, RacePointEntry } from "../../api/raceTypes";
import { iconFor } from "../../theme/metricIcons";

/**
 * Profile.
 *
 * Competition profile. The launch product is fixed-prize competitions only:
 * league position, race history and account controls.
 */

function formatCents(cents: number) {
  return `${cents < 0 ? "-" : ""}R${Math.abs(cents / 100).toLocaleString()}`;
}

function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

export function ProfileScreen() {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [standings, setStandings] = useState<LeagueStandings | null>(null);
  const [points, setPoints] = useState<RacePointEntry[]>([]);

  const load = useCallback(() => {
    getProfileStats().then(setStats).catch(() => setStats(null));
    getLeagueStandings().then(setStandings).catch(() => setStandings(null));
    getLeagueHistory().then((r) => setPoints(r.entries)).catch(() => setPoints([]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <IdentityCard />

        {/* ── Race / league ───────────────────────────────────────────── */}
        <ModelHeading title="Competitions" subtitle="Fixed-prize races, ranked into leagues per metric." />
        <LeagueBadges standings={standings} />
        <StatGrid stats={stats} />
        <PointsHistory entries={points} />
        <JoinByCodeSection />

        {/* ── Account ─────────────────────────────────────────────────── */}
        <ModelHeading title="Account" subtitle="" />
        <AdminRow />
        <StravaSection />
        <StatusSection />
        <SupportAndLegalRows />
        <LogoutRow />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Divider between the two models' sections — the separation IS the design here, so it's explicit rather than implied by spacing. */
function ModelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.modelHeading}>
      <Text style={styles.modelHeadingTitle}>{title}</Text>
      {!!subtitle && <Text style={styles.modelHeadingSub}>{subtitle}</Text>}
    </View>
  );
}

function IdentityCard() {
  const app = useAppState();
  return (
    <View style={styles.identityCard}>
      <View style={styles.avatar}>
        <Text style={styles.avatarInitial}>{app.session?.displayName?.[0]?.toUpperCase() ?? "?"}</Text>
      </View>
      <Text style={styles.name}>{app.session?.displayName ?? "Guest"}</Text>
      {!!app.session?.email && <Text style={styles.email}>{app.session.email}</Text>}
    </View>
  );
}

const METRIC_ICON: Record<string, string> = {
  steps: "footprints",
  running: "running",
  cycling: "bike",
  swimming: "waves",
};

/**
 * Four independent league standings, one per metric.
 *
 * All four are always shown, including metrics the user has never raced —
 * "you have a swimming league and it starts at Bronze" is information, and
 * hiding untouched metrics would make the independence invisible until you
 * happened to race one.
 *
 * There is no combined figure. Adding a running league to a swimming league
 * produces a number that describes nothing.
 */
function LeagueBadges({ standings }: { standings: LeagueStandings | null }) {
  if (!standings) return null;
  return (
    <>
      <Text style={styles.sectionTitle}>Leagues</Text>
      <Text style={styles.sectionHint}>
        Each metric has its own league and points. Racing one never moves another.
      </Text>
      <View style={styles.badgeGrid}>
        {standings.standings.map((s) => (
          <LeagueBadge key={s.metricKey} standing={s} />
        ))}
      </View>
    </>
  );
}

function LeagueBadge({ standing }: { standing: MetricStanding }) {
  const progress = standing.bandProgress ?? 0;
  const untouched = standing.racesEntered === 0;

  return (
    <View style={[styles.badge, untouched && styles.badgeMuted]}>
      <View style={styles.badgeHead}>
        <Ionicons name={iconFor(METRIC_ICON[standing.metricKey] ?? "")} size={14} color={colors.accent} />
        <Text style={styles.badgeMetric}>{standing.metricName}</Text>
      </View>
      <Text style={styles.badgeLeague}>{standing.currentLeague?.name ?? "—"}</Text>
      <View style={styles.badgeTrack}>
        <View style={[styles.badgeFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
      <Text style={styles.badgePoints}>
        {standing.totalPoints} pts
        {standing.pointsToNextLeague != null && standing.pointsToNextLeague > 0
          ? ` · ${standing.pointsToNextLeague} to go`
          : ""}
      </Text>
      {untouched && <Text style={styles.badgeUntouched}>Not raced yet</Text>}
      {standing.qualifiedForUnopenedLevel !== null && (
        <Text style={styles.badgePending}>Promotion pending</Text>
      )}
    </View>
  );
}

function StatGrid({ stats }: { stats: ProfileStats | null }) {
  const items: Array<{ label: string; value: string }> = [
    { label: "Races", value: stats ? String(stats.racesEntered) : "—" },
    { label: "Wins", value: stats ? String(stats.wins) : "—" },
    { label: "Top 3", value: stats ? String(stats.podiums) : "—" },
    { label: "Total Won", value: stats ? formatCents(stats.totalWonCents) : "—" },
  ];

  return (
    <>
      <View style={styles.statGrid}>
        {items.map((item) => (
          <View key={item.label} style={styles.statCard}>
            <Text style={styles.statCardValue} numberOfLines={1} adjustsFontSizeToFit>
              {item.value}
            </Text>
            <Text style={styles.statCardLabel}>{item.label}</Text>
          </View>
        ))}
      </View>
      {stats?.primaryMetric && (
        <View style={styles.primaryMetricCard}>
          <Text style={styles.statCardValue}>{formatMetricValue(stats.primaryMetric.total, stats.primaryMetric)}</Text>
          <Text style={styles.statCardLabel}>{stats.primaryMetric.displayName} logged</Text>
        </View>
      )}
    </>
  );
}

/** Enter a private race by its shared code. */
function JoinByCodeSection() {
  const navigation = useNavigation<any>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const { race } = await lookUpRaceCode(code.trim());
      setCode("");
      navigation.navigate("Races", { screen: "RaceDetail", params: { raceId: race.id } });
    } catch (err: any) {
      showAlert("Couldn't find that race", err.message ?? "Check the code and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Have a race code?</Text>
      <Text style={styles.cardBody}>Private races are joined with a code from whoever created them.</Text>
      <View style={styles.codeRow}>
        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={setCode}
          placeholder="e.g. 4f9a2c71"
          placeholderTextColor={colors.sub}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={32}
        />
        <Pressable
          style={[styles.codeGo, (code.trim().length < 4 || busy) && styles.disabled]}
          disabled={code.trim().length < 4 || busy}
          onPress={go}
        >
          {busy ? <ActivityIndicator color={colors.bg} /> : <Ionicons name="arrow-forward" size={18} color={colors.bg} />}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Every point movement, most recent first.
 *
 * Shown because points are permanent and never reset — if a number can only
 * ever be explained by its history, the history should be visible.
 */
function PointsHistory({ entries }: { entries: RacePointEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <>
      <Text style={styles.sectionTitle}>Points</Text>
      <View style={styles.card}>
        {entries.slice(0, 10).map((e) => (
          <View key={e.id} style={styles.pointRow}>
            <Text style={styles.pointMetric} numberOfLines={1}>
              {e.metricKey}
            </Text>
            <Text style={styles.pointPos}>{ordinal(e.position)}</Text>
            <Text style={[styles.pointDelta, { color: e.points >= 0 ? colors.sage : colors.fail }]}>
              {e.points >= 0 ? "+" : ""}
              {e.points}
            </Text>
            <Text style={styles.pointTotal}>{e.pointsAfter} total</Text>
          </View>
        ))}
      </View>
    </>
  );
}

function StravaSection() {
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getStravaStatus().then(setStatus).catch(() => setStatus(null));
    }, [])
  );

  const toggle = async () => {
    setBusy(true);
    try {
      if (status?.connected) {
        await disconnectStrava();
      } else {
        await connectStravaAccount();
      }
      setStatus(await getStravaStatus());
    } catch (err: any) {
      showAlert("Strava", err.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.rowCard}>
      <View style={styles.rowIcon}>
        <Ionicons name="bicycle-outline" size={18} color={colors.sub} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>Strava</Text>
        <Text style={styles.cardBody}>Optional — stronger GPS verification for running and cycling races.</Text>
      </View>
      <Pressable style={[styles.smallCta, busy && styles.disabled]} disabled={busy} onPress={toggle}>
        <Text style={styles.smallCtaText}>{status?.connected ? "Disconnect" : "Connect"}</Text>
      </Pressable>
    </View>
  );
}

/**
 * Way in to the pilot console. Only for an admin — and the route itself is
 * only registered for one (see navigation/RootNavigator.tsx), so this is a
 * signpost rather than the lock.
 */
function AdminRow() {
  const navigation = useNavigation<any>();
  const app = useAppState();
  if (!app.session?.isAdmin) return null;

  return (
    <Pressable style={styles.adminRow} onPress={() => navigation.navigate("Admin")}>
      <Ionicons name="options-outline" size={18} color={colors.accent} />
      <View style={styles.adminRowBody}>
        <Text style={styles.adminRowTitle}>Run the pilot</Text>
        <Text style={styles.cardBody}>Fund accounts, send payouts, mint invite codes.</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.sub} />
    </Pressable>
  );
}

function StatusSection() {
  return (
    <View style={styles.statusRow}>
      <View style={styles.statusDot} />
      <Text style={styles.cardBody}>All systems operational</Text>
    </View>
  );
}

/**
 * Support and legal links, read from the server's /config at runtime rather
 * than hardcoded — see backend/src/server.ts for why.
 *
 * Each row only renders if that value is actually configured. A dead
 * "Terms of Service" link is worse than no link on a product handling real
 * money: it implies terms exist and can be read, when they don't.
 */
function SupportAndLegalRows() {
  const [config, setConfig] = useState<{ supportEmail: string | null; termsUrl: string | null; privacyUrl: string | null } | null>(null);

  useFocusEffect(
    useCallback(() => {
      getAppConfig().then(setConfig).catch(() => setConfig(null));
    }, [])
  );

  const open = (url: string) => Linking.openURL(url).catch(() => showAlert("Couldn't open that link"));

  return (
    <>
      {!!config?.supportEmail && (
        <Pressable style={styles.rowCard} onPress={() => open(`mailto:${config.supportEmail}`)}>
          <View style={styles.rowIcon}>
            <Ionicons name="help-buoy-outline" size={18} color={colors.accent} />
          </View>
          <Text style={[styles.cardTitle, { flex: 1 }]}>Help &amp; Support</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.sub} />
        </Pressable>
      )}
      {!!config?.termsUrl && (
        <Pressable style={styles.rowCard} onPress={() => open(config.termsUrl!)}>
          <View style={styles.rowIcon}>
            <Ionicons name="document-text-outline" size={18} color={colors.sub} />
          </View>
          <Text style={[styles.cardTitle, { flex: 1 }]}>Terms of Service</Text>
          <Ionicons name="open-outline" size={16} color={colors.sub} />
        </Pressable>
      )}
      {!!config?.privacyUrl && (
        <Pressable style={styles.rowCard} onPress={() => open(config.privacyUrl!)}>
          <View style={styles.rowIcon}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.sub} />
          </View>
          <Text style={[styles.cardTitle, { flex: 1 }]}>Privacy Policy</Text>
          <Ionicons name="open-outline" size={16} color={colors.sub} />
        </Pressable>
      )}
    </>
  );
}

function LogoutRow() {
  const app = useAppState();
  return (
    <Pressable
      style={styles.logoutRow}
      onPress={() =>
        showAlert("Log out?", "You'll need to sign in again.", [
          { text: "Cancel", style: "cancel" },
          { text: "Log out", style: "destructive", onPress: () => app.logout() },
        ])
      }
    >
      <Text style={styles.logoutText}>Log out</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  identityCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center", marginBottom: spacing.lg },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { fontFamily: fonts.display, fontSize: 30, color: colors.accent },
  name: { fontFamily: fonts.bodySemiBold, fontSize: 18, color: colors.text, marginTop: spacing.md },
  email: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginTop: 2 },

  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCard: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: "center",
  },
  statCardValue: { fontFamily: fonts.display, fontSize: 20, color: colors.text },
  statCardLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 2 },
  primaryMetricCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: "center",
    marginTop: spacing.sm,
  },

  modelHeading: { marginTop: spacing.xxl, marginBottom: spacing.md, borderTopWidth: 1, borderTopColor: colors.surfaceRaised, paddingTop: spacing.lg },
  modelHeadingTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.text },
  modelHeadingSub: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 2, lineHeight: 17 },

  challengeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  challengeTitle: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.text },
  challengeSub: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 1 },
  challengeStatus: { fontFamily: fonts.bodySemiBold, fontSize: 11 },

  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.xs },
  sectionHint: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginBottom: spacing.md, lineHeight: 17 },

  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  badgeMuted: { opacity: 0.75 },
  badgeHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  badgeMetric: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, textTransform: "uppercase", letterSpacing: 0.5 },
  badgeLeague: { fontFamily: fonts.display, fontSize: 19, color: colors.text, marginTop: 2 },
  badgeTrack: { height: 5, backgroundColor: colors.surfaceRaised, borderRadius: radii.pill, marginTop: spacing.sm, overflow: "hidden" },
  badgeFill: { height: 5, backgroundColor: colors.accent, borderRadius: radii.pill },
  badgePoints: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: spacing.sm },
  badgeUntouched: { fontFamily: fonts.body, fontSize: 10, color: colors.sub, marginTop: 2, fontStyle: "italic" },
  badgePending: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.won, marginTop: 2 },

  pointMetric: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, width: 62, textTransform: "capitalize" },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, marginTop: spacing.lg },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  cardBody: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 2, lineHeight: 17 },

  codeRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  codeInput: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.sm,
    padding: spacing.md,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  codeGo: {
    width: 52,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.45 },

  pointRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingVertical: spacing.sm },
  pointPos: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.sub, width: 40 },
  pointDelta: { fontFamily: fonts.bodySemiBold, fontSize: 14, width: 40 },
  pointTotal: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginLeft: "auto" },

  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  smallCta: { backgroundColor: colors.accent, borderRadius: radii.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  smallCtaText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.bg },

  adminRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  adminRowBody: { flex: 1, gap: 2 },
  adminRowTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg, paddingHorizontal: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sage },

  logoutRow: { alignItems: "center", marginTop: spacing.xxl },
  logoutText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.fail },
});
