import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { connectStrava } from "../../api/client";

/**
 * Web-only. Strava's OAuth redirect lands here (via the backend's
 * web-callback bridge — see integrations/strava.ts and
 * backend/src/modules/integrations/strava/routes.ts) after a full
 * top-level page navigation away and back, which tears down whatever JS
 * state existed before the redirect. This screen reads the `code` straight
 * off the URL and finishes the connection itself, rather than trying to
 * resume whatever flow (onboarding or a later Profile reconnect) started
 * it — after finishing, the app just lands on its normal boot screen.
 */
export function StravaCallbackScreen({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<"connecting" | "error">("connecting");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    // Echoed back by Strava; the backend checks it was signed for this
    // account before exchanging the code. See the CSRF note on
    // backend/src/modules/integrations/strava/routes.ts.
    const oauthState = params.get("state");
    const error = params.get("error");

    async function finish() {
      if (error || !code || !oauthState) {
        setState("error");
        setMessage(
          error
            ? `Strava said: "${error}"`
            : !code
              ? "No authorization code came back from Strava."
              : "That Strava link is missing its security token. Please start again from your profile."
        );
        return;
      }
      try {
        await connectStrava(code, oauthState);
        clearUrlAndContinue();
      } catch (err: any) {
        setState("error");
        setMessage(err.message ?? "Couldn't finish connecting Strava.");
      }
    }
    finish();
  }, []);

  function clearUrlAndContinue() {
    // Drop ?code=...&state=... from the address bar before handing back to
    // the normal app — leaving it would let a page refresh replay a
    // one-time-use authorization code straight into a 4xx.
    window.history.replaceState(null, "", "/");
    onDone();
  }

  return (
    <View style={styles.screen}>
      {state === "connecting" ? (
        <>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.text}>Connecting Strava…</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>Couldn't connect Strava</Text>
          <Text style={styles.text}>{message}</Text>
          <Pressable style={styles.button} onPress={clearUrlAndContinue}>
            <Text style={styles.buttonText}>Continue anyway</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  title: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.text, textAlign: "center" },
  text: { fontFamily: fonts.body, fontSize: 14, color: colors.sub, textAlign: "center", marginTop: spacing.sm },
  button: { backgroundColor: colors.accent, borderRadius: radii.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.lg },
  buttonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.bg },
});
