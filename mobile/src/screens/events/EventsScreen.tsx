import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { LoadError } from "../../components/LoadError";
import { showAlert } from "../../lib/alert";
import { shareCode } from "../../lib/shareCode";
import { eventUrl } from "../../lib/webLinks";
import { createSocialEvent, getSocialEvents, getSocialSports, type SocialEvent, type SocialSport } from "../../api/eventClient";
import { Capacitor } from "@capacitor/core";
import { CapacitorCalendar } from "@ebarooni/capacitor-calendar";

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

function localDateFromText(dateText: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(dateText: string) {
  const date = localDateFromText(dateText);
  if (!date) return dateText;
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function shiftDate(dateText: string, days: number) {
  const date = localDateFromText(dateText) ?? new Date();
  date.setDate(date.getDate() + days);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) return formatDateValue(today);
  return formatDateValue(date);
}

function timeParts(timeText: string) {
  const [hourRaw, minuteRaw] = timeText.split(":").map(Number);
  const hour = Number.isFinite(hourRaw) ? Math.max(0, Math.min(23, hourRaw)) : 18;
  const minute = Number.isFinite(minuteRaw) ? Math.max(0, Math.min(59, minuteRaw)) : 0;
  return { hour, minute };
}

function formatTimeParts(hour: number, minute: number) {
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function toStartsAt(dateText: string, timeText: string) {
  const local = new Date(`${dateText}T${timeText || "18:00"}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

export function EventsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [sports, setSports] = useState<SocialSport[]>(FALLBACK_SPORTS);
  const [events, setEvents] = useState<SocialEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const hasLoaded = useRef(false);
  const [view, setView] = useState<"events" | "calendar">("events");

  const load = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true);
    const sportsPromise = getSocialSports().then((r) => setSports(r.sports)).catch(() => {});
    try {
      const result = await getSocialEvents({ onCached: (saved) => { setEvents(saved.events); hasLoaded.current = true; } });
      hasLoaded.current = true;
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

  // The centre + button can open this screen directly in creation mode.
  // Clear the one-shot route parameter after consuming it so returning to
  // Events later does not unexpectedly reopen the form.
  useEffect(() => {
    if (!route.params?.openCreate) return;
    navigation.setParams({ openCreate: undefined });
    navigation.navigate("CreateEvent");
  }, [navigation, route.params?.openCreate]);

  const joined = useMemo(() => events.filter((event) => event.hasJoined), [events]);
  const publicEvents = useMemo(() => events.filter((event) => event.visibility === "PUBLIC"), [events]);
  const otherPublicEvents = useMemo(
    () => publicEvents.filter((event) => !event.hasJoined && !event.isHost),
    [publicEvents]
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.header}>Events</Text>
            <Text style={styles.headerSub}>Find a public game or manage games you have joined.</Text>
          </View>
          <Pressable
            style={styles.createButton}
            accessibilityRole="button"
            accessibilityLabel="Create social game"
            onPress={() => navigation.navigate("CreateEvent")}
          >
            <Ionicons name="add" size={18} color={colors.onAccent} />
          </Pressable>
        </View>

        <View style={styles.viewTabs}>
          <Pressable style={[styles.viewTab, view === "events" && styles.viewTabActive]} onPress={() => setView("events")}>
            <Ionicons name="people-outline" size={16} color={view === "events" ? colors.bg : colors.sub} />
            <Text style={[styles.viewTabText, view === "events" && styles.viewTabTextActive]}>Public games</Text>
          </Pressable>
          <Pressable style={[styles.viewTab, view === "calendar" && styles.viewTabActive]} onPress={() => setView("calendar")}>
            <Ionicons name="calendar-outline" size={16} color={view === "calendar" ? colors.bg : colors.sub} />
            <Text style={[styles.viewTabText, view === "calendar" && styles.viewTabTextActive]}>My calendar</Text>
          </Pressable>
        </View>

        {loading && events.length === 0 ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} /> : null}
        {!loading && loadError && events.length === 0 ? <LoadError error={loadError} onRetry={load} /> : null}

        {view === "calendar" ? (
          <EventCalendar events={joined} onOpen={(event) => navigation.navigate("EventDetail", { eventId: event.id })} />
        ) : (
          <>
        {joined.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Your events</Text>
            {joined.map((event) => (
              <EventCard key={event.id} event={event} onOpen={() => navigation.navigate("EventDetail", { eventId: event.id })} />
            ))}
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Public games</Text>
        <Text style={styles.sectionSubtitle}>Upcoming games hosted by other players. Open any game to see the details and join.</Text>
        {!loading && !loadError && otherPublicEvents.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No other public games right now</Text>
            <Text style={styles.emptyText}>New public games from the ASTA community will appear here.</Text>
          </View>
        ) : null}
        {otherPublicEvents.map((event) => (
          <EventCard key={event.id} event={event} onOpen={() => navigation.navigate("EventDetail", { eventId: event.id })} />
        ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function EventCalendar({ events, onOpen }: { events: SocialEvent[]; onOpen: (event: SocialEvent) => void }) {
  const upcoming = [...events].filter((event) => new Date(event.startsAt).getTime() >= Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const addToCalendar = async (event: SocialEvent) => {
    if (!Capacitor.isNativePlatform()) {
      showAlert("Apple Calendar", "Calendar sync is available in the iPhone app.");
      return;
    }
    const startDate = new Date(event.startsAt).getTime();
    try {
      await CapacitorCalendar.createEventWithPrompt({
        title: event.name,
        location: event.location ?? undefined,
        description: event.description ?? "ASTA social event",
        startDate,
        endDate: startDate + 60 * 60 * 1000,
      });
    } catch (error: any) {
      showAlert("Calendar sync", error?.message ?? "The event could not be added to Apple Calendar.");
    }
  };

  return (
    <View>
      <Text style={styles.header}>My calendar</Text>
      <Text style={styles.headerSub}>Games you have joined, in date order.</Text>
      {upcoming.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No upcoming games</Text>
          <Text style={styles.emptyText}>Join an event and it will appear here.</Text>
        </View>
      ) : upcoming.map((event) => (
        <View key={event.id} style={styles.calendarRow}>
          <Pressable style={styles.calendarMain} onPress={() => onOpen(event)}>
            <Text style={styles.calendarDate}>{new Date(event.startsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.calendarTitle}>{event.name}</Text>
              <Text style={styles.calendarMeta}>{formatDateTime(event.startsAt)}{event.location ? ` · ${event.location}` : ""}</Text>
            </View>
          </Pressable>
          <Pressable style={styles.calendarSync} onPress={() => addToCalendar(event)}>
            <Ionicons name="calendar-outline" size={17} color={colors.accent} />
            <Text style={styles.calendarSyncText}>Add</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export function CreateEventScreen() {
  const navigation = useNavigation<any>();
  const [sports, setSports] = useState<SocialSport[]>(FALLBACK_SPORTS);
  useEffect(() => { void getSocialSports().then((result) => setSports(result.sports)).catch(() => {}); }, []);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.header}>Create a social game</Text>
      <CreateEventPanel sports={sports} onCreated={(event) => navigation.replace("EventDetail", { eventId: event.id })} />
    </ScrollView>
  );
}

function CreateEventPanel({ sports, onCreated }: { sports: SocialSport[]; onCreated: (event: SocialEvent) => void }) {
  const [sportKey, setSportKey] = useState(sports[0]?.key ?? "tennis");
  const [customSportName, setCustomSportName] = useState("");
  const [name, setName] = useState("");
  const [dateText, setDateText] = useState(tomorrowDate());
  const [timeText, setTimeText] = useState("18:00");
  const [location, setLocation] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedSport = useMemo(() => sports.find((sport) => sport.key === sportKey) ?? sports[0], [sportKey, sports]);
  const defaultName = selectedSport ? `${selectedSport.name} game` : "Social game";

  const submit = async () => {
    const startsAt = toStartsAt(dateText.trim(), timeText.trim());
    const players = maxPlayers;
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
      <LabeledField label="Sport">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sportRow}>
        {sports.map((sport) => (
          <Pressable key={sport.key} style={[styles.sportChip, sportKey === sport.key && styles.sportChipActive]} onPress={() => setSportKey(sport.key)}>
            <Ionicons name={sport.icon as keyof typeof Ionicons.glyphMap} size={14} color={sportKey === sport.key ? colors.bg : colors.sub} />
            <Text style={[styles.sportChipText, sportKey === sport.key && styles.sportChipTextActive]}>{sport.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      </LabeledField>
      {sportKey === "custom" && (
        <LabeledField label="Custom sport">
          <TextInput style={styles.input} value={customSportName} onChangeText={setCustomSportName} placeholder="Custom game name" placeholderTextColor={colors.sub} />
        </LabeledField>
      )}
      <LabeledField label="Event name">
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={defaultName} placeholderTextColor={colors.sub} />
      </LabeledField>
      <LabeledField label="Date">
        <SelectorControl
          icon="calendar-outline"
          title={displayDate(dateText)}
          subtitle={dateText}
          onPrevious={() => setDateText((value) => shiftDate(value, -1))}
          onNext={() => setDateText((value) => shiftDate(value, 1))}
        />
      </LabeledField>
      <LabeledField label="Time">
        <TimePickerControl value={timeText} onChange={setTimeText} />
      </LabeledField>
      <View style={styles.twoCol}>
        <LabeledField label="Players" style={styles.flexInput}>
          <View style={styles.stepper}>
            <Pressable style={styles.stepperButton} onPress={() => setMaxPlayers((value) => Math.max(2, value - 1))}>
              <Ionicons name="remove" size={16} color={colors.text} />
            </Pressable>
            <View style={styles.stepperValue}>
              <Text style={styles.stepperNumber}>{maxPlayers}</Text>
              <Text style={styles.stepperLabel}>players</Text>
            </View>
            <Pressable style={styles.stepperButton} onPress={() => setMaxPlayers((value) => Math.min(100, value + 1))}>
              <Ionicons name="add" size={16} color={colors.text} />
            </Pressable>
          </View>
        </LabeledField>
        <LabeledField label="Visibility" style={styles.flexInput}>
        <View style={styles.segment}>
          <Pressable style={[styles.segmentButton, visibility === "PUBLIC" && styles.segmentActive]} onPress={() => setVisibility("PUBLIC")}>
            <Text style={[styles.segmentText, visibility === "PUBLIC" && styles.segmentTextActive]}>Public</Text>
          </Pressable>
          <Pressable style={[styles.segmentButton, visibility === "PRIVATE" && styles.segmentActive]} onPress={() => setVisibility("PRIVATE")}>
            <Text style={[styles.segmentText, visibility === "PRIVATE" && styles.segmentTextActive]}>Invite</Text>
          </Pressable>
        </View>
        </LabeledField>
      </View>
      <LabeledField label="Location">
        <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="Court, field, club, or address" placeholderTextColor={colors.sub} />
      </LabeledField>
      <LabeledField label="Details">
        <TextInput style={[styles.input, styles.description]} value={description} onChangeText={setDescription} placeholder="Rules, team size, skill level, or notes" placeholderTextColor={colors.sub} multiline />
      </LabeledField>
      <Pressable style={[styles.primaryButton, busy && styles.disabled]} disabled={busy} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.primaryButtonText}>Create event</Text>}
      </Pressable>
    </View>
  );
}

function LabeledField({ label, children, style }: { label: string; children: React.ReactNode; style?: any }) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function TimePickerControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { hour, minute } = timeParts(value);

  const setHour = (nextHour: number) => onChange(formatTimeParts((nextHour + 24) % 24, minute));
  const setMinute = (nextMinute: number) => onChange(formatTimeParts(hour, (nextMinute + 60) % 60));

  return (
    <View style={styles.timePicker}>
      <TimeWheelColumn label="Hour" value={hour.toString().padStart(2, "0")} onUp={() => setHour(hour + 1)} onDown={() => setHour(hour - 1)} />
      <Text style={styles.timeColon}>:</Text>
      <TimeWheelColumn
        label="Minute"
        value={minute.toString().padStart(2, "0")}
        onUp={() => setMinute(minute + 1)}
        onDown={() => setMinute(minute - 1)}
      />
    </View>
  );
}

function TimeWheelColumn({ label, value, onUp, onDown }: { label: string; value: string; onUp: () => void; onDown: () => void }) {
  return (
    <View style={styles.timeColumn}>
      <Pressable style={styles.timeArrow} onPress={onUp} hitSlop={8}>
        <Ionicons name="chevron-up" size={18} color={colors.sub} />
      </Pressable>
      <View style={styles.timeValueWrap}>
        <Text style={styles.timeValue}>{value}</Text>
        <Text style={styles.timeLabel}>{label}</Text>
      </View>
      <Pressable style={styles.timeArrow} onPress={onDown} hitSlop={8}>
        <Ionicons name="chevron-down" size={18} color={colors.sub} />
      </Pressable>
    </View>
  );
}

function SelectorControl({
  icon,
  title,
  subtitle,
  onPrevious,
  onNext,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPrevious: () => void;
  onNext: () => void;
  style?: any;
}) {
  return (
    <View style={[styles.selectorControl, style]}>
      <Pressable style={styles.selectorButton} onPress={onPrevious}>
        <Ionicons name="chevron-back" size={18} color={colors.text} />
      </Pressable>
      <View style={styles.selectorValue}>
        <Ionicons name={icon} size={15} color={colors.accent} />
        <Text style={styles.selectorTitle} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>
        <Text style={styles.selectorSub}>{subtitle}</Text>
      </View>
      <Pressable style={styles.selectorButton} onPress={onNext}>
        <Ionicons name="chevron-forward" size={18} color={colors.text} />
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
      message: `Join my ASTA event "${event.name}" on ${formatDateTime(event.startsAt)}.\n${link}`,
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
        <View style={[styles.visibilityPill, event.hasJoined && styles.joinedPill]}>
          <Ionicons
            name={event.isHost ? "star" : event.hasJoined ? "checkmark" : event.visibility === "PUBLIC" ? "earth" : "lock-closed"}
            size={11}
            color={event.hasJoined ? colors.bg : colors.text}
          />
          <Text style={[styles.visibilityText, event.hasJoined && styles.joinedPillText]}>
            {event.isHost ? "Hosting" : event.hasJoined ? "Joined" : event.visibility === "PUBLIC" ? "Public" : "Invite"}
          </Text>
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
  viewTabs: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radii.lg, padding: 4, marginBottom: spacing.lg },
  viewTab: { flex: 1, minHeight: 42, borderRadius: radii.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  viewTabActive: { backgroundColor: colors.accent },
  viewTabText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.sub },
  viewTabTextActive: { color: colors.bg },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  header: { fontFamily: fonts.display, fontSize: 30, color: colors.text },
  headerSub: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 2 },
  createButton: { width: 42, height: 42, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.md },
  sectionSubtitle: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.sub, marginTop: -spacing.sm, marginBottom: spacing.md },
  panel: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md, marginBottom: spacing.lg },
  panelTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.text },
  field: { gap: 6 },
  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.sub },
  sportRow: { gap: spacing.sm, paddingVertical: 2 },
  sportChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sportChipActive: { backgroundColor: colors.accent },
  sportChipText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.sub },
  sportChipTextActive: { color: colors.bg },
  input: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md, color: colors.text, fontFamily: fonts.body, fontSize: 16 },
  description: { minHeight: 70, textAlignVertical: "top" },
  twoCol: { flexDirection: "row", gap: spacing.sm },
  flexInput: { flex: 1 },
  timePicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  timeColumn: { flex: 1, alignItems: "center", justifyContent: "center", minWidth: 0 },
  timeArrow: { width: 44, height: 28, alignItems: "center", justifyContent: "center" },
  timeValueWrap: { alignItems: "center", justifyContent: "center", minHeight: 58 },
  timeValue: { fontFamily: fonts.display, fontSize: 36, color: colors.text, lineHeight: 42 },
  timeLabel: { fontFamily: fonts.bodySemiBold, fontSize: 10, color: colors.sub, marginTop: -2, textTransform: "uppercase" },
  timeColon: { fontFamily: fonts.display, fontSize: 32, color: colors.sub, paddingHorizontal: spacing.sm, marginTop: -8 },
  selectorControl: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: 4 },
  selectorButton: { width: 36, height: 38, borderRadius: radii.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  selectorValue: { flex: 1, alignItems: "center", minWidth: 0 },
  selectorTitle: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text, maxWidth: "100%" },
  selectorSub: { fontFamily: fonts.body, fontSize: 10, color: colors.sub, marginTop: 1 },
  stepper: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: 4 },
  stepperButton: { width: 34, height: 34, borderRadius: radii.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  stepperValue: { flex: 1, alignItems: "center" },
  stepperNumber: { fontFamily: fonts.display, fontSize: 18, color: colors.text },
  stepperLabel: { fontFamily: fonts.body, fontSize: 10, color: colors.sub, marginTop: -3 },
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
  joinedPill: { backgroundColor: colors.accent },
  joinedPillText: { color: colors.bg },
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
  calendarRow: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, marginTop: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  calendarMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  calendarDate: { width: 48, fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accent, textAlign: "center" },
  calendarTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  calendarMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 2 },
  calendarSync: { alignItems: "center", justifyContent: "center", minWidth: 44, minHeight: 44 },
  calendarSyncText: { fontFamily: fonts.bodySemiBold, fontSize: 10, color: colors.accent, marginTop: 2 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center" },
  emptyTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  emptyText: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 4 },
  disabled: { opacity: 0.5 },
});
