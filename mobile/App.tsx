import { setHealthSession, prepareHealthOnStartup } from "./src/lib/appleHealth";
import {syncWatchSession} from './src/lib/watch';
import {getToken} from './src/lib/tokenStorage';
import "@expo/metro-runtime";
import React, { useEffect, useState } from "react";
import { View, StatusBar, Platform, Text, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FontDisplay, useFonts } from "expo-font";
import { Asset } from "expo-asset";
import { Figtree_400Regular } from "@expo-google-fonts/figtree/400Regular";
import { Figtree_500Medium } from "@expo-google-fonts/figtree/500Medium";
import { Figtree_600SemiBold } from "@expo-google-fonts/figtree/600SemiBold";
import { Figtree_700Bold } from "@expo-google-fonts/figtree/700Bold";
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
import { LoadError } from "./src/components/LoadError";
import { getSocialEvents } from "./src/api/eventClient";
import { getSocialFeed } from "./src/api/socialClient";
import { AlertHost } from "./src/lib/alert";
import { configureNativeExperience } from "./src/lib/nativeExperience";
import { AstaLogo } from "./src/components/AstaLogo";

// iOS zooms a web input whenever its rendered font is below 16px. Capacitor
// hosts this build in WKWebView, so enforce the accessible iOS minimum once
// for every input rather than relying on every screen to remember it.
if (Platform.OS === "web" && typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = "input,textarea,select{font-size:16px!important}html{touch-action:manipulation}";
  document.head.appendChild(style);
}

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
  useEffect(() => { void configureNativeExperience(); }, []);
  useFonts({
    Montserrat_600SemiBold: {uri: Asset.fromModule(Platform.OS === "web" ? require("./assets/fonts/Montserrat-SemiBold.woff2") : require("./assets/fonts/Montserrat-SemiBold.ttf")).uri, display: FontDisplay.SWAP},
    ASTAHeading: { uri: Asset.fromModule(require("./assets/fonts/ASTAHeading.ttf")).uri, display: FontDisplay.SWAP },
    Figtree_400Regular: { uri: Asset.fromModule(Figtree_400Regular).uri, display: FontDisplay.SWAP },
    Figtree_500Medium: { uri: Asset.fromModule(Figtree_500Medium).uri, display: FontDisplay.SWAP },
    Figtree_600SemiBold: { uri: Asset.fromModule(Figtree_600SemiBold).uri, display: FontDisplay.SWAP },
    Figtree_700Bold: { uri: Asset.fromModule(Figtree_700Bold).uri, display: FontDisplay.SWAP },
  });
  const app = useAppState();
  useEffect(()=>{if(app.session)void getToken().then(token=>{void syncWatchSession(token);void setHealthSession(token,app.session!.userId);});},[app.session?.userId]);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<Error | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [webCallback, setWebCallback] = useState<WebCallback>(detectWebCallback);

  // A token that the server rejects ends the session here rather than
  // leaving every screen showing an error the user can do nothing about.
  // Registered before the restore below so a 401 during restore is covered.
  useEffect(() => {
    setSessionExpiredHandler(() => AppStateMachine.logout());
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    setRestoring(true);
    setRestoreError(null);
    restoreSession()
      .then((user) => {
        if (user) {
          app.setSession({
            userId: user.id,
            displayName: user.displayName,
            email: user.email,
            avatarUrl: user.avatarUrl ?? null, coverUrl: user.coverUrl ?? null,
            bio: user.bio ?? null,
            isAdmin: user.isAdmin,
          });
          // A restored session skips onboarding — it only exists to gate
          // first-time health-permission setup, not every app launch.
          app.advanceOnboarding("done");
        }
      })
      .catch((error: Error) => setRestoreError(error))
      .finally(() => setRestoring(false));
  }, [restoreAttempt]);


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

  if (restoreError) {
    return (
      <View style={styles.splash}>
        <LoadError error={restoreError} onRetry={() => setRestoreAttempt((n) => n + 1)} />
      </View>
    );
  }

  return <AppShell />;
}

function Splash({ message }: { message: string }) {
  return (
    <View style={styles.splash}>
      <AstaLogo symbol width={104} backgroundColor={colors.accent} />
      <ActivityIndicator color={colors.onAccent} style={styles.splashSpinner} />
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
  useEffect(()=>{
    if(!app.session || app.onboardingStep!=="done")return;
    const owner=app.session.userId;
    const timer=setTimeout(()=>{void getToken().then(token=>prepareHealthOnStartup(token,owner)).catch(()=>{});},800);
    return()=>clearTimeout(timer);
  },[app.session?.userId,app.onboardingStep]);
  useEffect(()=>{if(app.session)void getToken().then(syncWatchSession);},[app.session?.userId]);

  useEffect(() => {
    if (!app.session) return;
    // Fire-and-forget, and never surfaced as an error: a denied permission
    // or a browser without push support is a normal outcome, not a failure
    // worth interrupting anyone over. Registration is idempotent server-side
    // (upsert on the token), so re-running it per session is harmless.
    void registerForPushNotifications().catch(() => {});
  }, [app.session?.userId]);

  useEffect(() => {
    if (!app.session) return;
    // Give the launch screen priority, then warm the other main tabs.
    const timer = setTimeout(() => {
      void getSocialEvents({ cacheMode: "default" }).catch(() => {});
      void getSocialFeed().catch(() => {});
    }, 3500);
    return () => clearTimeout(timer);
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
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, padding: 24 },
  splashSpinner: { marginTop: 18 },
  splashMessage: { marginTop: 12, fontFamily: "Figtree_600SemiBold", fontSize: 12, color: colors.onAccent },
});
