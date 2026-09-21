import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, fonts, spacing } from "../../theme/tokens";
import { SocialSection } from "../profile/ProfileScreen";

export function SocialScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Social</Text>
        <Text style={styles.sub}>Find players, see followers and following, and message people you follow back and forth.</Text>
        <SocialSection />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { fontFamily: fonts.display, fontSize: 30, color: colors.text },
  sub: { fontFamily: fonts.body, fontSize: 12, color: colors.sub, lineHeight: 17, marginTop: 2 },
});
