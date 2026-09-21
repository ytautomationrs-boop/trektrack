import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl, ImageBackground } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { showAlert } from "../../lib/alert";
import { confirmVerifiable } from "../../lib/verifiability";
import { LoadError } from "../../components/LoadError";
import { iconFor } from "../../theme/metricIcons";
import { getLeagueStandings, getRaces, enterRace } from "../../api/raceClient";
import type { LeagueStandings, Race } from "../../api/raceTypes";
import { LeagueHeader } from "./LeagueHeader";
import { sportImageFor } from "../../theme/sportImages";

// No websocket infra exists yet — this is how fill counts and lock states
// stay close to live on a screen with no deadline to countdown against.
const POLL_INTERVAL_MS = 15_000;
const DEFAULT_METRIC_FILTERS = [
  { metricKey: "steps", metricName: "Walking" },
  { metricKey: "running", metricName: "Running" },
  { metricKey: "swimming", metricName: "Swimming" },
  { metricKey: "cycling", metricName: "Cycling" },
];

function formatCents(cents: number) {
  return `R${(cents / 100).toLocaleString()}`;
}

function formatScheduledStart(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function creatorLabel(race: Race) {
  return race.createdBy?.displayName ?? (race.createdByUserId ? "TrackTrek racer" : "TrackTrek");
}

function visibilityLabel(race: Race) {
  return race.visibility === "PUBLIC" ? "Public" : "Invite only";
}

/**
 * The races tab.
 *
 * Three things this screen is careful about, all from the model rather than
 * from taste:
 *
 *  1. It leads with how many slots are left, not with a prize total. A race
 *     does not exist until its exact headcount is reached, so "3 of 10
 *     entered" is the single most decision-relevant fact on the card. There
 *     is no deadline to show alongside it — fill is indefinite, so the only
 *     honest copy is "waiting to fill", not a countdown.
 *  2. It shows the full prize schedule up front. The prizes are fixed and
 *     pre-announced and do not move with turnout, so there is no reason to
 *     hide them behind a tap, and showing them is what makes the model
 *     legible as a race rather than a pot.
 *  3. A race flagged `isLowerLeagueOption` is a fallback the backend only
 *     ever offers when the user's own league has nobody left to fill a race
 *     with — never the default listing. Entering it is opt-in and costs
 *     nothing extra to decline, so it gets its own badge and its own
 *     confirmation step rather than blending into the normal Enter flow.
 */
export function RacesScreen() {
  const navigation = useNavigation<any>();
  const [standings, setStandings] = useState<LeagueStandings | null>(null);
  // Which metric's races to show. null = all four.
  const [metricFilter, setMetricFilter] = useState<string | null>(null);
  const [races, setRaces] = useState<Race[]>([]);
  const [scope, setScope] = useState<"my_league" | "all">("my_league");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true);
      try {
        const [leagueResult, raceResult] = await Promise.all([getLeagueStandings(), getRaces({ scope })]);
        setStandings(leagueResult);
        setRaces(raceResult.races);
        setLoadError(null);
      } catch (err) {
        // Failed background refreshes are swallowed — see LoadError's header.
        if (!opts.silent) setLoadError(err as Error);
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [scope]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => load({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  const visibleRaces = metricFilter ? races.filter((r) => r.metricKey === metricFilter) : races;
  const metricFilters = standings?.standings.length ? standings.standings : DEFAULT_METRIC_FILTERS;
  const metricFilterName =
    metricFilters.find((s) => s.metricKey === metricFilter)?.metricName.toLowerCase() ?? metricFilter ?? "";

  const selectMetric = (metricKey: string) => {
    setMetricFilter(metricKey);
    setStandings((current) => (current ? { ...current, primaryMetricKey: metricKey } : current));
  };

  const doEnter = async (race: Race, acceptLowerLeague: boolean) => {
    setEntering(race.id);
    try {
      const result = await enterRace(race.id, { acceptLowerLeague });
      // Worth calling out explicitly: this is the moment the entry stops
      // being withdrawable, because the race just locked.
      showAlert(
        result.lockedRace ? "You're in — race locked" : "You're in",
        result.lockedRace
          ? "That filled the race. It's locked now and starts at midnight — entries are final from here."
          : `${result.entrantsNow} of ${result.entrantsRequired} entered. There's no deadline — you can withdraw for a full refund any time before it fills.`
      );
      await load();
    } catch (err: any) {
      if (err.code === "lower_league_available" && !acceptLowerLeague) {
        showAlert("Lower league available", err.message, [
          { text: "Not now", style: "cancel" },
          { text: "Enter anyway", onPress: () => doEnter(race, true) },
        ]);
        return;
      }
      showAlert(
        err.code === "insufficient_balance" ? "Top up first" : "Couldn't enter",
        err.message ?? "Something went wrong."
      );
    } finally {
      setEntering(null);
    }
  };

  const onEnter = (race: Race) => {
    if (race.format === "SQUAD") {
      navigation.navigate("RaceDetail", { raceId: race.id });
      return;
    }
    // Outermost gate on web: entering from this list used to charge the fee
    // on one tap, with no mention that a browser can't score steps or
    // swimming at all. The detail screen's warning card was never seen.
    confirmVerifiable([race.metricKey], formatCents(race.entryFeeCents), () => enterAfterLeagueCheck(race));
  };

  const enterAfterLeagueCheck = (race: Race) => {
    if (race.isLowerLeagueOption) {
      showAlert(
        `Enter a lower ${race.raceType?.metricType.displayName.toLowerCase() ?? race.metricKey} league?`,
        `${race.league?.name ?? `League ${race.leagueLevel}`} is below your own. You can still enter for ${formatCents(
          race.entryFeeCents
        )} — it pays and can win that league's fixed prize, but it won't earn or cost you any ${race.metricKey} league points.`,
        [
          { text: "Not now", style: "cancel" },
          { text: "Enter anyway", onPress: () => doEnter(race, true) },
        ]
      );
      return;
    }
    doEnter(race, false);
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} tintColor={colors.accent} />}
      >
        <View style={styles.headerRow}>
          <Text style={styles.header}>Competitions</Text>
          {/* Also a bottom tab, but kept here as a shortcut for people who
              enter from the competitions list and want their active races. */}
          <Pressable style={styles.myRacesLink} onPress={() => navigation.navigate("Your Races")}>
            <Text style={styles.myRacesLinkText}>Your races</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.accent} />
          </Pressable>
        </View>

        <Pressable style={styles.howToggle} onPress={() => setShowHowItWorks((value) => !value)}>
          <View style={styles.howIcon}>
            <Ionicons name="help" size={15} color={colors.bg} />
          </View>
          <Text style={styles.howToggleText}>How competitions work</Text>
          <Ionicons name={showHowItWorks ? "chevron-up" : "chevron-down"} size={16} color={colors.sub} />
        </Pressable>

        {showHowItWorks && <HowItWorksCard />}

        {/* Hidden once the load has failed — its own null state says "Loading
            your leagues…" forever, which contradicts the retry state below. */}
        {!(loadError && !standings) && <LeagueHeader standings={standings} onSelectMetric={selectMetric} />}

        {/* Metric filter. Selecting one narrows to that metric's races at
            THAT metric's league level — never a combined or unrelated one. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.metricRow}>
          <ScopeChip label="All" active={metricFilter === null} onPress={() => setMetricFilter(null)} />
          {metricFilters.map((s) => (
            <ScopeChip
              key={s.metricKey}
              label={s.metricName}
              active={metricFilter === s.metricKey}
              onPress={() => setMetricFilter(s.metricKey)}
            />
          ))}
        </ScrollView>

        <View style={styles.scopeRow}>
          <ScopeChip label="My league" active={scope === "my_league"} onPress={() => setScope("my_league")} />
          <ScopeChip label="All leagues" active={scope === "all"} onPress={() => setScope("all")} />
        </View>

        {loading && races.length === 0 && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />}

        {/* Before this branch existed, a failed load fell through to the
            empty state below and told the user "No races open right now" —
            stating as fact something we hadn't managed to find out. */}
        {!loading && loadError && races.length === 0 && <LoadError error={loadError} onRetry={() => load()} />}

        {!loading && !loadError && visibleRaces.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {metricFilter ? `No public ${metricFilterName} races yet` : "No races open right now"}
            </Text>
            <Text style={styles.emptyText}>
              {metricFilter
                ? `TrackTrek isn't running public ${metricFilterName} races at this level yet — there need to be enough racers to fill one. You can start a ${metricFilterName} race and choose public or invite-only.`
                : "A new one opens as soon as the current one fills."}
            </Text>
            {metricFilter && (
              <Pressable style={styles.emptyCta} onPress={() => navigation.navigate("Create")}>
                <Text style={styles.emptyCtaText}>Create a {metricFilterName} race</Text>
              </Pressable>
            )}
          </View>
        )}

        {visibleRaces.map((race) => (
          <RaceCard
            key={race.id}
            race={race}
            busy={entering === race.id}
            onEnter={() => onEnter(race)}
            onOpen={() => navigation.navigate("RaceDetail", { raceId: race.id })}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function HowItWorksCard() {
  const steps = [
    "Pick one sport metric and enter or create a 10-person solo race. Squad races are two squads of four.",
    "Your entry fee is held from your wallet while the race is filling. You can pull out for a full refund before it fills.",
    "When the exact headcount is reached, the race locks and starts at the next local midnight. After that, entries are final.",
    "Sync your activity data during the race. Final positions decide fixed prizes and sport-specific trophies.",
  ];

  return (
    <View style={styles.howCard}>
      {steps.map((step, index) => (
        <View key={step} style={styles.howStep}>
          <View style={styles.howNumber}>
            <Text style={styles.howNumberText}>{index + 1}</Text>
          </View>
          <Text style={styles.howStepText}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

function ScopeChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function RaceCard({
  race,
  busy,
  onEnter,
  onOpen,
}: {
  race: Race;
  busy: boolean;
  onEnter: () => void;
  onOpen: () => void;
}) {
  // A wrong-league gate (too high) — distinct from race.status === "LOCKED",
  // which means full and waiting on the clock, not out of reach.
  const leagueGated = race.enterable === false;
  const isLocked = race.status === "LOCKED";
  const fillPct = Math.round((race.entrantsNow / race.entrantsRequired) * 100);
  const participants = race.participants ?? [];
  const participantPreview = participants.slice(0, 4);

  return (
    <Pressable style={styles.card} onPress={onOpen}>
      <ImageBackground source={{ uri: sportImageFor(race.metricKey) }} style={styles.cardImage} imageStyle={styles.cardImageStyle}>
        <View style={styles.cardOverlay} />
        <View style={styles.cardHead}>
          <View style={styles.metricBadge}>
          {/* iconFor is keyed by the backend's icon TOKEN ("footprints"), not
              the metric key ("steps") — passing the key silently falls back to
              a generic chart glyph. */}
            <Ionicons name={iconFor(race.raceType?.metricType.icon ?? "")} size={18} color={colors.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>
              {race.raceType?.metricType.displayName ?? race.metricKey} ·{" "}
              {race.format === "SQUAD" ? "Squad" : "Solo"} · {race.durationDays}
              {race.durationDays === 1 ? " day" : " days"}
            </Text>
            <Text style={styles.cardSub}>
              {race.league?.name ? `${race.league.name} · ` : ""}
              {formatCents(race.entryFeeCents)} to enter
            </Text>
            <View style={styles.cardMetaRow}>
              <View style={styles.visibilityPill}>
                <Ionicons name={race.visibility === "PUBLIC" ? "earth" : "lock-closed"} size={10} color={colors.text} />
                <Text style={styles.visibilityPillText}>{visibilityLabel(race)}</Text>
              </View>
              <Text style={styles.creatorText} numberOfLines={1}>
                Created by {creatorLabel(race)}
              </Text>
            </View>
          </View>
          {race.hasEntered ? (
            <View style={styles.enteredPill}>
              <Text style={styles.enteredPillText}>Entered</Text>
            </View>
          ) : race.isLowerLeagueOption ? (
            <View style={styles.lowerLeaguePill}>
              <Text style={styles.lowerLeaguePillText}>Lower league</Text>
            </View>
          ) : null}
        </View>

      {/* Fill status — the race's existence condition, front and centre. No
          deadline anywhere here: fill is indefinite, and once it locks the
          only remaining question is when the clock starts, not whether. */}
      {isLocked ? (
        <View style={styles.lockedBanner}>
          <Ionicons name="lock-closed" size={13} color={colors.sage} />
          <Text style={styles.lockedBannerText}>
            Locked — full. Starts {race.scheduledStartAt ? formatScheduledStart(race.scheduledStartAt) : "soon"}.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${fillPct}%` }]} />
          </View>
          <View style={styles.fillRow}>
            <Text style={styles.fillText}>
              {race.entrantsNow} of {race.entrantsRequired} {race.format === "SQUAD" ? "racers" : "entered"}
            </Text>
            <Text style={styles.deadline}>
              {race.slotsRemaining} {race.slotsRemaining === 1 ? "place" : "places"} open
            </Text>
          </View>
        </>
      )}

      <View style={styles.registerPreview}>
        <View style={styles.registerHead}>
          <Text style={styles.registerTitle}>Participants</Text>
          <Text style={styles.registerCount}>
            {race.entrantsNow}/{race.entrantsRequired}
          </Text>
        </View>
        {participantPreview.length > 0 ? (
          <View style={styles.participantChips}>
            {participantPreview.map((participant) => (
              <View key={participant.entryId} style={[styles.participantChip, participant.isViewer && styles.participantChipMine]}>
                <Text style={styles.participantChipText} numberOfLines={1}>
                  {participant.isViewer ? "You" : participant.displayName}
                </Text>
              </View>
            ))}
            {participants.length > participantPreview.length && (
              <Text style={styles.moreParticipants}>+{participants.length - participantPreview.length} more</Text>
            )}
          </View>
        ) : (
          <Text style={styles.noParticipants}>No entrants yet.</Text>
        )}
      </View>

      {/* The fixed schedule. Same numbers for every race of this type in this
          league, whoever enters. */}
      <View style={styles.prizeRow}>
        {race.prizes.slice(0, 5).map((p) => (
          <View key={p.position} style={styles.prizeChip}>
            <Text style={styles.prizePos}>{p.position === 1 ? "1st" : p.position === 2 ? "2nd" : p.position === 3 ? "3rd" : `${p.position}th`}</Text>
            <Text style={styles.prizeAmount}>{formatCents(p.amountCents)}</Text>
          </View>
        ))}
      </View>
      {race.format === "SQUAD" && (
        <Text style={styles.prizeNote}>Winning squad splits {formatCents(race.totalPrizeCents)}</Text>
      )}

      {leagueGated ? (
        <View style={styles.lockedNote}>
          <Ionicons name="lock-closed-outline" size={13} color={colors.sub} />
          <Text style={styles.lockedText}>Opens when you reach {race.league?.name ?? `league ${race.leagueLevel}`}</Text>
        </View>
      ) : race.hasEntered ? (
        <Pressable style={[styles.cta, styles.ctaGhost]} onPress={onOpen}>
          <Text style={styles.ctaGhostText}>View race</Text>
        </Pressable>
      ) : isLocked ? (
        <View style={styles.lockedNote}>
          <Ionicons name="lock-closed-outline" size={13} color={colors.sub} />
          <Text style={styles.lockedText}>Full — locked for the next race</Text>
        </View>
      ) : (
        <Pressable style={[styles.cta, race.isLowerLeagueOption && styles.ctaLowerLeague]} onPress={onEnter} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.ctaText}>
              {race.format === "SQUAD"
                ? "Pick a squad"
                : race.isLowerLeagueOption
                ? `Enter anyway · ${formatCents(race.entryFeeCents)}`
                : `Enter · ${formatCents(race.entryFeeCents)}`}
            </Text>
          )}
        </Pressable>
      )}
      </ImageBackground>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  header: { fontFamily: fonts.display, fontSize: 30, color: colors.text },
  myRacesLink: { flexDirection: "row", alignItems: "center", gap: 2 },
  myRacesLinkText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.accent },
  howToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  howIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  howToggleText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  howCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, gap: spacing.md, marginBottom: spacing.lg },
  howStep: { flexDirection: "row", gap: spacing.md },
  howNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  howNumberText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.accent },
  howStepText: { flex: 1, fontFamily: fonts.body, fontSize: 12, color: colors.sub, lineHeight: 17 },
  scopeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  metricRow: { flexDirection: "row", gap: spacing.sm, paddingBottom: spacing.lg },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.sub },
  chipTextActive: { color: colors.bg },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center", marginTop: spacing.md },
  emptyTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginBottom: spacing.sm },
  emptyText: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, textAlign: "center", lineHeight: 19 },
  emptyCta: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  emptyCtaText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.bg },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, marginBottom: spacing.md, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  cardImage: { padding: spacing.lg, minHeight: 230 },
  cardImageStyle: { opacity: 0.88 },
  cardOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.50)" },
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
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
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
  enteredPill: { backgroundColor: colors.surfaceRaised, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  enteredPillText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.sage },
  lowerLeaguePill: { backgroundColor: colors.surfaceRaised, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  lowerLeaguePillText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.sub },

  track: { height: 6, backgroundColor: colors.surfaceRaised, borderRadius: radii.pill, marginTop: spacing.lg, overflow: "hidden" },
  fill: { height: 6, backgroundColor: colors.sage, borderRadius: radii.pill },
  fillRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  fillText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.text },
  deadline: { fontFamily: fonts.body, fontSize: 12, color: colors.sub },

  registerPreview: { backgroundColor: "rgba(7,26,39,0.78)", borderRadius: radii.md, padding: spacing.md, marginTop: spacing.lg },
  registerHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  registerTitle: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.text },
  registerCount: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.accent },
  participantChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  participantChip: {
    maxWidth: 120,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  participantChipMine: { backgroundColor: colors.accent },
  participantChipText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.text },
  moreParticipants: { alignSelf: "center", fontFamily: fonts.body, fontSize: 11, color: colors.sub },
  noParticipants: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: spacing.sm },

  lockedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  lockedBannerText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.sage, flexShrink: 1 },

  prizeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  prizeChip: { backgroundColor: colors.surfaceRaised, borderRadius: radii.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  prizePos: { fontFamily: fonts.body, fontSize: 10, color: colors.sub, textTransform: "uppercase" },
  prizeAmount: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.won },
  prizeNote: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: spacing.sm },

  cta: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  ctaLowerLeague: { backgroundColor: colors.sub },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.bg },
  ctaGhost: { backgroundColor: colors.surfaceRaised },
  ctaGhostText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  lockedNote: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg },
  lockedText: { fontFamily: fonts.body, fontSize: 12, color: colors.sub },
});
