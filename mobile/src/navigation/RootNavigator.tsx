import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Modal, Pressable, StyleSheet, Platform } from "react-native";
import { NavigationContainer, getPathFromState, DefaultTheme, useNavigationContainerRef } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, fonts, radii, spacing } from "../theme/tokens";
import { CreateGateScreen } from "../screens/create/CreateGateScreen";
import { WalletScreen } from "../screens/wallet/WalletScreen";
import { ProfileScreen } from "../screens/profile/ProfileScreen";
import { SocialScreen } from "../screens/social/SocialScreen";
import { RacesScreen } from "../screens/races/RacesScreen";
import { LeaguesScreen } from "../screens/races/LeaguesScreen";
import { RaceDetailScreen } from "../screens/races/RaceDetailScreen";
import { MyRacesScreen } from "../screens/races/MyRacesScreen";
import { EventsScreen, CreateEventScreen } from "../screens/events/EventsScreen";
import { EventDetailScreen } from "../screens/events/EventDetailScreen";
import { AdminScreen } from "../screens/admin/AdminScreen";
import { useAppState } from "../state/useAppState";
import { NotificationsScreen } from "../screens/notifications/NotificationsScreen";
import { getNotifications, openNotification } from "../api/notificationClient";
import { AstaLogo } from "../components/AstaLogo";

const Tab = createBottomTabNavigator();
const RaceStack = createNativeStackNavigator();
const EventsStack = createNativeStackNavigator();
const ProfileStack = createNativeStackNavigator();

/**
 * Launch shell.
 *
 * The public launch product is fixed-prize competitions only. The pooled
 * challenge code remains in the repository for now, but it is not exposed in
 * navigation because that model may carry gambling/compliance risk.
 */
function RacesStackScreen() {
  return (
    <RaceStack.Navigator screenOptions={{ headerShown: false }}>
      <RaceStack.Screen name="RacesList" component={RacesScreen} />
      <RaceStack.Screen name="Leagues" component={LeaguesScreen} />
      <RaceStack.Screen name="RaceDetail" component={RaceDetailScreen} />
    </RaceStack.Navigator>
  );
}

function EventsStackScreen() {
  return (
    <EventsStack.Navigator screenOptions={{ headerShown: false }}>
      <EventsStack.Screen name="EventsHome" component={EventsScreen} />
      <EventsStack.Screen name="CreateEvent" component={CreateEventScreen} />
      <EventsStack.Screen name="EventDetail" component={EventDetailScreen} />
    </EventsStack.Navigator>
  );
}

/**
 * Profile gets a stack so the admin console can push over it and back out
 * with a normal goBack, rather than being a hidden tab you leave sideways.
 *
 * Admin is only REGISTERED for an admin session — not merely hidden — so
 * there is no route to reach by name, deep link or otherwise on an ordinary
 * account. That is still only the client's half: every admin endpoint
 * enforces the same thing server-side, which is the half that counts.
 */
function ProfileStackScreen() {
  const app = useAppState();
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileHome" component={ProfileScreen} />
      <ProfileStack.Screen name="MyRaces" component={MyRacesScreen} />
      <ProfileStack.Screen name="Wallet" component={WalletScreen} />
      <ProfileStack.Screen name="RaceDetail" component={RaceDetailScreen} />
      {app.session?.isAdmin ? <ProfileStack.Screen name="Admin" component={AdminScreen} /> : null}
    </ProfileStack.Navigator>
  );
}

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.surface, text: colors.text, border: colors.surfaceRaised, primary: colors.accent },
};

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Competitions: "trophy-outline",
  Social: "people-outline",
  Events: "calendar-outline",
  Profile: "person-outline",
};

function withoutPreviews(state: any): any {
  return {...state,routes:state.routes.map((route:any)=>({...route,params:route.params ? Object.fromEntries(Object.entries(route.params).filter(([key])=>key!=="preview")) : undefined,state:route.state ? withoutPreviews(route.state) : undefined}))};
}
const linking = {
  getPathFromState: (state:any,options:any)=>getPathFromState(withoutPreviews(state),options),
  prefixes: [],
  config: {
    screens: {
      Competitions: {
        screens: {
          RacesList: "competitions",
          Leagues: "leagues",
        },
      },
      Races: {
        screens: {
          RaceDetail: "race/:raceId",
        },
      },
      Events: {
        screens: {
          EventsHome: "events",
          EventDetail: "event/:eventId",
        },
      },
    },
  },
} as any;

// The centre action opens a small chooser; selecting an option keeps the
// existing competition and social-game creation flows.
function CreateTabButton({ onCompetition, onSocialGame }: { onCompetition: () => void; onSocialGame: () => void }) {
  const [chooserVisible, setChooserVisible] = useState(false);
  const choose = (action: () => void) => {
    setChooserVisible(false);
    action();
  };

  return (
    <>
      <Pressable
        onPress={() => setChooserVisible(true)}
        style={styles.createButtonWrap}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Create"
      >
        <View style={styles.createButtonCircle}>
          <Ionicons name="add" size={30} color={colors.onAccent} />
        </View>
      </Pressable>
      <Modal visible={chooserVisible} transparent animationType="fade" onRequestClose={() => setChooserVisible(false)}>
        <View style={styles.chooserOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setChooserVisible(false)} accessibilityLabel="Dismiss create menu" />
          <View style={styles.chooserCard} accessibilityViewIsModal>
            <View style={styles.chooserHeading}>
              <Text style={styles.chooserTitle}>Create</Text>
              <Pressable style={styles.closeChooser} onPress={() => setChooserVisible(false)} accessibilityRole="button" accessibilityLabel="Close create menu">
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <Text style={styles.chooserDescription}>What would you like to organise?</Text>
            <View style={styles.chooserOptions}>
              <Pressable style={({ pressed }) => [styles.chooserOption, pressed && styles.optionPressed]} onPress={() => choose(onCompetition)} accessibilityRole="button" accessibilityLabel="Create competition">
                <Ionicons name="trophy-outline" size={30} color={colors.onAccent} />
                <Text style={styles.chooserOptionTitle}>Competition</Text>
                <Text style={styles.chooserOptionDetail}>Race for a prize</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.chooserOption, pressed && styles.optionPressed]} onPress={() => choose(onSocialGame)} accessibilityRole="button" accessibilityLabel="Create social game">
                <Ionicons name="people-outline" size={30} color={colors.onAccent} />
                <Text style={styles.chooserOptionTitle}>Social game</Text>
                <Text style={styles.chooserOptionDetail}>Play together</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function AppHeader({ canGoBack, onBack, onNotifications, unread }: { canGoBack: boolean; onBack: () => void; onNotifications: () => void; unread: number }) {
  const insets = useSafeAreaInsets();
  const capacitorTop = Platform.OS === "web" && typeof window !== "undefined" && window.location.protocol === "capacitor:" ? 47 : 0;
  const topInset = Math.max(insets.top, capacitorTop);
  return (
    <View style={[styles.appHeader, { paddingTop: topInset + 4 }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerSide}>
          {canGoBack ? (
            <Pressable style={styles.backButton} onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={28} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
        <AstaLogo width={86} height={44} backgroundColor={colors.bg} />
        <Pressable accessibilityRole="button" accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'} style={styles.backButton} onPress={onNotifications}>
          <Ionicons name="notifications-outline" size={23} color={colors.text}/>
          {unread>0?<View style={{position:'absolute',right:5,top:4,width:8,height:8,borderRadius:4,backgroundColor:colors.accent}}/>:null}
        </Pressable>
      </View>
    </View>
  );
}

export function RootNavigator() {
  const navigationRef = useNavigationContainerRef();
  const [canGoBack, setCanGoBack] = useState(false);
  const [unread,setUnread]=useState(0);
  useEffect(()=>{
    const refresh=()=>{if(typeof document!=='undefined' && document.hidden)return;void getNotifications().then(r=>setUnread(r.unreadCount)).catch(()=>{});};
    const first=setTimeout(refresh,4500),timer=setInterval(refresh,30000);
    const open=(event:any)=>{if(navigationRef.isReady())openNotification(navigationRef,event.detail??{});};
    if(typeof window!=='undefined'){window.addEventListener('asta-notifications',refresh);window.addEventListener('asta-open-notification',open);}
    return()=>{clearTimeout(first);clearInterval(timer);if(typeof window!=='undefined'){window.removeEventListener('asta-notifications',refresh);window.removeEventListener('asta-open-notification',open);}};
  },[navigationRef]);
  const updateBackState = useCallback(() => {
    setCanGoBack(navigationRef.isReady() && navigationRef.canGoBack());
  }, [navigationRef]);
  const goBack = useCallback(() => {
    if (navigationRef.isReady() && navigationRef.canGoBack()) navigationRef.goBack();
  }, [navigationRef]);
  const insets = useSafeAreaInsets();
  const capacitorBottom = Platform.OS === "web" && typeof window !== "undefined" && window.location.protocol === "capacitor:" ? 34 : 0;
  const bottomInset = Math.max(insets.bottom, capacitorBottom);
  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking} onReady={updateBackState} onStateChange={updateBackState}>
      <Tab.Navigator
        backBehavior="history"
        screenOptions={({ route }) => ({
          tabBarHideOnKeyboard: true,
          headerShown: true,
          header: () => <AppHeader canGoBack={canGoBack} onBack={goBack} unread={unread} onNotifications={() => (navigationRef as any).navigate("Notifications")} />,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.surfaceRaised,
            height: 68 + bottomInset,
            paddingBottom: Math.max(bottomInset, 12),
            paddingTop: 8,
            paddingHorizontal: 10,
          },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.sub,
          tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 11 },
          tabBarIcon: ({ color, size }) => <Ionicons name={TAB_ICONS[route.name]} size={size} color={color} />,
        })}
      >
        {/* The race/league browse screen — what used to be "Discover". */}
        <Tab.Screen name="Competitions" component={RacesStackScreen} />
        <Tab.Screen name="Social" component={SocialScreen} />
        {/* Hidden from the bar: a stable target for navigating into the race
            stack by name from Profile or Create. */}
        <Tab.Screen
          name="Races"
          component={RacesStackScreen}
          options={{ tabBarButton: () => null, tabBarItemStyle: { display: "none" } }}
        />
        <Tab.Screen
          name="Create"
          component={CreateGateScreen}
          options={({ navigation }) => ({
            tabBarLabel: () => null,
            tabBarButton: () => (
              <CreateTabButton
                onCompetition={() => navigation.navigate("Create")}
                onSocialGame={() => navigation.navigate("Events", { screen: "CreateEvent", initial: false })}
              />
            ),
          })}
        />
        <Tab.Screen name="Events" component={EventsStackScreen} />
        <Tab.Screen name="Profile" component={ProfileStackScreen} />
        <Tab.Screen name="Notifications" component={NotificationsScreen} options={{tabBarButton:()=>null,tabBarItemStyle:{display:"none"}}}/>
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  appHeader: {
    minHeight: 72,
    justifyContent: "flex-end",
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceRaised,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerSide: { width: 44, height: 44 },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  chooserOverlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.glass },
  chooserCard: { width: "100%", maxWidth: 420, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.xl },
  chooserHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chooserTitle: { fontFamily: fonts.display, color: colors.text, fontSize: 28 },
  closeChooser: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.surfaceRaised },
  chooserDescription: { fontFamily: fonts.body, color: colors.sub, fontSize: 14, lineHeight: 20, marginTop: spacing.sm, marginBottom: spacing.xl },
  chooserOptions: { flexDirection: "row", gap: spacing.md },
  chooserOption: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", paddingVertical: spacing.xl, paddingHorizontal: spacing.sm, gap: spacing.sm, backgroundColor: colors.accent, borderRadius: radii.md },
  chooserOptionTitle: { fontFamily: fonts.bodyBold, color: colors.onAccent, fontSize: 14, textAlign: "center" },
  chooserOptionDetail: { fontFamily: fonts.body, color: colors.onAccent, fontSize: 11, textAlign: "center" },
  optionPressed: { opacity: 0.8 },
  createButtonWrap: { flex: 1, alignItems: "center", justifyContent: "flex-start" },
  createButtonCircle: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -22, // raises it above the bar
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 6 },
    }),
  },
});
