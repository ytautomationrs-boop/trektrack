import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, TextInput, Linking, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { showAlert } from "../../lib/alert";
import { getProfileStats, getStravaStatus, disconnectStrava, getAppConfig, updateProfile } from "../../api/client";
import { getLeagueStandings, getLeagueHistory, lookUpRaceCode } from "../../api/raceClient";
import {
  acceptFriend,
  getFriends,
  getPlayerProfile,
  getConversation,
  getConversations,
  removeFriend,
  requestFriend,
  searchPlayers,
  sendMessage,
  type ConversationSummary,
  type DirectMessage,
  type FriendState,
  type FriendsPayload,
  type PlayerProfile,
  type PlayerSummary,
} from "../../api/socialClient";
import { connectStravaAccount } from "../../integrations/strava";
import { useAppState } from "../../state/useAppState";
import { formatMetricValue } from "../../utils/metricValue";
import type { ProfileStats, StravaStatus } from "../../api/types";
import type { LeagueStandings, MetricStanding, RaceHistoryEntry, RacePointEntry } from "../../api/raceTypes";
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
        <ProfileShortcuts />

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

function ProfileShortcuts() {
  const navigation = useNavigation<any>();
  return (
    <View style={styles.shortcutGrid}>
      <Pressable style={styles.shortcutCard} onPress={() => navigation.navigate("MyRaces")}>
        <Ionicons name="flag-outline" size={18} color={colors.accent} />
        <Text style={styles.shortcutTitle}>Your races</Text>
        <Text style={styles.shortcutSub}>Active and past competitions</Text>
      </Pressable>
      <Pressable style={styles.shortcutCard} onPress={() => navigation.navigate("Wallet")}>
        <Ionicons name="wallet-outline" size={18} color={colors.accent} />
        <Text style={styles.shortcutTitle}>Wallet</Text>
        <Text style={styles.shortcutSub}>Balance and withdrawals</Text>
      </Pressable>
    </View>
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
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(app.session?.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(app.session?.avatarUrl ?? "");
  const [bio, setBio] = useState(app.session?.bio ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (displayName.trim().length < 2) {
      showAlert("Profile", "Your display name needs at least 2 characters.");
      return;
    }
    setBusy(true);
    try {
      const { user } = await updateProfile({
        displayName: displayName.trim(),
        avatarUrl: avatarUrl.trim() || null,
        bio: bio.trim() || null,
      });
      app.setSession({
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
        bio: user.bio ?? null,
        isAdmin: user.isAdmin,
      });
      setEditing(false);
    } catch (err: any) {
      showAlert("Couldn't save profile", err.message ?? "Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.identityCard}>
      <View style={styles.avatar}>
        {app.session?.avatarUrl ? (
          <Image source={{ uri: app.session.avatarUrl }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarInitial}>{app.session?.displayName?.[0]?.toUpperCase() ?? "?"}</Text>
        )}
      </View>
      <Text style={styles.name}>{app.session?.displayName ?? "Guest"}</Text>
      {!!app.session?.email && <Text style={styles.email}>{app.session.email}</Text>}
      {!!app.session?.bio && <Text style={styles.bioText}>{app.session.bio}</Text>}
      <Pressable style={styles.editProfileButton} onPress={() => setEditing((value) => !value)}>
        <Ionicons name="create-outline" size={14} color={colors.bg} />
        <Text style={styles.editProfileText}>{editing ? "Close" : "Customize profile"}</Text>
      </Pressable>
      {editing && (
        <View style={styles.editProfilePanel}>
          <TextInput style={styles.codeInput} value={displayName} onChangeText={setDisplayName} placeholder="Display name" placeholderTextColor={colors.sub} />
          <TextInput
            style={styles.codeInput}
            value={avatarUrl}
            onChangeText={setAvatarUrl}
            placeholder="Avatar image URL"
            placeholderTextColor={colors.sub}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.codeInput, styles.bioInput]}
            value={bio}
            onChangeText={setBio}
            placeholder="Short bio"
            placeholderTextColor={colors.sub}
            multiline
            maxLength={160}
          />
          <Pressable style={[styles.wideFriendButton, busy && styles.disabled]} disabled={busy} onPress={save}>
            {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.friendButtonText}>Save profile</Text>}
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function SocialSection() {
  const [friends, setFriends] = useState<FriendsPayload>({ friends: [], incoming: [], outgoing: [] });
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSummary[]>([]);
  const [selected, setSelected] = useState<PlayerProfile | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadFriends = useCallback(() => {
    getFriends().then(setFriends).catch(() => setFriends({ friends: [], incoming: [], outgoing: [] }));
    getConversations().then((r) => setConversations(r.conversations)).catch(() => setConversations([]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadFriends();
    }, [loadFriends])
  );

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setBusy("search");
    try {
      const data = await searchPlayers(q);
      setResults(data.players);
    } catch (err: any) {
      showAlert("Search failed", err.message ?? "Try again.");
    } finally {
      setBusy(null);
    }
  };

  const openPlayer = async (playerId: string) => {
    setBusy(`open:${playerId}`);
    try {
      const profile = await getPlayerProfile(playerId);
      setSelected(profile);
      if (profile.friendState === "friends") {
        const thread = await getConversation(playerId);
        setMessages(thread.messages);
      } else {
        setMessages([]);
      }
    } catch (err: any) {
      showAlert("Couldn't load player", err.message ?? "Try again.");
    } finally {
      setBusy(null);
    }
  };

  const refreshSelected = async (playerId: string) => {
    getPlayerProfile(playerId)
      .then(async (profile) => {
        setSelected(profile);
        if (profile.friendState === "friends") {
          const thread = await getConversation(playerId);
          setMessages(thread.messages);
        }
      })
      .catch(() => {});
  };

  const act = async (player: PlayerSummary, action: "request" | "accept" | "remove") => {
    setBusy(`${action}:${player.id}`);
    try {
      let nextState: FriendState = "none";
      if (action === "request") nextState = (await requestFriend(player.id)).friendState;
      if (action === "accept") nextState = (await acceptFriend(player.id)).friendState;
      if (action === "remove") nextState = (await removeFriend(player.id)).friendState;
      loadFriends();
      setResults((items) =>
        items.map((item) =>
          item.id === player.id
            ? { ...item, friendState: nextState }
            : item
        )
      );
      if (selected?.player.id === player.id) {
        setSelected((current) =>
          current?.player.id === player.id
            ? { ...current, friendState: nextState, player: { ...current.player, friendState: nextState } }
            : current
        );
        if (nextState === "friends") {
          const thread = await getConversation(player.id);
          setMessages(thread.messages);
        } else {
          setMessages([]);
        }
        await refreshSelected(player.id);
      }
      getConversations().then((r) => setConversations(r.conversations)).catch(() => {});
    } catch (err: any) {
      showAlert("Social", err.message ?? "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const sendSelectedMessage = async () => {
    if (!selected || messageText.trim().length === 0) return;
    setBusy(`message:${selected.player.id}`);
    try {
      const result = await sendMessage(selected.player.id, messageText.trim());
      setMessages((items) => [...items, result.message]);
      setMessageText("");
      getConversations().then((r) => setConversations(r.conversations)).catch(() => {});
    } catch (err: any) {
      showAlert("Message failed", err.message ?? "Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Messages</Text>
        {conversations.length === 0 ? (
          <Text style={styles.cardBody}>Follow someone back and forth to start messaging.</Text>
        ) : (
          conversations.map((conversation) => (
            <Pressable key={conversation.player.id} style={styles.conversationRow} onPress={() => openPlayer(conversation.player.id)}>
              <View style={styles.playerAvatar}>
                <PlayerAvatar player={conversation.player} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName}>{conversation.player.displayName}</Text>
                <Text style={styles.playerSub} numberOfLines={1}>
                  {conversation.lastMessage.isMine ? "You: " : ""}
                  {conversation.lastMessage.body}
                </Text>
              </View>
              {conversation.unreadCount > 0 && (
                <View style={styles.unreadPill}>
                  <Text style={styles.unreadText}>{conversation.unreadCount}</Text>
                </View>
              )}
            </Pressable>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Search players</Text>
        <View style={styles.codeRow}>
          <TextInput
            style={styles.codeInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Name or email"
            placeholderTextColor={colors.sub}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={runSearch}
          />
          <Pressable style={[styles.codeGo, (query.trim().length < 2 || busy === "search") && styles.disabled]} disabled={query.trim().length < 2 || busy === "search"} onPress={runSearch}>
            {busy === "search" ? <ActivityIndicator color={colors.bg} /> : <Ionicons name="search" size={18} color={colors.bg} />}
          </Pressable>
        </View>
        {results.map((player) => (
          <PlayerRow
            key={player.id}
            player={player}
            busy={busy}
            onOpen={() => openPlayer(player.id)}
            onRequest={() => act(player, "request")}
            onAccept={() => act(player, "accept")}
            onRemove={() => act(player, "remove")}
          />
        ))}
      </View>

      {friends.incoming.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Follow requests</Text>
          {friends.incoming.map((player) => (
            <PlayerRow
              key={player.id}
              player={{ ...player, friendState: "pending_received" }}
              busy={busy}
              onOpen={() => openPlayer(player.id)}
              onRequest={() => act(player, "request")}
              onAccept={() => act(player, "accept")}
              onRemove={() => act(player, "remove")}
            />
          ))}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Following</Text>
        {friends.friends.length === 0 ? (
          <Text style={styles.cardBody}>Search for players to follow your first people.</Text>
        ) : (
          friends.friends.map((player) => (
            <PlayerRow
              key={player.id}
              player={{ ...player, friendState: "friends" }}
              busy={busy}
              onOpen={() => openPlayer(player.id)}
              onRequest={() => act(player, "request")}
              onAccept={() => act(player, "accept")}
              onRemove={() => act(player, "remove")}
            />
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Followers</Text>
        {friends.friends.length === 0 ? (
          <Text style={styles.cardBody}>Players who follow you back will show here.</Text>
        ) : (
          friends.friends.map((player) => (
            <PlayerRow
              key={player.id}
              player={{ ...player, friendState: "friends" }}
              busy={busy}
              onOpen={() => openPlayer(player.id)}
              onRequest={() => act(player, "request")}
              onAccept={() => act(player, "accept")}
              onRemove={() => act(player, "remove")}
            />
          ))
        )}
      </View>

      {selected && (
        <PlayerProfileCard
          profile={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onRequest={() => act(selected.player, "request")}
          onAccept={() => act(selected.player, "accept")}
          onRemove={() => act(selected.player, "remove")}
          messages={messages}
          messageText={messageText}
          onMessageTextChange={setMessageText}
          onSendMessage={sendSelectedMessage}
        />
      )}
    </>
  );
}

function PlayerRow({
  player,
  busy,
  onOpen,
  onRequest,
  onAccept,
  onRemove,
}: {
  player: PlayerSummary;
  busy: string | null;
  onOpen: () => void;
  onRequest: () => void;
  onAccept: () => void;
  onRemove: () => void;
}) {
  const actionBusy = busy?.endsWith(`:${player.id}`) ?? false;
  const state = player.friendState ?? "none";
  const action =
    state === "pending_received"
      ? { label: "Follow back", onPress: onAccept }
      : state === "friends"
        ? { label: "Unfollow", onPress: onRemove }
        : state === "pending_sent"
          ? { label: "Sent", onPress: undefined }
          : { label: "Follow", onPress: onRequest };

  return (
    <View style={styles.playerRow}>
      <Pressable style={styles.playerMain} onPress={onOpen}>
        <View style={styles.playerAvatar}>
          <PlayerAvatar player={player} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.playerName} numberOfLines={1}>{player.displayName}</Text>
          <Text style={styles.playerSub}>{state === "friends" ? "Following each other" : state === "pending_received" ? "Wants to follow you" : state === "pending_sent" ? "Follow request sent" : "View profile"}</Text>
        </View>
      </Pressable>
      <Pressable style={[styles.friendButton, (!action.onPress || actionBusy) && styles.disabled]} disabled={!action.onPress || actionBusy} onPress={action.onPress}>
        {actionBusy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.friendButtonText}>{action.label}</Text>}
      </Pressable>
    </View>
  );
}

function PlayerAvatar({ player }: { player: PlayerSummary }) {
  return player.avatarUrl ? (
    <Image source={{ uri: player.avatarUrl }} style={styles.playerAvatarImage} />
  ) : (
    <Text style={styles.playerInitial}>{player.displayName[0]?.toUpperCase() ?? "?"}</Text>
  );
}

function PlayerProfileCard({
  profile,
  busy,
  onClose,
  onRequest,
  onAccept,
  onRemove,
  messages,
  messageText,
  onMessageTextChange,
  onSendMessage,
}: {
  profile: PlayerProfile;
  busy: string | null;
  onClose: () => void;
  onRequest: () => void;
  onAccept: () => void;
  onRemove: () => void;
  messages: DirectMessage[];
  messageText: string;
  onMessageTextChange: (value: string) => void;
  onSendMessage: () => void;
}) {
  const state = profile.friendState;
  const actionBusy = busy?.endsWith(`:${profile.player.id}`) ?? false;
  const action =
    state === "pending_received"
      ? { label: "Follow back", onPress: onAccept }
      : state === "friends"
        ? { label: "Unfollow", onPress: onRemove }
        : state === "pending_sent"
          ? { label: "Request sent", onPress: undefined }
          : { label: "Follow", onPress: onRequest };

  return (
    <View style={styles.profileCard}>
      <View style={styles.profileCardHeader}>
        <View style={styles.playerAvatarLarge}>
          {profile.player.avatarUrl ? (
            <Image source={{ uri: profile.player.avatarUrl }} style={styles.playerAvatarLargeImage} />
          ) : (
            <Text style={styles.playerInitialLarge}>{profile.player.displayName[0]?.toUpperCase() ?? "?"}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileCardName}>{profile.player.displayName}</Text>
          <Text style={styles.cardBody}>{profile.player.bio ?? (state === "friends" ? "Following each other" : "Player profile")}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={20} color={colors.sub} />
        </Pressable>
      </View>

      <Pressable style={[styles.wideFriendButton, (!action.onPress || actionBusy) && styles.disabled]} disabled={!action.onPress || actionBusy} onPress={action.onPress}>
        {actionBusy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.friendButtonText}>{action.label}</Text>}
      </Pressable>

      {state === "friends" && (
        <>
          <Text style={styles.sectionTitle}>Messages</Text>
          <View style={styles.messageBox}>
            {messages.length === 0 ? (
              <Text style={styles.cardBody}>No messages yet.</Text>
            ) : (
              messages.slice(-12).map((message) => (
                <View key={message.id} style={[styles.messageBubble, message.isMine ? styles.messageMine : styles.messageTheirs]}>
                  <Text style={[styles.messageText, message.isMine && styles.messageMineText]}>{message.body}</Text>
                </View>
              ))
            )}
          </View>
          <View style={styles.messageComposer}>
            <TextInput
              style={styles.messageInput}
              value={messageText}
              onChangeText={onMessageTextChange}
              placeholder="Send a message"
              placeholderTextColor={colors.sub}
              maxLength={500}
              multiline
            />
            <Pressable
              style={[styles.messageSend, (!messageText.trim() || busy === `message:${profile.player.id}`) && styles.disabled]}
              disabled={!messageText.trim() || busy === `message:${profile.player.id}`}
              onPress={onSendMessage}
            >
              {busy === `message:${profile.player.id}` ? <ActivityIndicator color={colors.bg} /> : <Ionicons name="send" size={16} color={colors.bg} />}
            </Pressable>
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>Leagues</Text>
      <View style={styles.badgeGrid}>
        {profile.leagues.standings.map((standing) => (
          <LeagueBadge key={standing.metricKey} standing={standing} />
        ))}
      </View>

      <Text style={styles.sectionTitle}>Recent races</Text>
      {profile.raceHistory.length === 0 ? (
        <Text style={styles.cardBody}>No races yet.</Text>
      ) : (
        profile.raceHistory.slice(0, 8).map((entry) => <RaceHistoryRow key={entry.id} entry={entry} />)
      )}
    </View>
  );
}

function RaceHistoryRow({ entry }: { entry: RaceHistoryEntry }) {
  return (
    <View style={styles.historyRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.historyTitle} numberOfLines={1}>{entry.race.name}</Text>
        <Text style={styles.historySub}>
          {entry.race.metricKey} · {entry.race.league.name} · {entry.race.status.toLowerCase()}
        </Text>
      </View>
      <View style={styles.historyRight}>
        <Text style={styles.historyPosition}>{entry.finishPosition ? ordinal(entry.finishPosition) : "—"}</Text>
        <Text style={[styles.historyPoints, { color: (entry.pointsAwarded ?? 0) >= 0 ? colors.sage : colors.fail }]}>
          {entry.pointsAwarded != null && entry.pointsAwarded >= 0 ? "+" : ""}
          {entry.pointsAwarded ?? 0}
        </Text>
      </View>
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
  avatarImage: { width: "100%", height: "100%", borderRadius: radii.pill },
  name: { fontFamily: fonts.bodySemiBold, fontSize: 18, color: colors.text, marginTop: spacing.md },
  email: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginTop: 2 },
  bioText: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, textAlign: "center", lineHeight: 18, marginTop: spacing.sm },
  editProfileButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.accent2,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.lg,
  },
  editProfileText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.bg },
  editProfilePanel: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.lg },
  bioInput: { minHeight: 78, textAlignVertical: "top" },
  shortcutGrid: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  shortcutCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, gap: 4 },
  shortcutTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  shortcutSub: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, lineHeight: 16 },

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

  conversationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceRaised,
  },
  unreadPill: {
    minWidth: 24,
    height: 24,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  unreadText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.bg },

  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.md,
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceRaised,
  },
  playerMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  playerAvatar: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  playerInitial: { fontFamily: fonts.display, fontSize: 15, color: colors.accent },
  playerAvatarImage: { width: "100%", height: "100%", borderRadius: radii.pill },
  playerName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  playerSub: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 1 },
  friendButton: {
    minWidth: 76,
    minHeight: 34,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  friendButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.bg },

  profileCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, marginTop: spacing.lg },
  profileCardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  playerAvatarLarge: {
    width: 54,
    height: 54,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  playerInitialLarge: { fontFamily: fonts.display, fontSize: 22, color: colors.accent },
  playerAvatarLargeImage: { width: "100%", height: "100%", borderRadius: radii.pill },
  profileCardName: { fontFamily: fonts.display, fontSize: 20, color: colors.text },
  wideFriendButton: {
    minHeight: 42,
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  messageBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  messageBubble: {
    maxWidth: "86%",
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  messageMine: { alignSelf: "flex-end", backgroundColor: colors.accent },
  messageTheirs: { alignSelf: "flex-start", backgroundColor: colors.surface },
  messageText: { fontFamily: fonts.body, fontSize: 13, color: colors.text, lineHeight: 18 },
  messageMineText: { color: colors.bg },
  messageComposer: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  messageInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 96,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 13,
    padding: spacing.md,
  },
  messageSend: {
    width: 46,
    borderRadius: radii.sm,
    backgroundColor: colors.accent2,
    alignItems: "center",
    justifyContent: "center",
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceRaised,
  },
  historyTitle: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.text },
  historySub: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 1, textTransform: "capitalize" },
  historyRight: { alignItems: "flex-end", minWidth: 54 },
  historyPosition: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.text },
  historyPoints: { fontFamily: fonts.bodySemiBold, fontSize: 12, marginTop: 1 },

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
