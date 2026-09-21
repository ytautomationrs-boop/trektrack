import React from "react";
import { View, Pressable, StyleSheet, Platform } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radii } from "../theme/tokens";
import { CreateGateScreen } from "../screens/create/CreateGateScreen";
import { WalletScreen } from "../screens/wallet/WalletScreen";
import { ProfileScreen } from "../screens/profile/ProfileScreen";
import { SocialScreen } from "../screens/social/SocialScreen";
import { RacesScreen } from "../screens/races/RacesScreen";
import { RaceDetailScreen } from "../screens/races/RaceDetailScreen";
import { MyRacesScreen } from "../screens/races/MyRacesScreen";
import { EventsScreen } from "../screens/events/EventsScreen";
import { EventDetailScreen } from "../screens/events/EventDetailScreen";
import { AdminScreen } from "../screens/admin/AdminScreen";
import { useAppState } from "../state/useAppState";

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
      <RaceStack.Screen name="RaceDetail" component={RaceDetailScreen} />
    </RaceStack.Navigator>
  );
}

function EventsStackScreen() {
  return (
    <EventsStack.Navigator screenOptions={{ headerShown: false }}>
      <EventsStack.Screen name="EventsHome" component={EventsScreen} />
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

const linking = {
  prefixes: [],
  config: {
    screens: {
      Competitions: {
        screens: {
          RacesList: "competitions",
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

// Center "Create" tab — a raised circular button that sits above the bar
// rather than blending in as a fifth equal-weight icon, per spec ("center,
// prominent"). react-navigation lets a tabBarButton fully replace the
// default touchable, so this is still a real Tab.Screen underneath (deep
// links, focus state, etc. all keep working) — only its visual chrome differs.
//
// Kept visible during the pilot even though regular users can't create
// anything: see screens/create/CreateGateScreen.tsx for why, and for what
// they get instead.
function CreateTabButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.createButtonWrap} hitSlop={8}>
      <View style={styles.createButtonCircle}>
        <Ionicons name="add" size={30} color={colors.bg} />
      </View>
    </Pressable>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme} linking={linking}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.surfaceRaised, height: 62, paddingBottom: 8, paddingTop: 6 },
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
          options={{
            tabBarLabel: () => null,
            tabBarButton: (props) => <CreateTabButton onPress={() => props.onPress?.({} as any)} />,
          }}
        />
        <Tab.Screen name="Events" component={EventsStackScreen} />
        <Tab.Screen name="Profile" component={ProfileStackScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
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
