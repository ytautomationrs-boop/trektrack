import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { useAppState } from "../../state/useAppState";
import { CreateRaceScreen } from "./CreateRaceScreen";
import { CreateChallengeScreen } from "./CreateChallengeScreen";

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
 * Admin-flagged accounts get a picker for the two models, which is how we
 * seed pilot races and challenges through the normal UI rather than by hand
 * in the database.
 */
type Mode = null | "race" | "challenge";

export function CreateGateScreen() {
  const app = useAppState();
  const [mode, setMode] = useState<Mode>(null);

  if (!app.session?.isAdmin) return <ComingSoon />;

  if (mode === "race") return <CreateRaceScreen />;
  if (mode === "challenge") return <CreateChallengeScreen />;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.pickerBlock}>
        <Text style={styles.pickerTitle}>What are you opening?</Text>
        <Text style={styles.pickerSub}>The two models have different rules about what people's money does.</Text>

        <Pressable style={styles.card} onPress={() => setMode("challenge")}>
          <View style={styles.cardIcon}>
            <Ionicons name="water-outline" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>StreakPot challenge</Text>
            <Text style={styles.cardBody}>
              Everyone stakes the same amount and hits a daily target. Whoever finishes splits the whole pool — Streak takes
              nothing.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.sub} />
        </Pressable>

        <Pressable style={styles.card} onPress={() => setMode("race")}>
          <View style={styles.cardIcon}>
            <Ionicons name="trophy-outline" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Race</Text>
            <Text style={styles.cardBody}>
              A fixed field competing on one metric, for a prize published before anyone enters. The fee and prizes are
              platform config — you don't set them.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.sub} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
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
          Streak is invite-only while we run the pilot, so races and challenges are opened by us for now — that's what keeps each
          one able to reach the exact number of people it needs.
        </Text>
        <Text style={styles.body}>
          You can still enter any race and join any challenge from the Pool and Competitions tabs.
        </Text>
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

  pickerBlock: { flex: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  pickerTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.text },
  pickerSub: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, marginBottom: spacing.md, lineHeight: 18 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg },
  cardIcon: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  cardBody: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, marginTop: 2, lineHeight: 17 },
});
