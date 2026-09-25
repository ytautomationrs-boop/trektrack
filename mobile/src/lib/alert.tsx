import React, { useEffect, useState } from "react";
import { Alert as RNAlert, Modal, View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { colors, fonts, radii, spacing } from "../theme/tokens";

/**
 * Cross-platform replacement for `Alert.alert`.
 *
 * ## Why this exists
 *
 * react-native-web ships Alert as a literal no-op:
 *
 *     class Alert { static alert() {} }
 *
 * So on web every `Alert.alert(...)` in this app did nothing at all. That was
 * not merely cosmetic — an alert with buttons is the only thing that calls
 * its `onPress`, so any action gated behind a confirmation was **unreachable
 * in a browser**:
 *
 *   - withdrawing from a race or a challenge (money stuck in)
 *   - buying a redemption
 *   - entering a lower-league race
 *   - logging out
 *   - the "Share code" button that is the ONLY place a creator is shown
 *     their new race/challenge invite code
 *
 * and every success and failure message — including wallet deposits and
 * withdrawals — was silent, so a button would simply stop spinning with no
 * indication of what had happened. The pilot is web-first, which made this
 * the single most consequential gap in the client.
 *
 * ## Shape
 *
 * Deliberately the same signature as `Alert.alert` so call sites only change
 * their import. Native still delegates to the real Alert — a system dialog is
 * better than a hand-rolled one where a system dialog exists.
 */

export type AlertButton = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
};

type PendingAlert = { title: string; message?: string; buttons: AlertButton[] };

const DEFAULT_BUTTONS: AlertButton[] = [{ text: "OK" }];

let enqueue: ((a: PendingAlert) => void) | null = null;

/**
 * Drop-in for `Alert.alert`.
 *
 * On web this needs <AlertHost /> mounted, which App.tsx does once. If it
 * somehow isn't, fall back to the browser's own dialogs rather than
 * swallowing the message — silently losing a payment confirmation is the
 * exact failure this module exists to prevent.
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  const resolved = buttons?.length ? buttons : DEFAULT_BUTTONS;

  if (Platform.OS !== "web") {
    RNAlert.alert(title, message, resolved);
    return;
  }

  if (enqueue) {
    enqueue({ title, message, buttons: resolved });
    return;
  }

  const body = message ? `${title}\n\n${message}` : title;
  const cancel = resolved.find((b) => b.style === "cancel");
  const proceed = resolved.find((b) => b.style !== "cancel") ?? resolved[0];
  if (resolved.length > 1 && cancel) {
    if (window.confirm(body)) proceed?.onPress?.();
    else cancel.onPress?.();
  } else {
    window.alert(body);
    proceed?.onPress?.();
  }
}

/**
 * Renders queued alerts on web. Mounted once, at the root.
 *
 * Alerts queue rather than replace each other: a handler that reports a
 * result and then triggers another message would otherwise lose the first,
 * and on web two alerts can be fired close enough together for that to
 * matter (nothing blocks between them the way a native dialog does).
 */
export function AlertHost() {
  const [queue, setQueue] = useState<PendingAlert[]>([]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    enqueue = (a) => setQueue((q) => [...q, a]);
    return () => {
      enqueue = null;
    };
  }, []);

  const current = queue[0];
  if (!current) return null;

  const dismiss = (button?: AlertButton) => {
    setQueue((q) => q.slice(1));
    // After dismissal, so a handler that opens another alert doesn't get
    // closed by this same update.
    button?.onPress?.();
  };

  // Backdrop and Escape behave like the cancel button when there is one, and
  // do nothing otherwise — a confirmation with no cancel is asking a question
  // that has to be answered.
  const cancelButton = current.buttons.find((b) => b.style === "cancel");
  const dismissible = current.buttons.length === 1 || !!cancelButton;
  const onDismiss = () => {
    if (!dismissible) return;
    dismiss(cancelButton ?? current.buttons[0]);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        {/* Stops a press inside the card from closing it via the backdrop. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{current.title}</Text>
          {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
          <View style={styles.buttonRow}>
            {current.buttons.map((b, i) => (
              <Pressable
                key={`${b.text}-${i}`}
                style={[styles.button, b.style === "cancel" ? styles.buttonCancel : styles.buttonDefault]}
                onPress={() => dismiss(b)}
              >
                <Text
                  style={[
                    styles.buttonText,
                    b.style === "cancel" && styles.buttonTextCancel,
                    b.style === "destructive" && styles.buttonTextDestructive,
                  ]}
                >
                  {b.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: { width: "100%", maxWidth: 400, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, gap: spacing.md },
  title: { fontFamily: fonts.display, fontSize: 17, color: colors.text },
  message: { fontFamily: fonts.body, fontSize: 14, color: colors.sub, lineHeight: 20 },
  // Wraps rather than squeezing — a three-button alert at 375px would
  // otherwise clip its labels.
  buttonRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  button: { borderRadius: radii.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minWidth: 88, alignItems: "center" },
  buttonDefault: { backgroundColor: colors.surfaceRaised },
  buttonCancel: { backgroundColor: "transparent" },
  buttonText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.accent },
  buttonTextCancel: { color: colors.sub },
  buttonTextDestructive: { color: colors.fail },
});
