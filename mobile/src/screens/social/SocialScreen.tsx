import { PageMotion } from "../../components/PageMotion";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import Ionicons from "@expo/vector-icons/Ionicons";
import { pickPhoto } from "../../lib/photos";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { showAlert } from "../../lib/alert";
import { useAppState } from "../../state/useAppState";
import {
  commentOnSocialPost,
  createSocialPost,
  getConversation,
  getConversations,
  getFriends,
  getPlayerProfile,
  getPostableResults,
  getSocialFeed,
  getSocialPost,
  likeSocialPost,
  removeFriend,
  requestFriend,
  searchPlayers,
  sendMessage,
  shareSocialPost,
  unlikeSocialPost,
  type ConversationSummary,
  type DirectMessage,
  type FriendState,
  type FriendsPayload,
  type PlayerProfile,
  type PlayerSummary,
  type SocialPost,
  type SocialRaceResult,
} from "../../api/socialClient";

const Stack = createNativeStackNavigator();

function formatCents(cents: number) {
  return `${cents < 0 ? "-" : ""}R${Math.abs(cents / 100).toLocaleString()}`;
}

function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function friendAction(state: FriendState | undefined) {
  if (state === "friends") return { label: "Following", action: "remove" as const };
  if (state === "pending_sent") return { label: "Requested", action: null };
  if (state === "pending_received") return { label: "Follow back", action: "request" as const };
  return { label: "Follow", action: "request" as const };
}

export function SocialScreen() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SocialFeed" component={SocialFeedScreen} />
      <Stack.Screen name="SocialMessages" component={MessagesScreen} />
      <Stack.Screen name="SocialThread" component={ThreadScreen} />
      <Stack.Screen name="SocialPost" component={SinglePostScreen} />
      <Stack.Screen name="SocialProfile" component={SocialProfileScreen} />
    </Stack.Navigator>
  );
}

function SocialFeedScreen() {
  const navigation = useNavigation<any>();
  const app = useAppState();
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const hasLoaded = useRef(false);
  const [friends, setFriends] = useState<FriendsPayload>({ friends: [], incoming: [], outgoing: [] });
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [results, setResults] = useState<SocialRaceResult[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlayerSummary[]>([]);
  const [postText, setPostText] = useState("");
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [postImage, setPostImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);

  const unreadCount = conversations.reduce((sum, item) => sum + item.unreadCount, 0);

  const updatePost = useCallback((nextPost: SocialPost) => {
    setPosts((items) => items.map((item) => (item.id === nextPost.id ? nextPost : item)));
  }, []);

  const load = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true);
    setLoadWarning(null);

    const noteFailure = (err: unknown) => {
      const message = err instanceof Error ? err.message : "Some social data could not load.";
      setLoadWarning((current) => current ?? message);
    };

    void getFriends()
      .then((result) => setFriends(result))
      .catch(noteFailure);
    void getConversations()
      .then((result) => setConversations(result.conversations))
      .catch(noteFailure);
    void getPostableResults()
      .then((result) => setResults(result.results))
      .catch(noteFailure);

    try {
      const feed = await getSocialFeed({ onCached: (saved) => { setPosts(saved.posts); hasLoaded.current = true; } });
      hasLoaded.current = true;
      setPosts(feed.posts);
    } catch (err) {
      noteFailure(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setBusy("search");
    try {
      const data = await searchPlayers(q);
      setSearchResults(data.players);
    } catch (err: any) {
      showAlert("Search failed", err.message ?? "Try again.");
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    const body = postText.trim() || (postImage ? "Shared a photo" : "");
    if (!body) return showAlert("Post", "Write something or choose a photo before posting.");
    setBusy("post");
    try {
      const result = await createSocialPost({ body, raceEntryId: selectedResultId, imageUrl: postImage });
      setPosts((items) => [result.post, ...items]);
      setPostText("");
      setSelectedResultId(null);
      setPostImage(null);
    } catch (err: any) {
      showAlert("Couldn't post", err.message ?? "Try again.");
    } finally {
      setBusy(null);
    }
  };

  const choosePostPhoto = async () => {
    try { const photo = await pickPhoto("post"); if (photo) setPostImage(photo); }
    catch (err: any) { showAlert("Photo", err.message ?? "Could not open photos."); }
  };

  return (
    <PageMotion><SafeAreaView style={styles.screen} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.feedContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <View style={styles.instaHeader}>
          <Text style={styles.feedTitle}>Social</Text>
          <Pressable style={styles.iconButton} onPress={() => navigation.navigate("SocialMessages")}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.text} />
            {unreadCount > 0 && (
              <View style={styles.badgeDot}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyRow}>
          <Pressable style={styles.story} onPress={() => navigation.navigate("Profile", { screen: "ProfileHome" })}>
            <Avatar player={app.session ?? null} size={58} />
            <Text style={styles.storyText} numberOfLines={1}>You</Text>
          </Pressable>
          {friends.friends.map((player) => (
            <Pressable key={player.id} style={styles.story} onPress={() => navigation.navigate("SocialProfile", { playerId: player.id })}>
              <Avatar player={player} size={58} />
              <Text style={styles.storyText} numberOfLines={1}>{player.displayName}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={17} color={colors.sub} />
          <TextInput keyboardAppearance="dark"
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            placeholder="Search players"
            placeholderTextColor={colors.sub}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={[styles.searchGo, (query.trim().length < 2 || busy === "search") && styles.disabled]} disabled={query.trim().length < 2 || busy === "search"} onPress={runSearch}>
            {busy === "search" ? <ActivityIndicator color={colors.bg} /> : <Ionicons name="arrow-forward" size={16} color={colors.bg} />}
          </Pressable>
        </View>

        {searchResults.map((player) => (
          <PlayerListRow
            key={player.id}
            player={player}
            onOpen={() => navigation.navigate("SocialProfile", { playerId: player.id })}
            onFriendStateChange={(friendState) => {
              setSearchResults((items) => items.map((item) => (item.id === player.id ? { ...item, friendState } : item)));
              load();
            }}
          />
        ))}

        {loadWarning ? (
          <View style={styles.warningCard}>
            <Ionicons name="warning-outline" size={16} color={colors.risk} />
            <Text style={styles.warningText}>{loadWarning}</Text>
          </View>
        ) : null}

        <View style={styles.composer}>
          <View style={styles.composerHead}>
            <Avatar player={app.session ?? null} size={38} />
            <TextInput keyboardAppearance="dark"
              style={styles.composerInput}
              value={postText}
              onChangeText={setPostText}
              placeholder="Share a result or update"
              placeholderTextColor={colors.sub}
              multiline
              maxLength={500}
            />
          </View>
          {results.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resultRow}>
              {results.slice(0, 8).map((result) => (
                <Pressable key={result.id} style={[styles.resultChip, selectedResultId === result.id && styles.resultChipActive]} onPress={() => setSelectedResultId((value) => (value === result.id ? null : result.id))}>
                  <Ionicons name="trophy-outline" size={13} color={selectedResultId === result.id ? colors.bg : colors.accent} />
                  <Text style={[styles.resultChipText, selectedResultId === result.id && styles.resultChipTextActive]} numberOfLines={1}>
                    {result.race.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {postImage ? (
            <View style={styles.postImagePreviewWrap}>
              <Image source={{ uri: postImage }} style={styles.postImagePreview} />
              <Pressable style={styles.removePhoto} onPress={() => setPostImage(null)}>
                <Ionicons name="close" size={18} color={colors.text} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.composerActions}>
            <Pressable style={styles.photoButton} onPress={choosePostPhoto}>
              <Ionicons name="image-outline" size={19} color={colors.accent} />
              <Text style={styles.photoButtonText}>Photo</Text>
            </Pressable>
          <Pressable style={[styles.postButton, ((!postText.trim() && !postImage) || busy === "post") && styles.disabled]} disabled={(!postText.trim() && !postImage) || busy === "post"} onPress={publish}>
            {busy === "post" ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.postButtonText}>Post</Text>}
          </Pressable>
          </View>
        </View>

        {loading && posts.length === 0 ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} /> : null}
        {!loading && posts.length === 0 ? (
          <View style={styles.emptyFeed}>
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptyText}>Post your latest result or follow players to build your feed.</Text>
          </View>
        ) : null}
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            friends={friends.friends}
            onChange={updatePost}
            onOpenProfile={() => navigation.navigate("SocialProfile", { playerId: post.author.id })}
          />
        ))}
      </ScrollView>
    </SafeAreaView></PageMotion>
  );
}

function SinglePostScreen() {
  const route=useRoute<any>();const navigation=useNavigation<any>();const [post,setPost]=useState<SocialPost|null>(null);const [error,setError]=useState('');
  useFocusEffect(useCallback(()=>{let active=true;void getSocialPost(route.params.postId).then(r=>{if(active)setPost(r.post);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[route.params.postId]));
  return <PageMotion><ScrollView style={styles.screen} contentContainerStyle={styles.feedContent}><Text style={styles.pageTitle}>POST</Text>{error?<Text style={styles.postBody}>{error}</Text>:post?<PostCard post={post} friends={[]} onChange={setPost} onOpenProfile={()=>navigation.navigate('SocialProfile',{playerId:post.author.id})}/>:<ActivityIndicator color={colors.accent}/>}</ScrollView></PageMotion>;
}

function MessagesScreen() {
  const navigation = useNavigation<any>();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getConversations({onCached:r=>{setConversations(r.conversations);setLoading(false);}});
      setConversations(result.conversations);
    } catch (err: any) {
      showAlert("Messages", err.message ?? "Couldn't load messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      const poll=setInterval(()=>{if(typeof document==='undefined'||!document.hidden)void load();},10000);
      return()=>clearInterval(poll);
    }, [load])
  );

  return (
    <PageMotion><SafeAreaView style={styles.screen} edges={[]}>
      <View style={styles.pageHeader}>
        <View style={styles.headerSpacer} />
        <Text style={styles.pageTitle}>Messages</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.feedContent}>
        {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} /> : null}
        {!loading && conversations.length === 0 ? (
          <View style={styles.emptyFeed}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyText}>Open a player profile and message someone you follow back and forth.</Text>
          </View>
        ) : null}
        {conversations.map((conversation) => (
          <Pressable
            key={conversation.player.id}
            style={styles.messageRow}
            onPress={() => navigation.navigate("SocialThread", { playerId: conversation.player.id, playerName: conversation.player.displayName })}
          >
            <Avatar player={conversation.player} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={styles.messageName}>{conversation.player.displayName}</Text>
              <Text style={styles.messagePreview} numberOfLines={1}>
                {conversation.lastMessage.isMine ? "You: " : ""}
                {conversation.lastMessage.body}
              </Text>
            </View>
            {conversation.unreadCount > 0 && <View style={styles.unreadDot} />}
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView></PageMotion>
  );
}

function ThreadScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const playerId: string = route.params?.playerId;
  const playerName: string = route.params?.playerName ?? "Player";
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const sendLock=useRef(false);
  const mergeMessages=(incoming:DirectMessage[])=>setMessages(current=>Array.from(new Map([...current,...incoming].map(m=>[m.id,m])).values()).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-100));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getConversation(playerId,{onCached:r=>{mergeMessages(r.messages);setLoading(false);}});
      mergeMessages(result.messages);
    } catch (err: any) {
      showAlert("Messages", err.message ?? "Couldn't load this thread.");
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const poll=setInterval(()=>{if(typeof document==='undefined'||!document.hidden)void load();},10000);
      return()=>clearInterval(poll);
    }, [load])
  );

  const send = async () => {
    const body = text.trim();
    if (!body || sendLock.current) return;
    sendLock.current=true;
    const temporaryId=`pending-${Date.now()}`;
    setMessages(items=>[...items,{id:temporaryId,senderId:"me",recipientId:playerId,body,createdAt:new Date().toISOString(),readAt:null,isMine:true}]);
    setText("");
    setBusy(true);
    try {
      const result = await sendMessage(playerId, body);
      setMessages((items) => [...items.filter(m=>m.id!==temporaryId&&m.id!==result.message.id), result.message]);
    } catch (err: any) {
      setMessages(items=>items.filter(m=>m.id!==temporaryId));
      setText(current=>current || body);
      showAlert("Message failed", err.message ?? "Try again.");
    } finally {
      sendLock.current=false;
      setBusy(false);
    }
  };

  return (
    <PageMotion><SafeAreaView style={styles.screen} edges={[]}>
      <View style={styles.pageHeader}>
        <View style={styles.headerSpacer} />
        <Text style={styles.pageTitle}>{playerName}</Text>
        <Pressable onPress={() => navigation.navigate("SocialProfile", { playerId })} hitSlop={8}>
          <Ionicons name="person-circle-outline" size={23} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.threadContent}>
        {loading && !messages.length ? <ActivityIndicator color={colors.accent} /> : null}
        {messages.map((message) => (
          <View key={message.id} style={[styles.threadBubble, message.isMine ? styles.threadMine : styles.threadTheirs]}>
            <Text style={[styles.threadText, message.isMine && styles.threadMineText]}>{message.body}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.threadComposer}>
        <TextInput keyboardAppearance="dark" style={styles.threadInput} value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={colors.sub} multiline maxLength={500} />
        <Pressable style={[styles.threadSend, (!text.trim() || busy) && styles.disabled]} disabled={!text.trim() || busy} onPress={send}>
          {busy ? <ActivityIndicator color={colors.bg} /> : <Ionicons name="send" size={16} color={colors.bg} />}
        </Pressable>
      </View>
    </SafeAreaView></PageMotion>
  );
}

function SocialProfileScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const playerId: string = route.params?.playerId;
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProfile(await getPlayerProfile(playerId));
    } catch (err: any) {
      showAlert("Profile", err.message ?? "Couldn't load this profile.");
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const act = async () => {
    if (!profile) return;
    const next = friendAction(profile.friendState);
    if (!next.action) return;
    setBusy(true);
    try {
      const result = next.action === "remove" ? await removeFriend(profile.player.id) : await requestFriend(profile.player.id);
      setProfile((current) => current ? { ...current, friendState: result.friendState, player: { ...current.player, friendState: result.friendState } } : current);
    } catch (err: any) {
      showAlert("Social", err.message ?? "Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!profile) {
    return (
      <PageMotion><SafeAreaView style={styles.screen} edges={[]}>
        <View style={styles.pageHeader}>
          <View style={styles.headerSpacer} />
          <Text style={styles.pageTitle}>Profile</Text>
          <View style={styles.headerSpacer} />
        </View>
        {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} /> : null}
      </SafeAreaView></PageMotion>
    );
  }

  const action = friendAction(profile.friendState);
  const wins = profile.raceHistory.filter((entry) => entry.finishPosition === 1).length;
  const podiums = profile.raceHistory.filter((entry) => entry.finishPosition != null && entry.finishPosition <= 3).length;

  return (
    <PageMotion><SafeAreaView style={styles.screen} edges={[]}>
      <ScrollView contentContainerStyle={styles.feedContent}>
        <View style={styles.pageHeaderInline}>
          <View style={styles.headerSpacer} />
          <Text style={styles.pageTitle}>{profile.player.displayName}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.profileTop}>
          <Avatar player={profile.player} size={84} />
          <View style={styles.profileStats}>
            <StatMini label="Posts" value={String(profile.posts.length)} />
            <StatMini label="Races" value={String(profile.raceHistory.length)} />
            <StatMini label="Podiums" value={String(podiums)} />
            <StatMini label="Wins" value={String(wins)} />
          </View>
        </View>
        <Text style={styles.profileName}>{profile.player.displayName}</Text>
        {profile.player.bio ? <Text style={styles.profileBio}>{profile.player.bio}</Text> : null}
        <View style={styles.profileActions}>
          <Pressable style={[styles.followButton, (!action.action || busy) && styles.disabled]} disabled={!action.action || busy} onPress={act}>
            {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.followText}>{action.label}</Text>}
          </Pressable>
          {profile.friendState === "friends" && (
            <Pressable style={styles.messageButton} onPress={() => navigation.navigate("SocialThread", { playerId: profile.player.id, playerName: profile.player.displayName })}>
              <Text style={styles.messageButtonText}>Message</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.profileGrid}>
          {profile.posts.map((post) => (
            <View key={post.id} style={styles.gridPost}>
              <Ionicons name={post.raceResult ? "trophy-outline" : "chatbubble-outline"} size={18} color={colors.accent} />
              <Text style={styles.gridText} numberOfLines={3}>{post.raceResult ? post.raceResult.race.name : post.body}</Text>
            </View>
          ))}
          {profile.posts.length === 0 && <Text style={styles.emptyText}>No posts yet.</Text>}
        </View>
      </ScrollView>
    </SafeAreaView></PageMotion>
  );
}

function PostCard({
  post,
  friends,
  onChange,
  onOpenProfile,
}: {
  post: SocialPost;
  friends: PlayerSummary[];
  onChange: (post: SocialPost) => void;
  onOpenProfile: () => void;
}) {
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const toggleLike = async () => {
    if (busy) return;
    setBusy("like");
    try {
      const result = post.hasLiked ? await unlikeSocialPost(post.id) : await likeSocialPost(post.id);
      onChange(result.post);
    } catch (err: any) {
      showAlert("Like failed", err.message ?? "Try again.");
    } finally {
      setBusy(null);
    }
  };

  const submitComment = async () => {
    const body = commentText.trim();
    if (!body || busy) return;
    setBusy("comment");
    try {
      const result = await commentOnSocialPost(post.id, body);
      onChange(result.post);
      setCommentText("");
      setCommentOpen(false);
    } catch (err: any) {
      showAlert("Comment failed", err.message ?? "Try again.");
    } finally {
      setBusy(null);
    }
  };

  const shareTo = async (recipientId?: string | null) => {
    if (busy) return;
    setBusy("share");
    try {
      const result = await shareSocialPost(post.id, recipientId);
      onChange(result.post);
      showAlert(recipientId ? "Shared" : "Share saved", recipientId ? "The post was sent as a message." : "The post was shared on your profile.");
    } catch (err: any) {
      showAlert("Share failed", err.message ?? "Try again.");
    } finally {
      setBusy(null);
    }
  };

  const openShare = () => {
    const topFriends = friends.slice(0, 3);
    showAlert(
      "Share post",
      topFriends.length > 0 ? "Send it to a friend, or share it to your profile." : "Share it to your profile.",
      [
        ...topFriends.map((friend) => ({ text: friend.displayName, onPress: () => shareTo(friend.id) })),
        { text: "Share to profile", onPress: () => shareTo(null) },
        { text: "Cancel", style: "cancel" as const },
      ],
    );
  };

  return (
    <View style={styles.postCard}>
      <Pressable style={styles.postAuthor} onPress={onOpenProfile}>
        <Avatar player={post.author} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={styles.postName}>{post.author.displayName}</Text>
          <Text style={styles.postMeta}>{timeAgo(post.createdAt)}</Text>
        </View>
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.sub} />
      </Pressable>
      {post.raceResult && <ResultPanel result={post.raceResult} />}
      {post.eventResult ? <View style={{padding:14,backgroundColor:colors.surfaceRaised,borderRadius:12,gap:6}}><Text style={styles.messageName}>{post.eventResult.name}</Text><Text style={styles.postBody}>{post.eventResult.summary}</Text><Text style={styles.messagePreview}>{post.eventResult.sportName} · {Math.floor(post.eventResult.elapsedMs/60000)} minutes</Text></View> : null}
      {post.imageUrl ? <Image source={{ uri: post.imageUrl }} style={styles.postPhoto} resizeMode="cover" /> : null}
      <Text style={styles.postBody}>{post.body}</Text>
      <View style={styles.postActions}>
        <Pressable style={styles.postActionButton} onPress={toggleLike} disabled={busy === "like"}>
          <Ionicons name={post.hasLiked ? "heart" : "heart-outline"} size={22} color={post.hasLiked ? colors.accent : colors.text} />
          <Text style={styles.postActionText}>{post.likeCount}</Text>
        </Pressable>
        <Pressable style={styles.postActionButton} onPress={() => setCommentOpen((value) => !value)}>
          <Ionicons name="chatbubble-outline" size={20} color={colors.text} />
          <Text style={styles.postActionText}>{post.commentCount}</Text>
        </Pressable>
        <Pressable style={styles.postActionButton} onPress={openShare} disabled={busy === "share"}>
          <Ionicons name="paper-plane-outline" size={20} color={colors.text} />
          <Text style={styles.postActionText}>{post.shareCount}</Text>
        </Pressable>
      </View>
      {post.comments.length > 0 && (
        <View style={styles.commentList}>
          {post.comments.map((comment) => (
            <View key={comment.id} style={styles.commentRow}>
              <Text style={styles.commentAuthor}>{comment.author.displayName}</Text>
              <Text style={styles.commentBody}>{comment.body}</Text>
            </View>
          ))}
        </View>
      )}
      {commentOpen && (
        <View style={styles.commentComposer}>
          <TextInput keyboardAppearance="dark"
            style={styles.commentInput}
            value={commentText}
            onChangeText={setCommentText}
            placeholder="Add a comment"
            placeholderTextColor={colors.sub}
            maxLength={240}
          />
          <Pressable style={[styles.commentSend, (!commentText.trim() || busy === "comment") && styles.disabled]} disabled={!commentText.trim() || busy === "comment"} onPress={submitComment}>
            {busy === "comment" ? <ActivityIndicator color={colors.bg} /> : <Ionicons name="send" size={14} color={colors.bg} />}
          </Pressable>
        </View>
      )}
    </View>
  );
}

function ResultPanel({ result }: { result: SocialRaceResult }) {
  return (
    <View style={styles.resultPanel}>
      <View style={{ flex: 1 }}>
        <Text style={styles.resultTitle} numberOfLines={1}>{result.race.name}</Text>
        <Text style={styles.resultMeta}>{result.race.metricKey} · {result.race.league.name}</Text>
      </View>
      <View style={styles.resultScore}>
        <Text style={styles.resultPosition}>{result.finishPosition ? ordinal(result.finishPosition) : "Done"}</Text>
        <Text style={styles.resultPoints}>
          {result.pointsAwarded != null && result.pointsAwarded >= 0 ? "+" : ""}
          {result.pointsAwarded ?? 0} pts
        </Text>
        {result.prizeCents ? <Text style={styles.resultPrize}>{formatCents(result.prizeCents)}</Text> : null}
      </View>
    </View>
  );
}

function PlayerListRow({
  player,
  onOpen,
  onFriendStateChange,
}: {
  player: PlayerSummary;
  onOpen: () => void;
  onFriendStateChange: (state: FriendState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const action = friendAction(player.friendState);

  const toggleFollow = async (event: any) => {
    event?.stopPropagation?.();
    if (!action.action) return;
    setBusy(true);
    try {
      const result = action.action === "remove" ? await removeFriend(player.id) : await requestFriend(player.id);
      onFriendStateChange(result.friendState);
    } catch (err: any) {
      showAlert("Social", err.message ?? "Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable style={styles.messageRow} onPress={onOpen}>
      <Avatar player={player} size={42} />
      <View style={{ flex: 1 }}>
        <Text style={styles.messageName}>{player.displayName}</Text>
        <Text style={styles.messagePreview}>{player.bio ?? "View profile"}</Text>
      </View>
      <Pressable style={[styles.inlineFollow, (!action.action || busy) && styles.disabled]} disabled={!action.action || busy} onPress={toggleFollow}>
        {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.inlineFollowText}>{action.label}</Text>}
      </Pressable>
    </Pressable>
  );
}

function Avatar({ player, size }: { player: Pick<PlayerSummary, "displayName" | "avatarUrl"> | null; size: number }) {
  const initial = player?.displayName?.trim()?.[0]?.toUpperCase() ?? "T";
  return (
    <View style={[styles.avatarWrap, { width: size, height: size, borderRadius: size / 2 }]}>
      {player?.avatarUrl ? (
        <Image source={{ uri: player.avatarUrl }} style={{ width: "100%", height: "100%", borderRadius: size / 2 }} />
      ) : (
        <Text style={[styles.avatarInitial, { fontSize: Math.max(14, Math.round(size / 2.5)) }]}>{initial}</Text>
      )}
    </View>
  );
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statMini}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  feedContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  instaHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  feedTitle: { fontFamily: fonts.display, textTransform: "uppercase", fontSize: 24, color: colors.text },
  iconButton: { width: 42, height: 42, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  badgeDot: { position: "absolute", right: 5, top: 4, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 9, color: colors.bg },
  storyRow: { gap: spacing.md, paddingVertical: spacing.sm },
  story: { width: 68, alignItems: "center", gap: 5 },
  storyText: { maxWidth: 68, fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.sub },
  avatarWrap: { backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.accent },
  avatarInitial: { fontFamily: fonts.bodyBold, color: colors.accent },
  searchBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.sm },
  searchInput: { flex: 1, minHeight: 34, color: colors.text, fontFamily: fonts.body, fontSize: 14 },
  searchGo: { width: 32, height: 32, borderRadius: radii.sm, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  composer: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md, marginTop: spacing.lg, marginBottom: spacing.lg },
  composerHead: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  composerInput: { flex: 1, minHeight: 62, color: colors.text, fontFamily: fonts.body, fontSize: 16, lineHeight: 21 },
  composerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  photoButton: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.sm },
  photoButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.accent },
  postImagePreviewWrap: { position: "relative" },
  postImagePreview: { width: "100%", height: 220, borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
  removePhoto: { position: "absolute", right: spacing.sm, top: spacing.sm, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" },
  resultRow: { gap: spacing.sm },
  resultChip: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: 190, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  resultChipActive: { backgroundColor: colors.accent },
  resultChipText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.text },
  resultChipTextActive: { color: colors.bg },
  postButton: { alignSelf: "flex-end", minWidth: 90, borderRadius: radii.md, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  postButtonText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.bg },
  postCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md },
  postAuthor: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  postName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  postMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.sub },
  postBody: { fontFamily: fonts.body, fontSize: 14, color: colors.text, lineHeight: 20, marginTop: spacing.md },
  postPhoto: { width: "100%", height: 300, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, marginTop: spacing.md },
  postActions: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.md },
  postActionButton: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 32 },
  postActionText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.sub },
  commentList: { gap: spacing.sm, marginTop: spacing.md },
  commentRow: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.sm },
  commentAuthor: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.text },
  commentBody: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, lineHeight: 17, marginTop: 2 },
  commentComposer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  commentInput: { flex: 1, minHeight: 38, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, paddingHorizontal: spacing.md, color: colors.text, fontFamily: fonts.body, fontSize: 13 },
  commentSend: { width: 38, height: 38, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  resultPanel: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md },
  resultTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  resultMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: 2 },
  resultScore: { alignItems: "flex-end" },
  resultPosition: { fontFamily: fonts.display, textTransform: "uppercase", fontSize: 20, color: colors.accent },
  resultPoints: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.text },
  resultPrize: { fontFamily: fonts.body, fontSize: 10, color: colors.sub },
  pageHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.surfaceRaised },
  pageHeaderInline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  headerSpacer: { width: 22 },
  pageTitle: { fontFamily: fonts.display, textTransform: "uppercase", fontSize: 18, color: colors.text },
  messageRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.sm },
  messageName: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
  messagePreview: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 2 },
  inlineFollow: { minWidth: 94, minHeight: 32, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  inlineFollowText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.bg },
  warningCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.md },
  warningText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.sub, lineHeight: 17 },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent },
  threadContent: { flexGrow: 1, padding: spacing.lg, gap: spacing.sm },
  threadBubble: { maxWidth: "80%", borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  threadMine: { alignSelf: "flex-end", backgroundColor: colors.accent },
  threadTheirs: { alignSelf: "flex-start", backgroundColor: colors.surface },
  threadText: { fontFamily: fonts.body, fontSize: 14, color: colors.text, lineHeight: 19 },
  threadMineText: { color: colors.bg },
  threadComposer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.surfaceRaised, backgroundColor: colors.bg },
  threadInput: { flex: 1, maxHeight: 110, borderRadius: radii.lg, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontFamily: fonts.body, fontSize: 14 },
  threadSend: { width: 40, height: 40, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  profileTop: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  profileStats: { flex: 1, flexDirection: "row", justifyContent: "space-between" },
  statMini: { alignItems: "center", flex: 1 },
  statValue: { fontFamily: fonts.bodyBold, fontSize: 19, color: colors.text },
  statLabel: { fontFamily: fonts.body, fontSize: 10, color: colors.sub },
  profileName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text, marginTop: spacing.md },
  profileBio: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, lineHeight: 18, marginTop: 3 },
  profileActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  followButton: { flex: 1, borderRadius: radii.md, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", minHeight: 40 },
  followText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.bg },
  messageButton: { flex: 1, borderRadius: radii.md, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", minHeight: 40 },
  messageButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.text },
  profileGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xl },
  gridPost: { width: "31.5%", aspectRatio: 1, borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.sm, justifyContent: "space-between" },
  gridText: { fontFamily: fonts.bodySemiBold, fontSize: 11, color: colors.text, lineHeight: 14 },
  emptyFeed: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center" },
  emptyTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  emptyText: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, textAlign: "center", lineHeight: 17, marginTop: 4 },
  disabled: { opacity: 0.5 },
});
