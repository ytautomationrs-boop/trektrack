import React, { useEffect, useState } from "react";
import { View, StatusBar, Platform, Text, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts, Caprasimo_400Regular } from "@expo-google-fonts/caprasimo";
import { Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold, Figtree_700Bold } from "@expo-google-fonts/figtree";
import { colors } from "./src/theme/tokens";
import { useAppState } from "./src/state/useAppState";
import { restoreSession } from "./src/api/client";
import { setSessionExpiredHandler } from "./src/api/http";
import { AppStateMachine } from "./src/state/AppStateMachine";
import { AuthScreen } from "./src/screens/auth/AuthScreen";
import { OnboardingFlow } from "./src/screens/onboarding/OnboardingFlow";
import { StravaCallbackScreen } from "./src/screens/integrations/StravaCallbackScreen";
import { PaystackCallbackScreen } from "./src/screens/integrations/PaystackCallbackScreen";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { registerForPushNotifications } from "./src/notifications/register";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { AlertHost } from "./src/lib/alert";

/**
 * Web only. Both Strava's OAuth redirect and Paystack's checkout redirect
 * are full top-level page navigations (see integrations/strava.ts and
 * integrations/paystack.ts), so they have to be caught here — ahead of the
 * normal auth/onboarding branching — by reading the URL path on first
 * render rather than through React Navigation, which isn't mounted yet.
 */
type WebCallback = "strava" | "paystack" | null;

function detectWebCallback(): WebCallback {
  if (Platform.OS !== "web") return null;
  if (window.location.pathname === "/strava-callback") return "strava";
  if (window.location.pathname === "/paystack-callback") return "paystack";
  return null;
}

/**
 * Outermost component, and deliberately nothing but the boundary — a
 * boundary can't catch a throw from its own render, so anything that could
 * crash has to live strictly below it. That includes font loading and
 * session restore, which is why they're in AppRoot rather than here.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}

function AppRoot() {
  const [fontsLoaded] = useFonts({
    Caprasimo_400Regular,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });
  const app = useAppState();
  const [restoring, setRestoring] = useState(true);
  const [webCallback, setWebCallback] = useState<WebCallback>(detectWebCallback);

  // A token that the server rejects ends the session here rather than
  // leaving every screen showing an error the user can do nothing about.
  // Registered before the restore below so a 401 during restore is covered.
  useEffect(() => {
    setSessionExpiredHandler(() => AppStateMachine.logout());
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    restoreSession()
      .then((user) => {
        if (user) {
          app.setSession({
            userId: user.id,
            displayName: user.displayName,
            email: user.email,
            avatarUrl: user.avatarUrl ?? null,
            bio: user.bio ?? null,
            isAdmin: user.isAdmin,
          });
          // A restored session skips onboarding — it only exists to gate
          // first-time health-permission setup, not every app launch.
          app.advanceOnboarding("done");
        }
      })
      .finally(() => setRestoring(false));
  }, []);

  if (!fontsLoaded) return <Splash message="Loading ASTA" />;

  // Takes priority over the restoring spinner below — the user is mid-flow
  // on a URL that isn't meant to show the normal app shell at all.
  if (webCallback) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        {webCallback === "strava" ? (
          <StravaCallbackScreen onDone={() => setWebCallback(null)} />
        ) : (
          <PaystackCallbackScreen onDone={() => setWebCallback(null)} />
        )}
        <AlertHost />
      </SafeAreaProvider>
    );
  }

  if (restoring) return <Splash message="Restoring your session" />;

  return <AppShell />;
}

function Splash({ message }: { message: string }) {
  return (
    <View style={styles.splash}>
      <Text style={styles.splashTitle}>ASTA</Text>
      <ActivityIndicator color={colors.accent} style={styles.splashSpinner} />
      <Text style={styles.splashMessage}>{message}</Text>
    </View>
  );
}

/**
 * Split out so push registration can key off the session without the
 * callback/restore branches above re-running it.
 */
function AppShell() {
  const app = useAppState();

  useEffect(() => {
    if (!app.session) return;
    // Fire-and-forget, and never surfaced as an error: a denied permission
    // or a browser without push support is a normal outcome, not a failure
    // worth interrupting anyone over. Registration is idempotent server-side
    // (upsert on the token), so re-running it per session is harmless.
    registerForPushNotifications();
  }, [app.session?.userId]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      {!app.session ? (
        <AuthScreen />
      ) : app.onboardingStep !== "done" ? (
        <OnboardingFlow onComplete={(metricKeys) => app.selectStarterMetrics(metricKeys)} />
      ) : (
        <RootNavigator />
      )}
      {/* Last child so it paints above everything. Renders nothing on
          native, where showAlert() uses the real system dialog. */}
      <AlertHost />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: 24 },
  splashTitle: { fontFamily: "Caprasimo_400Regular", fontSize: 36, color: colors.accent, fontStyle: "italic" },
  splashSpinner: { marginTop: 18 },
  splashMessage: { marginTop: 12, fontFamily: "Figtree_600SemiBold", fontSize: 14, color: colors.sub },
});
