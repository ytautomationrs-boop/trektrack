import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { useAppState } from "../../state/useAppState";
import { CreateRaceScreen } from "./CreateRaceScreen";

/**
 * Pilot gate for the Create tab.
 *
 * The tab stays visible so the navigation doesn't look broken or
 * half-finished, but for a regular account it shows the "coming soon" state
 * below instead of a creation flow — matching the backend, where POST /races
 * and POST /challenges both refuse a non-admin with `admin_only` (see
 * middleware/auth.ts requireAdmin). Gating only here would be theatre; the
 * server is the actual enforcement, and this exists so the refusal is
 * explained up front rather than hit as an error after filling out a form.
 *
 * Admin-flagged accounts go straight to competition creation. The pooled
 * challenge flow is deliberately not exposed in the launch build.
 */
export function CreateGateScreen() {
  const app = useAppState();

  if (!app.session?.isAdmin) return <ComingSoon />;

  return <CreateRaceScreen />;
}

function ComingSoon() {
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.centerBlock}>
        <View style={styles.glyph}>
          <Ionicons name="hourglass-outline" size={30} color={colors.accent} />
        </View>
        <Text style={styles.title}>Creating is coming soon</Text>
        <Text style={styles.body}>
          TrackTrek is invite-only while we run the pilot, so competitions are opened by us for now — that's what keeps each
          one able to reach the exact number of people it needs.
        </Text>
        <Text style={styles.body}>You can still enter open competitions from the Competitions tab.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centerBlock: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  glyph: {
    width: 72,
    height: 72,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.text, textAlign: "center" },
  body: { fontFamily: fonts.body, fontSize: 14, color: colors.sub, textAlign: "center", lineHeight: 20 },
});
