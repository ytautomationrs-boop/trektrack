import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from "react-native";
import { colors, fonts, radii, spacing } from "../theme/tokens";
import { AppStateMachine } from "../state/AppStateMachine";

/**
 * Catches render-phase crashes anywhere below it.
 *
 * Without this, a single bad render — a metric payload shaped differently
 * than a screen expects, an undefined field on a partially-loaded race —
 * unmounts the entire React tree and leaves a blank screen with no
 * navigation, no error, and no way out but force-quitting. On web it's
 * worse: a white page that looks like the site is down.
 *
 * ## What it does NOT catch
 *
 * React error boundaries only cover the render phase, lifecycle methods, and
 * constructors of the subtree. They do not catch:
 *
 * - errors thrown inside event handlers (`onPress`, etc.)
 * - rejected promises from async work (`useEffect` fetches)
 * - errors thrown by the boundary component itself
 *
 * Those are the API layer's job and are handled there — see api/http.ts,
 * which turns every network and timeout failure into a typed `ApiError` the
 * calling screen renders inline. This boundary is the floor underneath that,
 * not a replacement for it.
 */

type Props = { children: React.ReactNode };

type State = {
  error: Error | null;
  /** Component stack from React — far more useful than the message alone for locating which screen threw. */
  componentStack: string | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    // No crash reporter is wired up yet; this is the single place to add one.
    // Deliberately console.error rather than a silent swallow so the stack is
    // in the Metro/browser log even in a release build.
    console.error("[ErrorBoundary] render crash", error, info.componentStack);
  }

  /**
   * React has already unmounted the failed subtree, so clearing the error
   * remounts `children` from scratch rather than re-rendering the broken
   * instances. A deterministic crash will simply throw again and land back
   * here — no worse than the blank screen this replaces, and transient
   * crashes (a stale response, a race on first paint) genuinely recover.
   */
  private retry = () => this.setState({ error: null, componentStack: null });

  /**
   * The escape hatch for when retrying can't work because the bad state is
   * tied to the session itself. Clears the boundary too — logging out only
   * changes what `children` would render, and children aren't rendered while
   * the boundary is holding an error.
   */
  private signOut = () => {
    AppStateMachine.logout();
    this.retry();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Something broke</Text>
          <Text style={styles.body}>
            ASTA hit an error it couldn't recover from on its own. Your account and wallet balance aren't affected — nothing is
            saved from this screen.
          </Text>

          <Pressable style={styles.primaryButton} onPress={this.retry}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>

          {Platform.OS === "web" ? (
            <Pressable style={styles.secondaryButton} onPress={() => window.location.reload()}>
              <Text style={styles.secondaryButtonText}>Reload the page</Text>
            </Pressable>
          ) : null}

          <Pressable style={styles.secondaryButton} onPress={this.signOut}>
            <Text style={styles.secondaryButtonText}>Sign out and start over</Text>
          </Pressable>

          {/* Only in dev — the message can carry request paths or ids, and a
              user in production has no use for a component stack anyway. */}
          {__DEV__ ? (
            <View style={styles.debugBox}>
              <Text style={styles.debugTitle}>{error.name}: {error.message}</Text>
              {this.state.componentStack ? <Text style={styles.debugStack}>{this.state.componentStack.trim()}</Text> : null}
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  title: { fontFamily: fonts.display, textTransform: "uppercase", fontSize: 28, color: colors.text, textAlign: "center" },
  body: { fontFamily: fonts.body, fontSize: 14, color: colors.sub, textAlign: "center", lineHeight: 20, marginBottom: spacing.sm },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center" },
  primaryButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.bg },
  secondaryButton: { backgroundColor: colors.surface, borderRadius: radii.md, paddingVertical: spacing.md, alignItems: "center" },
  secondaryButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.sub },
  debugBox: { backgroundColor: colors.surface, borderRadius: radii.sm, padding: spacing.md, marginTop: spacing.lg, gap: spacing.sm },
  debugTitle: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.fail },
  debugStack: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, color: colors.sub, lineHeight: 14 },
});
