import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors, fonts, radii, spacing } from "../theme/tokens";
import type { ApiError } from "../api/http";

/**
 * Shown when a screen's initial data load failed and there is nothing to
 * render in its place.
 *
 * Every screen used to load with `try { ... } finally { setLoading(false) }`
 * and no catch, so a failed load cleared the spinner and left an empty
 * screen — no message, no retry, no indication anything had gone wrong. With
 * api/http.ts now enforcing a timeout, that rejection is guaranteed rather
 * than a hang, which makes handling it mandatory rather than tidy.
 *
 * Deliberately NOT used for a failed background poll. A screen that already
 * has data on it should not be replaced by an error because one silent
 * refresh missed — the data on screen is stale, not gone. See how `load`
 * treats `opts.silent` in the screens that poll.
 */

export function LoadError({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  const api = error as ApiError | null;

  // Network and timeout failures already carry a user-facing sentence from
  // http.ts. A server-side error message is written for a specific action
  // ("You don't have enough for this stake") and reads oddly as a whole-screen
  // state, so those get a generic line instead.
  const message = api?.isNetworkError
    ? api.message
    : "Something went wrong loading this. It's not something you did.";

  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      <Pressable style={styles.retry} onPress={onRetry}>
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  message: { fontFamily: fonts.body, fontSize: 14, color: colors.sub, textAlign: "center", lineHeight: 20 },
  retry: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  retryText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.text },
});
