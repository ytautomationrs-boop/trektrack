import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { LoadError } from "../../components/LoadError";
import { showAlert } from "../../lib/alert";
import { shareCode } from "../../lib/shareCode";
import { eventUrl } from "../../lib/webLinks";
import { getSocialEvent, joinSocialEvent, leaveSocialEvent, type SocialEvent } from "../../api/eventClient";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "T";
}

export function EventDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const eventId: string = route.params?.eventId;
  const inviteCode: string | undefined = route.params?.code;
  const [event, setEvent] = useState<SocialEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSocialEvent(eventId, inviteCode);
      setEvent(result.event);
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [eventId, inviteCode]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const shareEvent = () => {
    if (!event) return;
    const link = eventUrl(event.id, event.inviteCode);
    void shareCode({
      title: "Event link",
      code: link,
      message: `Join my ASTA event "${event.name}" on ${formatDateTime(event.startsAt)}.\n${link}`,
    });
  };

  const join = async () => {
    if (!event) return;
    setBusy(true);
    try {
      const result = await joinSocialEvent(event.id, inviteCode ?? event.inviteCode);
      setEvent(result.event);
      showAlert("You're in", "You've joined this event.");
    } catch (err: any) {
      showAlert("Couldn't join", err.message ?? "Try again.");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!event) return;
    setBusy(true);
    try {
      const result = await leaveSocialEvent(event.id);
      setEvent(result.event);
      showAlert("Left event", "You're no longer listed as a player.");
    } catch (err: any) {
      showAlert("Couldn't leave", err.message ?? "Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!event) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable style={styles.backRow} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={18} color={colors.sub} />
            <Text style={styles.backText}>Events</Text>
          </Pressable>
          {loadError ? <LoadError error={loadError} onRetry={load} /> : <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const isFull = event.participantCount >= event.maxPlayers;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <Pressable style={styles.backRow} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={18} color={colors.sub} />
          <Text style={styles.backText}>Events</Text>
        </Pressable>

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="calendar-outline" size={26} color={colors.accent} />
          </View>
          <Text style={styles.title}>{event.name}</Text>
          <Text style={styles.subtitle}>{event.sportName} · {formatDateTime(event.startsAt)}</Text>
          <Text style={styles.subtitle}>Hosted by {event.host.displayName}{event.location ? ` · ${event.location}` : ""}</Text>
          {event.description ? <Text style={styles.description}>{event.description}</Text> : null}
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.shareButton} onPress={shareEvent}>
            <Ionicons name="share-outline" size={16} color={colors.bg} />
            <Text style={styles.shareButtonText}>Share event</Text>
          </Pressable>
          {event.hasJoined ? (
            <Pressable style={[styles.leaveButton, (busy || event.isHost) && styles.disabled]} disabled={busy || event.isHost} onPress={leave}>
              {busy ? <ActivityIndicator color={colors.sub} /> : <Text style={styles.leaveButtonText}>{event.isHost ? "Hosting" : "Leave"}</Text>}
            </Pressable>
          ) : (
            <Pressable style={[styles.shareButton, (busy || isFull) && styles.disabled]} disabled={busy || isFull} onPress={join}>
              {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.shareButtonText}>{isFull ? "Full" : "Join"}</Text>}
            </Pressable>
          )}
        </View>

        <Text style={styles.sectionTitle}>Players</Text>
        <View style={styles.card}>
          <View style={styles.countRow}>
            <Text style={styles.countText}>{event.participantCount} of {event.maxPlayers} joined</Text>
            <Text style={styles.countText}>{event.slotsRemaining} open</Text>
          </View>
          {event.participants.map((participant) => (
            <View key={participant.id} style={styles.playerRow}>
              <View style={styles.avatar}>
                {participant.player.avatarUrl ? (
                  <Image source={{ uri: participant.player.avatarUrl }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>{initial(participant.player.displayName)}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName}>{participant.player.displayName}</Text>
                <Text style={styles.playerMeta}>{participant.userId === event.host.id ? "Host" : participant.isViewer ? "Your profile" : "Player"}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  backRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.sub },
  hero: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center" },
  heroIcon: { width: 56, height: 56, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.text, textAlign: "center", marginTop: spacing.md },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, textAlign: "center", marginTop: 3 },
  description: { fontFamily: fonts.body, fontSize: 13, color: colors.text, textAlign: "center", lineHeight: 19, marginTop: spacing.md },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  shareButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radii.md, backgroundColor: colors.accent, minHeight: 44 },
  shareButtonText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.bg },
  leaveButton: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radii.md, borderWidth: 1, borderColor: colors.sub, minHeight: 44 },
  leaveButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.sub },
  sectionTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg },
  countRow: { flexDirection: "row", justifyContent: "space-between", paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.surfaceRaised },
  countText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.sub },
  playerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.md },
  avatar: { width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  avatarImage: { width: "100%", height: "100%", borderRadius: radii.pill },
  avatarText: { fontFamily: fonts.display, fontSize: 15, color: colors.accent },
  playerName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  playerMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 1 },
  disabled: { opacity: 0.5 },
});
