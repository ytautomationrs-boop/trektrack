import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { AstaLogo } from "../../components/AstaLogo";

const HOW_IT_WORKS = [
  {
    icon: "trophy-outline",
    title: "Enter competitions",
    body: "Join public competitions or invite-only races created by other ASTA players.",
  },
  {
    icon: "wallet-outline",
    title: "Fixed entry, fixed prizes",
    body: "Entry fees and prizes are shown before you join. If a race does not fill, entrants are refunded.",
  },
  {
    icon: "sync-outline",
    title: "Sync your activity",
    body: "Use verified activity data during the race window so the leaderboard can be calculated fairly.",
  },
  {
    icon: "podium-outline",
    title: "Climb your league",
    body: "Your result earns sport-specific points and trophies for that competition type.",
  },
];

export function OnboardingFlow({ onComplete }: { onComplete: (starterMetricKeys: string[]) => void }) {
  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <AstaLogo size={82} backgroundColor={colors.bg} />
        <Text style={styles.title}>How it works</Text>
        <Text style={styles.subtitle}>Compete, sync verified activity, and climb your league.</Text>
      </View>

      <View style={styles.steps}>
        {HOW_IT_WORKS.map((step) => (
          <View key={step.title} style={styles.step}>
            <View style={styles.iconWrap}>
              <Ionicons name={step.icon as keyof typeof Ionicons.glyphMap} size={21} color={colors.accent} />
            </View>
            <View style={styles.stepCopy}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepBody}>{step.body}</Text>
            </View>
          </View>
        ))}
      </View>

      <Pressable style={styles.primaryButton} onPress={() => onComplete([])}>
        <Text style={styles.primaryButtonText}>Start using ASTA</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl * 1.5,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  hero: { alignItems: "center", gap: spacing.xs },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.text, marginTop: spacing.sm },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.sub,
    textAlign: "center",
    maxWidth: 320,
  },
  steps: { gap: spacing.md, flex: 1, justifyContent: "center" },
  step: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  stepCopy: { flex: 1 },
  stepTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  stepBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.sub, marginTop: 3 },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  primaryButtonText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.bg },
});
