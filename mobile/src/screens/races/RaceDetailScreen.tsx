import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, TextInput, RefreshControl, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { showAlert } from "../../lib/alert";
import { shareCode } from "../../lib/shareCode";
import { confirmVerifiable, isUnverifiable } from "../../lib/verifiability";
import { pickWorkoutFile, importWorkoutFile, ACCEPTED_EXTENSIONS } from "../../lib/workoutImport";
import { LoadError } from "../../components/LoadError";
import { getRace, enterRace, cancelRaceEntry } from "../../api/raceClient";
import type { RaceDetail, RaceStandings } from "../../api/raceTypes";
import { formatMetricValue } from "../../utils/metricValue";
import { raceUrl } from "../../lib/webLinks";

// No websocket infra exists yet — this is how fill counts and live
// standings stay close to live while a race is still changeable.
const POLL_INTERVAL_MS = 60_000;

function formatCents(cents: number) {
  return `R${(cents / 100).toLocaleString()}`;
}

function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

function formatScheduledStart(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" });
}

function creatorLabel(race: RaceDetail["race"]) {
  return race.createdBy?.displayName ?? (race.createdByUserId ? "ASTA racer" : "ASTA");
}

function visibilityLabel(race: RaceDetail["race"]) {
  return race.visibility === "PUBLIC" ? "Public competition" : "Invite-only competition";
}

function initialFor(name: string) {
  return name.trim().charAt(0).toUpperCase() || "T";
}

/** Finds the viewer's own row (or squad) in the standings, if they're in this race. */
function findMyStanding(standings: RaceStandings, myEntryId: string) {
  if (standings.format === "INDIVIDUAL") {
    const row = standings.individuals.find((r) => r.entryId === myEntryId);
    if (!row) return null;
    return { position: row.position, of: standings.individuals.length, gapFromLeader: row.gapFromLeader, isSquad: false };
  }
  const squad = standings.squads.find((s) => s.members.some((m) => m.entryId === myEntryId));
  if (!squad) return null;
  return { position: squad.position, of: standings.squads.length, gapFromLeader: squad.gapFromLeader, isSquad: true };
}

/**
 * One race: its fixed prize schedule, its fill state or live standings, and
 * squad selection for squad races.
 *
 * Standings shown while a race is running are labelled provisional
 * everywhere they appear. Positions carry both money and league points and
 * are only written at resolution, after anti-fraud review has had its say —
 * showing a mid-race order as if it were final would be a promise the model
 * does not make.
 */
export function RaceDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const raceId: string = route.params?.raceId;

  const [data, setData] = useState<RaceDetail | null>(null);
  const hasDataRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [squadName, setSquadName] = useState("");
  // Founding defaults to invite-only. The captain opts in to letting anyone
  // in the race take a seat — see backend RaceSquad.joinPolicy.
  const [openToAnyone, setOpenToAnyone] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent && !hasDataRef.current) setLoading(true);
      try {
        const next = await getRace(raceId);
        hasDataRef.current = true;
        setData(next);
        setLoadError(null);
      } catch (err) {
        // A silent poll that fails leaves what's on screen alone — the
        // standings are stale, not gone, and blanking a live race because
        // one 15s refresh missed is worse than showing slightly old numbers.
        if (!opts.silent) setLoadError(err as Error);
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [raceId]
  );

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Poll while there's still something live to watch: fill count while
  // waiting to lock, scores while the clock is running. LOCKED and the
  // terminal statuses don't change on their own between refreshes.
  const pollableStatus = data?.race.status === "FILLING" || data?.race.status === "RUNNING";
  useFocusEffect(useCallback(() => {
    if (!pollableStatus) return;
    const id = setInterval(() => { void load({ silent: true }); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollableStatus, load]));

  const doEnter = async (
    opts: {
      squadId?: string;
      squadName?: string;
      squadInviteCode?: string;
      squadJoinPolicy?: "INVITE_ONLY" | "OPEN";
      acceptLowerLeague?: boolean;
    } = {}
  ) => {
    setBusy(true);
    try {
      const result = await enterRace(raceId, opts);
      showAlert(
        result.lockedRace ? "You're in — race locked" : "You're in",
        result.lockedRace
          ? "That filled the race. It's locked now and starts at midnight — entries are final from here."
          : `${result.entrantsNow} of ${result.entrantsRequired} in. There's no deadline — you can withdraw for a full refund any time before it fills.`
      );
      setSquadName("");
      setJoinCode("");
      await load();
    } catch (err: any) {
      if (err.code === "lower_league_available" && !opts.acceptLowerLeague) {
        showAlert("Lower league available", err.message, [
          { text: "Not now", style: "cancel" },
          { text: "Enter anyway", onPress: () => doEnter({ ...opts, acceptLowerLeague: true }) },
        ]);
        return;
      }
      showAlert(err.code === "insufficient_balance" ? "Top up first" : "Couldn't enter", err.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  // Every path into doEnter goes through here — solo, squad-join,
  // squad-create, squad-code — so both pre-entry confirmations live in one
  // place rather than being repeated at four call sites and drifting.
  //
  // Verifiability first: whether a browser can score this metric at all is a
  // more fundamental objection than which league the race is in, and asking
  // about the league first would be asking about the wrong thing.
  const confirmThenEnter = (race: RaceDetail["race"], action: (acceptLowerLeague?: boolean) => void) => {
    confirmVerifiable([race.metricKey], formatCents(race.entryFeeCents), () => confirmLowerLeague(race, action));
  };

  // isLowerLeagueOption means entering costs nothing extra to back out of —
  // but it's still a deliberate choice (zero league points either way), so
  // every path into doEnter for such a race gets its own confirmation first
  // rather than silently folding the flag in.
  const confirmLowerLeague = (race: RaceDetail["race"], action: (acceptLowerLeague?: boolean) => void) => {
    if (!race.isLowerLeagueOption) {
      action(false);
      return;
    }
    showAlert(
      `Enter a lower ${race.raceType?.metricType.displayName.toLowerCase() ?? race.metricKey} league?`,
      `${race.league?.name ?? `League ${race.leagueLevel}`} is below your own. You can still enter for ${formatCents(
        race.entryFeeCents
      )} — it pays and can win that league's fixed prize, but it won't earn or cost you any ${race.metricKey} league points.`,
      [
        { text: "Not now", style: "cancel" },
        { text: "Enter anyway", onPress: () => action(true) },
      ]
    );
  };

  /**
   * Uploads a workout file against this entry.
   *
   * A cancelled picker is silent — backing out of a file dialog is an
   * ordinary thing to do and reporting it as a failure would be noise.
   */
  const doImport = async (raceEntryId: string) => {
    setImporting(true);
    try {
      const file = await pickWorkoutFile();
      if (!file) return;
      const result = await importWorkoutFile(raceEntryId, file);
      const km = (result.imported.distanceMeters / 1000).toFixed(2);
      showAlert(
        "Activity added",
        `${km} km of ${result.imported.metricKey} from ${result.imported.source}. Your race total has been updated.`
      );
      await load();
    } catch (err: any) {
      showAlert("Couldn't add that file", err.message ?? "Something went wrong.");
    } finally {
      setImporting(false);
    }
  };

  const doWithdraw = () => {
    showAlert(
      "Withdraw from this race?",
      "You'll get your entry fee back in full. Once the race locks — reaches its exact headcount — this won't be possible any more.",
      [
        { text: "Stay in", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              const result = await cancelRaceEntry(raceId);
              showAlert("Withdrawn", `${formatCents(result.refundedCents)} refunded to your wallet.`);
              await load();
            } catch (err: any) {
              showAlert("Couldn't withdraw", err.message ?? "Something went wrong.");
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  if (!data) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        {loadError ? (
          <LoadError error={loadError} onRetry={() => load()} />
        ) : (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
        )}
      </SafeAreaView>
    );
  }

  const { race, standings, standingsAreProvisional, viewerUserId } = data;
  // Real metric definition so distances format as km/m and counts render raw
  // (see utils/metricValue.ts) — falls back to a bare count if an older
  // payload lacks it.
  const metricDisplay = race.raceType?.metricType ?? { unit: "", valueType: "COUNT" as const };

  const myEntryId = race.entries.find((e) => e.userId === viewerUserId)?.id ?? null;
  const myStanding =
    standings && myEntryId && (race.status === "RUNNING" || race.status === "RESOLVING" || race.status === "COMPLETED")
      ? findMyStanding(standings, myEntryId)
      : null;
  const shareRace = () => {
    const link = raceUrl(race.id, race.inviteCode);
    void shareCode({
      title: "Race link",
      code: link,
      message: `Join my ASTA competition "${race.name}".\n${link}`,
    });
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} tintColor={colors.accent} />}
      >
        <Text style={styles.title}>
          {race.raceType?.metricType.displayName ?? race.metricKey} ·{" "}
          {race.format === "SQUAD" ? "Squad race" : "Solo race"}
        </Text>
        <Text style={styles.subtitle}>
          {race.durationDays} {race.durationDays === 1 ? "day" : "days"} · {formatCents(race.entryFeeCents)} entry
        </Text>
        <View style={styles.raceMetaRow}>
          <View style={styles.metaPill}>
            <Ionicons name={race.visibility === "PUBLIC" ? "earth" : "lock-closed"} size={12} color={colors.text} />
            <Text style={styles.metaPillText}>{visibilityLabel(race)}</Text>
          </View>
          <Text style={styles.creatorLine} numberOfLines={1}>
            Created by {creatorLabel(race)}
          </Text>
        </View>
        <Pressable style={styles.shareRaceButton} onPress={shareRace}>
          <Ionicons name="share-outline" size={15} color={colors.bg} />
          <Text style={styles.shareRaceText}>Share race</Text>
        </Pressable>

        {/* The existence condition, stated plainly. This is the single most
            important thing to communicate honestly: entering does not mean
            the race is happening. */}
        <View style={styles.statusCard}>
          {race.status === "FILLING" ? (
            <>
              <Text style={styles.statusHeadline}>
                {race.entrantsNow} of {race.entrantsRequired} in
              </Text>
              <Text style={styles.statusBody}>
                This race starts once it reaches exactly {race.entrantsRequired}
                {race.format === "SQUAD" ? " racers" : " entrants"} — there's no deadline, it just waits until it's
                full. You can withdraw for a full refund any time before then.
              </Text>
            </>
          ) : race.status === "LOCKED" ? (
            <>
              <Text style={styles.statusHeadline}>Locked — full</Text>
              <Text style={styles.statusBody}>
                All {race.entrantsRequired}
                {race.format === "SQUAD" ? " racers are" : " entrants are"} in. Starts{" "}
                {race.scheduledStartAt ? formatScheduledStart(race.scheduledStartAt) : "soon"} — entries are final
                from here, no withdrawals.
              </Text>
            </>
          ) : race.status === "RUNNING" ? (
            <>
              <Text style={styles.statusHeadline}>Under way</Text>
              <Text style={styles.statusBody}>
                Full field of {race.entrantsRequired}. Ends {race.endsAt ? new Date(race.endsAt).toLocaleDateString() : "soon"}.
              </Text>
            </>
          ) : race.status === "CANCELLED_UNFILLED" ? (
            <>
              <Text style={styles.statusHeadline}>Cancelled</Text>
              <Text style={styles.statusBody}>This race was cancelled before it filled. Entry fees were refunded in full.</Text>
            </>
          ) : (
            <>
              <Text style={styles.statusHeadline}>Finished</Text>
              <Text style={styles.statusBody}>Final positions below.</Text>
            </>
          )}
        </View>

        <RegisterCard race={race} onOpenProfile={() => navigation.navigate("Profile")} />

        {/* Your own live standing — the same data as the leaderboard below,
            just surfaced without scrolling to find your row. */}
        {myStanding && (
          <View style={styles.myStandingCard}>
            <Text style={styles.myStandingHeadline}>
              You're {ordinal(myStanding.position)} of {myStanding.of}
            </Text>
            <Text style={styles.myStandingBody}>
              {myStanding.position === 1
                ? "You're in the lead."
                : `${formatMetricValue(myStanding.gapFromLeader, metricDisplay)} behind ${
                    myStanding.isSquad ? "the leading squad" : "1st place"
                  }.`}
            </Text>
          </View>
        )}

        {race.status === "FILLING" && race.hasEntered && (
          <Pressable style={[styles.withdrawBtn, busy && styles.ctaDisabled]} disabled={busy} onPress={doWithdraw}>
            <Text style={styles.withdrawBtnText}>Withdraw · full refund</Text>
          </Pressable>
        )}

        {/* Fixed schedule. Identical for every race of this type in this
            league, whatever the entry fees add up to. */}
        {/* Steps and sleep have no workout file to export — they are daily
            totals rather than recorded activities. See lib/verifiability.ts. */}
        {isUnverifiable(race.metricKey) && (
          <View style={styles.warningCard}>
            <Ionicons name="warning-outline" size={18} color={colors.risk} />
            <Text style={styles.warningText}>
              {`ASTA scores from a workout file you export from your watch, and there's no such file for ${race.metricKey} — it's a daily total rather than a recorded activity. `}
              {race.hasEntered ? "Your total will stay at zero." : "Your total would stay at zero."}
            </Text>
          </View>
        )}

        {/* The evidence path. RUNNING only: before the race starts there is
            no window for an activity to fall inside, and ingestRaceSamples
            rejects anything outside it — so an upload button on a LOCKED
            race could only ever produce a refusal. */}
        {race.hasEntered && myEntryId && !isUnverifiable(race.metricKey) && race.status === "RUNNING" && (
          <View style={styles.importCard}>
            <Text style={styles.importTitle}>Add your activity</Text>
            <Text style={styles.importBody}>
              Export the workout from your watch or training app and upload it here. ASTA reads{" "}
              {ACCEPTED_EXTENSIONS.join(", ")} files. Upload as many as you like — the same file twice only counts once.
            </Text>
            <Pressable style={[styles.cta, importing && styles.ctaDisabled]} disabled={importing} onPress={() => doImport(myEntryId)}>
              {importing ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.ctaText}>Sync data</Text>
              )}
            </Pressable>
          </View>
        )}

        <Text style={styles.sectionTitle}>Prizes</Text>
        <View style={styles.prizeCard}>
          {race.prizes.map((p) => (
            <View key={p.position} style={styles.prizeLine}>
              <Text style={styles.prizeLinePos}>{ordinal(p.position)}</Text>
              <Text style={styles.prizeLineAmount}>{formatCents(p.amountCents)}</Text>
            </View>
          ))}
          <Text style={styles.prizeFootnote}>
            {race.format === "SQUAD"
              ? `Split evenly among the winning squad's ${race.squadSize} members.`
              : `Positions ${race.prizes.length + 1}–${race.entrantCount} pay nothing.`}{" "}
            These amounts are fixed in advance and don't change with the number of entrants.
          </Text>
        </View>

        {/* Squads. Always listed so the field is legible, but joining is
            gated: an invite-only squad shows a lock instead of a Join button,
            because its captain has not opened it to strangers. */}
        {race.format === "SQUAD" && (
          <>
            <Text style={styles.sectionTitle}>Squads</Text>
            {race.squads.length === 0 && (
              <Text style={styles.squadMeta}>No squads yet — start the first one below.</Text>
            )}
            {race.squads.map((squad) => {
              const full = squad.memberCount >= squad.capacity;
              const canJoinDirectly =
                squad.joinPolicy === "OPEN" && !full && !race.hasEntered && race.status === "FILLING";
              return (
                <View key={squad.id} style={[styles.squadRow, squad.isMine && styles.squadRowMine]}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.squadNameRow}>
                      <Text style={styles.squadName}>{squad.name}</Text>
                      {squad.joinPolicy === "INVITE_ONLY" && (
                        <Ionicons name="lock-closed" size={12} color={colors.sub} style={styles.lockIcon} />
                      )}
                      {squad.isMine && <Text style={styles.yoursTag}>Yours</Text>}
                    </View>
                    <Text style={styles.squadMeta}>
                      {squad.memberCount} of {squad.capacity} ·{" "}
                      {squad.joinPolicy === "OPEN" ? "open to anyone in this race" : "invite only"}
                    </Text>

                    {/* Members see their own squad's code so they can pull the
                        rest of the team in. Non-members never receive it —
                        the backend omits it entirely. */}
                    {squad.isMine && squad.inviteCode != null && (
                      <Pressable
                        style={styles.codeChip}
                        onPress={() => {
                          // Core RN Share rather than a clipboard module: no
                          // native dependency to add, and it hands the code
                          // straight to whichever app they'd send it in.
                          void shareCode({
                            message:
                              "Join my squad \"" + squad.name + "\" on ASTA — squad code: " + squad.inviteCode,
                            title: "Squad code",
                            code: squad.inviteCode as string,
                          });
                        }}
                      >
                        <Ionicons name="share-outline" size={12} color={colors.accent} />
                        <Text style={styles.codeChipText}>{squad.inviteCode}</Text>
                      </Pressable>
                    )}
                  </View>

                  {canJoinDirectly ? (
                    <Pressable
                      style={styles.squadJoin}
                      disabled={busy}
                      onPress={() => confirmThenEnter(race, (accept) => doEnter({ squadId: squad.id, acceptLowerLeague: accept }))}
                    >
                      <Text style={styles.squadJoinText}>Join</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.squadStateText}>
                      {full ? "Full" : squad.isMine ? "" : squad.joinPolicy === "INVITE_ONLY" ? "Invite only" : ""}
                    </Text>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* Joining an invite-only squad: the code IS the permission. */}
        {race.format === "SQUAD" && race.status === "FILLING" && !race.hasEntered && (
          <>
            <Text style={styles.sectionTitle}>Got a squad code?</Text>
            <View style={styles.newSquadCard}>
              <Text style={styles.squadMeta}>Paste the code the squad's captain sent you.</Text>
              <TextInput
                style={styles.input}
                value={joinCode}
                onChangeText={setJoinCode}
                placeholder="e.g. 4f9a2c71"
                placeholderTextColor={colors.sub}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={32}
              />
              <Pressable
                style={[styles.cta, (joinCode.trim().length < 4 || busy) && styles.ctaDisabled]}
                disabled={joinCode.trim().length < 4 || busy}
                onPress={() => confirmThenEnter(race, (accept) => doEnter({ squadInviteCode: joinCode.trim(), acceptLowerLeague: accept }))}
              >
                <Text style={styles.ctaText}>Join squad · {formatCents(race.entryFeeCents)}</Text>
              </Pressable>
            </View>

            {race.squads.length < race.entrantCount && (
              <>
                <Text style={styles.sectionTitle}>Or start your own</Text>
                <View style={styles.newSquadCard}>
                  <TextInput
                    style={styles.input}
                    value={squadName}
                    onChangeText={setSquadName}
                    placeholder="Squad name"
                    placeholderTextColor={colors.sub}
                    maxLength={30}
                  />

                  {/* Default is closed. The two mistakes are not symmetric:
                      wanting open and getting private just means sharing a
                      code, while wanting private and getting open has already
                      cost you a seat — and in a squad race a passenger costs
                      the whole team the prize. */}
                  <Pressable style={styles.policyRow} onPress={() => setOpenToAnyone((v) => !v)}>
                    <Ionicons
                      name={openToAnyone ? "checkbox-outline" : "square-outline"}
                      size={20}
                      color={openToAnyone ? colors.accent : colors.sub}
                    />
                    <View style={styles.policyTextWrap}>
                      <Text style={styles.policyLabel}>Let anyone in this race join</Text>
                      <Text style={styles.policyHint}>
                        {openToAnyone
                          ? "Anyone with a spare seat can join without asking you."
                          : "Invite only — people need the code you share. You'll get the code as soon as you create the squad."}
                      </Text>
                    </View>
                  </Pressable>

                  <Pressable
                    style={[styles.cta, (!squadName.trim() || busy) && styles.ctaDisabled]}
                    disabled={!squadName.trim() || busy}
                    onPress={() =>
                      confirmThenEnter(race, (accept) =>
                        doEnter({
                          squadName: squadName.trim(),
                          squadJoinPolicy: openToAnyone ? "OPEN" : "INVITE_ONLY",
                          acceptLowerLeague: accept,
                        })
                      )
                    }
                  >
                    <Text style={styles.ctaText}>Create & enter · {formatCents(race.entryFeeCents)}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </>
        )}

        {race.format === "INDIVIDUAL" && race.status === "FILLING" && !race.hasEntered && (
          <Pressable
            style={[styles.cta, busy && styles.ctaDisabled]}
            disabled={busy}
            onPress={() => confirmThenEnter(race, (accept) => doEnter({ acceptLowerLeague: accept }))}
          >
            {busy ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.ctaText}>
                {race.isLowerLeagueOption ? `Enter anyway · ${formatCents(race.entryFeeCents)}` : `Enter · ${formatCents(race.entryFeeCents)}`}
              </Text>
            )}
          </Pressable>
        )}

        {/* Standings */}
        {standings && (
          <>
            <Text style={styles.sectionTitle}>{standingsAreProvisional ? "Standings so far" : "Final result"}</Text>
            {standingsAreProvisional && (
              <Text style={styles.provisionalNote}>
                Provisional — positions are confirmed when the race finishes and results have been checked.
              </Text>
            )}

            {standings.format === "INDIVIDUAL"
              ? standings.individuals.map((row) => (
                  <View key={row.entryId} style={[styles.standingRow, row.entryId === myEntryId && styles.standingRowMine]}>
                    <Text style={styles.standingPos}>{ordinal(row.position)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.standingName} numberOfLines={1}>
                        {row.displayName}
                        {row.status === "DISQUALIFIED" ? " · disqualified" : ""}
                      </Text>
                      {row.position > 1 && (
                        <Text style={styles.gapText}>{formatMetricValue(row.gapFromLeader, metricDisplay)} behind 1st</Text>
                      )}
                    </View>
                    <Text style={styles.standingTotal}>{formatMetricValue(row.total, metricDisplay)}</Text>
                  </View>
                ))
              : standings.squads.map((squad) => (
                  <View key={squad.squadId} style={styles.squadStanding}>
                    <View style={styles.standingRow}>
                      <Text style={styles.standingPos}>{ordinal(squad.position)}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.standingName} numberOfLines={1}>
                          {squad.name}
                        </Text>
                        {squad.position > 1 && (
                          <Text style={styles.gapText}>{formatMetricValue(squad.gapFromLeader, metricDisplay)} behind leading squad</Text>
                        )}
                      </View>
                      <Text style={styles.standingTotal}>{formatMetricValue(squad.total, metricDisplay)}</Text>
                    </View>
                    {squad.members.map((m) => (
                      <View key={m.entryId} style={styles.memberRow}>
                        <Text style={styles.memberName} numberOfLines={1}>
                          {m.displayName}
                        </Text>
                        <Text style={styles.memberTotal}>{formatMetricValue(m.total, metricDisplay)}</Text>
                      </View>
                    ))}
                  </View>
                ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RegisterCard({ race, onOpenProfile }: { race: RaceDetail["race"]; onOpenProfile: () => void }) {
  const participants = race.participants ?? [];
  const slotsRemaining = Math.max(0, race.entrantsRequired - race.entrantsNow);

  return (
    <>
      <Text style={styles.sectionTitle}>Competitors</Text>
      <View style={styles.registerCard}>
        <View style={styles.registerTop}>
          <View>
            <Text style={styles.registerHeadline}>
              {race.entrantsNow} of {race.entrantsRequired} places filled
            </Text>
            <Text style={styles.registerBody}>
              {slotsRemaining} {slotsRemaining === 1 ? "place" : "places"} still open.
            </Text>
          </View>
          <View style={styles.registerBadge}>
            <Text style={styles.registerBadgeText}>{race.visibility === "PUBLIC" ? "Public" : "Invite only"}</Text>
          </View>
        </View>

        {participants.length === 0 ? (
          <Text style={styles.emptyRegister}>Nobody has entered yet.</Text>
        ) : (
          participants.map((participant) => (
            <Pressable
              key={participant.entryId}
              style={[styles.registerRow, participant.isViewer && styles.registerRowMine]}
              onPress={participant.isViewer ? onOpenProfile : undefined}
              disabled={!participant.isViewer}
            >
              <View style={[styles.registerAvatar, participant.isViewer && styles.registerAvatarMine]}>
                {participant.avatarUrl ? (
                  <Image source={{ uri: participant.avatarUrl }} style={styles.registerAvatarImage} />
                ) : (
                  <Text style={styles.registerAvatarText}>{initialFor(participant.displayName)}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.registerName} numberOfLines={1}>
                  {participant.displayName}
                </Text>
                <Text style={styles.registerMeta} numberOfLines={1}>
                  {participant.squadName ? `${participant.squadName} · ` : ""}
                  {participant.isViewer ? "Your profile · " : ""}
                  {participant.status.toLowerCase()}
                </Text>
              </View>
              {participant.isViewer && <Ionicons name="person-circle-outline" size={18} color={colors.accent} />}
            </Pressable>
          ))
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.text, textTransform: "capitalize" },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginTop: 2 },
  raceMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.md },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  metaPillText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.text },
  creatorLine: { flexShrink: 1, fontFamily: fonts.body, fontSize: 12, color: colors.sub },
  shareRaceButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  shareRaceText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.bg },

  statusCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginTop: spacing.lg },
  importCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, gap: spacing.sm, marginTop: spacing.md },
  importTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  importBody: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, lineHeight: 18, marginBottom: spacing.xs },
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
  statusHeadline: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.text },
  statusBody: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginTop: spacing.sm, lineHeight: 19 },

  myStandingCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  myStandingHeadline: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  myStandingBody: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginTop: 2 },

  withdrawBtn: {
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.sub,
  },
  withdrawBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.sub },

  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  registerCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  registerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  registerHeadline: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  registerBody: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 2 },
  registerBadge: { backgroundColor: colors.surfaceRaised, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  registerBadgeText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.text },
  registerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.sm },
  registerRowMine: { borderRadius: radii.md, backgroundColor: colors.surfaceRaised, padding: spacing.sm },
  registerAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  registerAvatarMine: { backgroundColor: colors.accent },
  registerAvatarImage: { width: 30, height: 30, borderRadius: 15 },
  registerAvatarText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.text },
  registerName: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.text },
  registerMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 1 },
  emptyRegister: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, lineHeight: 18 },
  prizeCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg },
  prizeLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.sm },
  prizeLinePos: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.sub },
  prizeLineAmount: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.won },
  prizeFootnote: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: spacing.md, lineHeight: 18 },

  squadRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, marginBottom: spacing.sm },
  squadRowMine: { borderWidth: 1, borderColor: colors.sage },
  squadNameRow: { flexDirection: "row", alignItems: "center" },
  lockIcon: { marginLeft: 6 },
  yoursTag: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.sage, marginLeft: spacing.sm },
  squadStateText: { fontFamily: fonts.body, fontSize: 12, color: colors.sub },
  codeChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  codeChipText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.accent, letterSpacing: 1 },
  policyRow: { flexDirection: "row", alignItems: "flex-start", marginTop: spacing.lg },
  policyTextWrap: { flex: 1, marginLeft: spacing.md },
  policyLabel: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.text },
  policyHint: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 2, lineHeight: 16 },
  squadName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  squadMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 1 },
  squadJoin: { backgroundColor: colors.accent, borderRadius: radii.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  squadJoinDisabled: { backgroundColor: colors.surfaceRaised },
  squadJoinText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.bg },
  squadJoinTextDisabled: { color: colors.sub },
  newSquadCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.sm,
    padding: spacing.md,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
    marginTop: spacing.sm,
  },

  cta: { backgroundColor: colors.accent, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.bg },

  provisionalNote: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginBottom: spacing.md, lineHeight: 18 },
  standingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  standingRowMine: { backgroundColor: colors.surfaceRaised, borderRadius: radii.sm, paddingHorizontal: spacing.sm },
  standingPos: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accent, width: 34 },
  standingName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text, flex: 1 },
  standingTotal: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  gapText: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 1 },
  squadStanding: { backgroundColor: colors.surface, borderRadius: radii.md, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  memberRow: { flexDirection: "row", justifyContent: "space-between", paddingLeft: 34, paddingBottom: spacing.sm },
  memberName: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, flex: 1 },
  memberTotal: { fontFamily: fonts.body, fontSize: 12, color: colors.sub },
});
