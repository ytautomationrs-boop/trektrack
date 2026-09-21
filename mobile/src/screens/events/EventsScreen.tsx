import React, { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { LoadError } from "../../components/LoadError";
import { showAlert } from "../../lib/alert";
import { shareCode } from "../../lib/shareCode";
import { eventUrl } from "../../lib/webLinks";
import { createSocialEvent, getSocialEvents, getSocialSports, type SocialEvent, type SocialSport } from "../../api/eventClient";

const FALLBACK_SPORTS: SocialSport[] = [
  { key: "tennis", name: "Tennis", icon: "tennisball-outline" },
  { key: "squash", name: "Squash", icon: "scan-circle-outline" },
  { key: "padel", name: "Padel", icon: "radio-button-on-outline" },
  { key: "touch_rugby", name: "Touch rugby", icon: "american-football-outline" },
  { key: "football", name: "Football", icon: "football-outline" },
  { key: "custom", name: "Custom game", icon: "create-outline" },
];

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function tomorrowDate() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function toStartsAt(dateText: string, timeText: string) {
  const local = new Date(`${dateText}T${timeText || "18:00"}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

export function EventsScreen() {
  const navigation = useNavigation<any>();
  const [sports, setSports] = useState<SocialSport[]>(FALLBACK_SPORTS);
  const [events, setEvents] = useState<SocialEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const sportsPromise = getSocialSports().then((r) => setSports(r.sports)).catch(() => {});
    try {
      const result = await getSocialEvents();
      setEvents(result.events);
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }
    await sportsPromise;
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const joined = events.filter((event) => event.hasJoined);
  const open = events.filter((event) => !event.hasJoined);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.header}>Events</Text>
            <Text style={styles.headerSub}>Free social games hosted by players.</Text>
          </View>
          <Pressable style={styles.createButton} onPress={() => setShowCreate((value) => !value)}>
            <Ionicons name={showCreate ? "close" : "add"} size={18} color={colors.bg} />
          </Pressable>
        </View>

        {showCreate && (
          <CreateEventPanel
            sports={sports}
            onCreated={(event) => {
              setEvents((items) => [event, ...items.filter((item) => item.id !== event.id)]);
              setShowCreate(false);
              navigation.navigate("EventDetail", { eventId: event.id });
            }}
          />
        )}

        {loading && events.length === 0 && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />}
        {!loading && loadError && events.length === 0 && <LoadError error={loadError} onRetry={load} />}

        {joined.length > 0 && <Text style={styles.sectionTitle}>Your events</Text>}
        {joined.map((event) => (
          <EventCard key={event.id} event={event} onOpen={() => navigation.navigate("EventDetail", { eventId: event.id })} />
        ))}

        <Text style={styles.sectionTitle}>Open events</Text>
        {!loading && open.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No open social games yet</Text>
            <Text style={styles.emptyText}>Host a free game and invite people to play.</Text>
          </View>
        ) : null}
        {open.map((event) => (
          <EventCard key={event.id} event={event} onOpen={() => navigation.navigate("EventDetail", { eventId: event.id })} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function CreateEventPanel({ sports, onCreated }: { sports: SocialSport[]; onCreated: (event: SocialEvent) => void }) {
  const [sportKey, setSportKey] = useState(sports[0]?.key ?? "tennis");
  const [customSportName, setCustomSportName] = useState("");
  const [name, setName] = useState("");
  const [dateText, setDateText] = useState(tomorrowDate());
  const [timeText, setTimeText] = useState("18:00");
  const [location, setLocation] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("4");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedSport = useMemo(() => sports.find((sport) => sport.key === sportKey) ?? sports[0], [sportKey, sports]);
  const defaultName = selectedSport ? `${selectedSport.name} game` : "Social game";

  const submit = async () => {
    const startsAt = toStartsAt(dateText.trim(), timeText.trim());
    const players = Number.parseInt(maxPlayers, 10);
    if (!startsAt) return showAlert("Date and time", "Use a date like 2026-09-22 and a time like 18:00.");
    if (!players || players < 2 || players > 100) return showAlert("Players", "Choose between 2 and 100 players.");
    if (sportKey === "custom" && customSportName.trim().length < 2) return showAlert("Custom game", "Name the game people are joining.");
    setBusy(true);
    try {
      const result = await createSocialEvent({
        name: name.trim() || defaultName,
        sportKey,
        customSportName: customSportName.trim() || undefined,
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        startsAt,
        maxPlayers: players,
        visibility,
      });
      onCreated(result.event);
    } catch (err: any) {
      showAlert("Couldn't create event", err.message ?? "Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Host a social game</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sportRow}>
        {sports.map((sport) => (
          <Pressable key={sport.key} style={[styles.sportChip, sportKey === sport.key && styles.sportChipActive]} onPress={() => setSportKey(sport.key)}>
            <Ionicons name={sport.icon as keyof typeof Ionicons.glyphMap} size={14} color={sportKey === sport.key ? colors.bg : colors.sub} />
            <Text style={[styles.sportChipText, sportKey === sport.key && styles.sportChipTextActive]}>{sport.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {sportKey === "custom" && (
        <TextInput style={styles.input} value={customSportName} onChangeText={setCustomSportName} placeholder="Custom game name" placeholderTextColor={colors.sub} />
      )}
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={defaultName} placeholderTextColor={colors.sub} />
      <View style={styles.twoCol}>
        <TextInput style={[styles.input, styles.flexInput]} value={dateText} onChangeText={setDateText} placeholder="YYYY-MM-DD" placeholderTextColor={colors.sub} />
        <TextInput style={[styles.input, styles.flexInput]} value={timeText} onChangeText={setTimeText} placeholder="18:00" placeholderTextColor={colors.sub} />
      </View>
      <View style={styles.twoCol}>
        <TextInput style={[styles.input, styles.flexInput]} value={maxPlayers} onChangeText={setMaxPlayers} placeholder="Players" keyboardType="number-pad" placeholderTextColor={colors.sub} />
        <View style={styles.segment}>
          <Pressable style={[styles.segmentButton, visibility === "PUBLIC" && styles.segmentActive]} onPress={() => setVisibility("PUBLIC")}>
            <Text style={[styles.segmentText, visibility === "PUBLIC" && styles.segmentTextActive]}>Public</Text>
          </Pressable>
          <Pressable style={[styles.segmentButton, visibility === "PRIVATE" && styles.segmentActive]} onPress={() => setVisibility("PRIVATE")}>
            <Text style={[styles.segmentText, visibility === "PRIVATE" && styles.segmentTextActive]}>Invite</Text>
          </Pressable>
        </View>
      </View>
      <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="Location" placeholderTextColor={colors.sub} />
      <TextInput style={[styles.input, styles.description]} value={description} onChangeText={setDescription} placeholder="Details, rules, or team size" placeholderTextColor={colors.sub} multiline />
      <Pressable style={[styles.primaryButton, busy && styles.disabled]} disabled={busy} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.primaryButtonText}>Create event</Text>}
      </Pressable>
    </View>
  );
}

function EventCard({ event, onOpen }: { event: SocialEvent; onOpen: () => void }) {
  const shareEvent = () => {
    const link = eventUrl(event.id, event.inviteCode);
    void shareCode({
      title: "Event link",
      code: link,
      message: `Join my TrackTrek event "${event.name}" on ${formatDateTime(event.startsAt)}.\n${link}`,
    });
  };

  return (
    <Pressable style={styles.card} onPress={onOpen}>
      <View style={styles.cardHead}>
        <View style={styles.eventIcon}>
          <Ionicons name="calendar-outline" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{event.name}</Text>
          <Text style={styles.cardSub}>{event.sportName} · {formatDateTime(event.startsAt)}</Text>
          <Text style={styles.cardSub} numberOfLines={1}>Hosted by {event.host.displayName}{event.location ? ` · ${event.location}` : ""}</Text>
        </View>
        <View style={styles.visibilityPill}>
          <Ionicons name={event.visibility === "PUBLIC" ? "earth" : "lock-closed"} size={11} color={colors.text} />
          <Text style={styles.visibilityText}>{event.visibility === "PUBLIC" ? "Public" : "Invite"}</Text>
        </View>
      </View>
      <View style={styles.fillRow}>
        <Text style={styles.fillText}>{event.participantCount}/{event.maxPlayers} players</Text>
        <Text style={styles.fillText}>{event.slotsRemaining} open</Text>
      </View>
      <View style={styles.participantRow}>
        {event.participants.slice(0, 5).map((participant) => (
          <View key={participant.id} style={[styles.participantPill, participant.isViewer && styles.participantPillMine]}>
            <Text style={styles.participantText} numberOfLines={1}>{participant.player.displayName}</Text>
          </View>
        ))}
      </View>
      <View style={styles.actionRow}>
        <Pressable style={styles.secondaryButton} onPress={(e) => { e.stopPropagation(); shareEvent(); }}>
          <Ionicons name="share-outline" size={15} color={colors.text} />
          <Text style={styles.secondaryButtonText}>Share</Text>
        </Pressable>
        <Text style={styles.tapHint}>View details</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  header: { fontFamily: fonts.display, fontSize: 30, color: colors.text },
  headerSub: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 2 },
  createButton: { width: 42, height: 42, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.md },
  panel: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md, marginBottom: spacing.lg },
  panelTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.text },
  sportRow: { gap: spacing.sm, paddingVertical: 2 },
  sportChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sportChipActive: { backgroundColor: colors.accent },
  sportChipText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.sub },
  sportChipTextActive: { color: colors.bg },
  input: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md, color: colors.text, fontFamily: fonts.body, fontSize: 14 },
  description: { minHeight: 70, textAlignVertical: "top" },
  twoCol: { flexDirection: "row", gap: spacing.sm },
  flexInput: { flex: 1 },
  segment: { flex: 1, flexDirection: "row", backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: 3 },
  segmentButton: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radii.sm },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.sub },
  segmentTextActive: { color: colors.bg },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radii.md, minHeight: 44, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  eventIcon: { width: 38, height: 38, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.text },
  cardSub: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 1 },
  visibilityPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  visibilityText: { fontFamily: fonts.bodySemiBold, fontSize: 10, color: colors.text },
  fillRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md },
  fillText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.sub },
  participantRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  participantPill: { maxWidth: 120, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  participantPillMine: { backgroundColor: colors.accent },
  participantText: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.text },
  actionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  secondaryButton: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radii.md, borderWidth: 1, borderColor: colors.surfaceRaised, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  secondaryButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.text },
  tapHint: { fontFamily: fonts.body, fontSize: 11, color: colors.sub },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center" },
  emptyTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  emptyText: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 4 },
  disabled: { opacity: 0.5 },
});
