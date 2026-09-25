import { PageMotion } from "../../components/PageMotion";
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { getLeagueStandings } from "../../api/raceClient";
import type { LeagueStandings } from "../../api/raceTypes";
import { LoadError } from "../../components/LoadError";
import { colors, fonts, spacing } from "../../theme/tokens";
import { LeagueHeader } from "./LeagueHeader";

export function LeaguesScreen() {
  const [standings, setStandings] = useState<LeagueStandings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const hasLoaded = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await getLeagueStandings({ onCached: (saved) => { setStandings(saved); hasLoaded.current = true; } });
      setStandings(result);
      hasLoaded.current = true;
      setError(null);
    } catch (err) {
      if (!silent) setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(hasLoaded.current); }, [load]));

  return (
    <PageMotion><View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} tintColor={colors.accent} />}
      >
        <Text style={styles.title}>Leagues</Text>
        <Text style={styles.subtitle}>Your progress in every sport. Select a sport to see your league and points.</Text>
        {loading && !standings ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
        {!loading && error && !standings ? <LoadError error={error} onRetry={() => load()} /> : null}
        {standings ? (
          <LeagueHeader
            standings={standings}
            onSelectMetric={(metricKey) => setStandings((current) => current ? { ...current, primaryMetricKey: metricKey } : current)}
          />
        ) : null}
      </ScrollView>
    </View></PageMotion>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: { fontFamily: fonts.display, textTransform: "uppercase", fontSize: 24, color: colors.text },
  subtitle: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.sub, marginTop: spacing.sm, marginBottom: spacing.xl },
  loading: { marginTop: spacing.xl },
});
