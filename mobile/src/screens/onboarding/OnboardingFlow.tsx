import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, Linking, Platform, ImageBackground } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { iconFor } from "../../theme/metricIcons";
import { connectHealth, type ConnectHealthOutcome } from "../../health/permissions";
import { connectStravaAccount } from "../../integrations/strava";
import { useAppState } from "../../state/useAppState";
import type { MetricTypeDefinition } from "../../api/types";
import { sportImageFor } from "../../theme/sportImages";

const SLIDES = [
  {
    title: "Enter a race",
    body: "Pick a metric and a field of 10. Everyone pays the same fixed entry fee.",
  },
  {
    title: "Go furthest, win",
    body: "You're ranked on your total over the race window. No daily targets, nothing to miss.",
  },
  {
    title: "Fixed prizes, set in advance",
    body: "Prize amounts are published before you enter and don't change with turnout. If a race never fills, everyone is refunded in full.",
  },
];

// Which metric to set up health permissions for first. Not a race, and not
// a commitment — races are entered from Discover once onboarding is done.
const STARTER_METRICS: Array<{ metricKey: string; icon: string; title: string; sub: string }> = [
  { metricKey: "steps", icon: "footprints", title: "Walking", sub: "Everyday steps" },
  { metricKey: "running", icon: "running", title: "Running", sub: "Distance on foot" },
  { metricKey: "cycling", icon: "bike", title: "Cycling", sub: "Distance on the bike" },
  { metricKey: "swimming", icon: "waves", title: "Swimming", sub: "Distance in the pool" },
];

export function OnboardingFlow({ onComplete }: { onComplete: (starterMetricKeys: string[]) => void }) {
  const app = useAppState();

  if (app.onboardingStep === "intro") return <IntroSlides onDone={() => app.advanceOnboarding("connect_health")} />;
  if (app.onboardingStep === "connect_health") return <ConnectHealthStep app={app} />;
  if (app.onboardingStep === "permission_denied") return <PermissionDeniedStep app={app} />;
  if (app.onboardingStep === "pick_starter_metric") return <StarterChallengeGrid onPick={onComplete} />;
  return null;
}

function IntroSlides({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  return (
    <View style={styles.screen}>
      <FlatList
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width))}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <View style={styles.slideGlyph} />
            <Text style={styles.slideTitle}>{item.title}</Text>
            <Text style={styles.slideBody}>{item.body}</Text>
          </View>
        )}
      />
      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
      <Pressable style={styles.primaryButton} onPress={onDone}>
        <Text style={styles.primaryButtonText}>{isLast ? "Get started" : "Next"}</Text>
      </Pressable>
    </View>
  );
}

// Web has no HealthKit/Health Connect equivalent, so Strava is the PRIMARY
// verification method there instead of a fallback — see
// integrations/strava.ts and health/adapters/webUnavailable.ts. Skipping is
// allowed on web (not on native): you can browse and deposit without it,
// you just can't have activity verified until you connect from Profile.
function ConnectHealthStep({ app }: { app: ReturnType<typeof useAppState> }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isWeb = Platform.OS === "web";

  async function handleConnect() {
    setConnecting(true);
    setError(null);

    if (isWeb) {
      const result = await connectStravaAccount();
      // "redirecting" means the page is already navigating away — there is
      // nothing left to do in this component. Only an outright failure
      // (e.g. Strava not configured on this server) needs handling here.
      if (result.status === "error") {
        setConnecting(false);
        setError(result.message);
      }
      return;
    }

    const { outcome } = await connectHealth(["STEPS", "RUNNING_WORKOUT", "CYCLING_WORKOUT", "SWIMMING_WORKOUT"]).catch(
      () => ({ outcome: "denied" as ConnectHealthOutcome, result: { granted: [], denied: [] } })
    );
    setConnecting(false);
    if (outcome === "connected" || outcome === "partially_denied") {
      app.advanceOnboarding("pick_starter_metric");
    } else {
      app.advanceOnboarding("permission_denied");
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.centerBlock}>
        <View style={styles.slideGlyph} />
        <Text style={styles.slideTitle}>{isWeb ? "How results are verified" : "Connect your health data"}</Text>
        <Text style={styles.slideBody}>
          {isWeb
            ? "Export the workout from your watch or training app and upload the file — ASTA reads .gpx, .tcx and .fit. We never accept typed-in numbers. You can also connect Strava from your profile if you'd rather it came across on its own."
            : "ASTA reads your steps and workouts from Health to verify competition results — we never accept typed-in numbers."}
        </Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
      <Pressable
        style={styles.primaryButton}
        onPress={isWeb ? () => app.advanceOnboarding("pick_starter_metric") : handleConnect}
        disabled={connecting}
      >
        <Text style={styles.primaryButtonText}>{connecting ? "Connecting…" : isWeb ? "Got it" : "Connect Health"}</Text>
      </Pressable>

    </View>
  );
}

// Native only — web never reaches this step (see ConnectHealthStep above:
// a failure there shows an inline error and lets the user retry or skip in
// place, since there's no OS Settings toggle to send them to).
function PermissionDeniedStep({ app }: { app: ReturnType<typeof useAppState> }) {
  return (
    <View style={styles.screen}>
      <View style={styles.centerBlock}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.fail} />
        <Text style={styles.slideTitle}>Health access needed</Text>
        <Text style={styles.slideBody}>
          Without Health access we can't verify your race and challenge results. Enable access in Settings, then come back and
          try again.
        </Text>
      </View>
      <Pressable style={styles.primaryButton} onPress={() => Linking.openSettings()}>
        <Text style={styles.primaryButtonText}>Open Settings</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => app.advanceOnboarding("connect_health")}>
        <Text style={styles.secondaryButtonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

function StarterChallengeGrid({ onPick }: { onPick: (metricKeys: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>(["running", "cycling"]);
  const toggle = (metricKey: string) =>
    setSelected((prev) => (prev.includes(metricKey) ? prev.filter((key) => key !== metricKey) : [...prev, metricKey]));
  return (
    <View style={styles.screen}>
      <Text style={styles.slideTitle}>Pick starter sports</Text>
      <Text style={styles.slideBody}>Choose a few. We’ll shape Pool and Competition suggestions around them first.</Text>
      <View style={styles.grid}>
        {STARTER_METRICS.map((c) => (
          <Pressable key={c.metricKey} style={[styles.gridCard, selected.includes(c.metricKey) && styles.gridCardActive]} onPress={() => toggle(c.metricKey)}>
            <ImageBackground source={{ uri: sportImageFor(c.metricKey) }} style={styles.gridImage} imageStyle={styles.gridImageStyle}>
              <View style={styles.gridOverlay} />
              <Ionicons name={selected.includes(c.metricKey) ? "checkmark-circle" : iconFor(c.icon)} size={26} color={colors.text} />
              <Text style={styles.gridCardTitle}>{c.title}</Text>
              <Text style={styles.gridCardSub}>{c.sub}</Text>
            </ImageBackground>
          </Pressable>
        ))}
      </View>
      <Pressable style={[styles.primaryButton, selected.length === 0 && styles.primaryButtonDisabled]} disabled={selected.length === 0} onPress={() => onPick(selected)}>
        <Text style={styles.primaryButtonText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl, paddingTop: spacing.xxl * 2, paddingBottom: spacing.xl, gap: spacing.lg },
  slide: { width: 340, alignItems: "center", paddingTop: spacing.xxl },
  centerBlock: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  slideGlyph: { width: 96, height: 96, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised, marginBottom: spacing.lg },
  slideTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.text, textAlign: "center" },
  slideBody: { fontFamily: fonts.body, fontSize: 14, color: colors.sub, textAlign: "center", lineHeight: 20, paddingHorizontal: spacing.md },
  errorText: { fontFamily: fonts.body, fontSize: 13, color: colors.fail, textAlign: "center", marginTop: spacing.md },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: spacing.xs },
  dot: { width: 6, height: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised },
  dotActive: { backgroundColor: colors.accent, width: 18 },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center" },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.bg },
  secondaryButton: { alignItems: "center", paddingVertical: spacing.sm },
  secondaryButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.sub },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.lg },
  gridCard: { width: "47%", height: 148, backgroundColor: colors.surface, borderRadius: radii.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  gridCardActive: { borderColor: colors.accent },
  gridImage: { flex: 1, padding: spacing.lg, justifyContent: "flex-end", gap: spacing.xs },
  gridImageStyle: { opacity: 0.82 },
  gridOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.42)" },
  gridCardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text, marginTop: spacing.xs },
  gridCardSub: { fontFamily: fonts.body, fontSize: 12, color: colors.sub },
});
