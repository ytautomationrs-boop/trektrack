import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { confirmPaystackDeposit } from "../../api/client";
import { readPendingDepositReference, clearPendingDepositReference } from "../../integrations/paystack";

/**
 * Web-only. Paystack's checkout redirect lands here after a full top-level
 * page navigation away and back, which tears down whatever JS state existed
 * before it — so the transaction reference is recovered from localStorage
 * (stashed by depositViaPaystack) or, failing that, from the ?reference=
 * Paystack puts on the redirect itself.
 *
 * Confirming is safe to reach here without having "succeeded": the backend
 * re-verifies the transaction with Paystack directly and refuses anything
 * that isn't genuinely paid (see modules/wallet/service.ts confirmDeposit),
 * so a cancelled checkout surfaces as a clean error rather than a phantom
 * credit. It's also idempotent on the reference, so a refresh can't
 * double-credit.
 */
export function PaystackCallbackScreen({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<"confirming" | "done" | "error">("confirming");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = readPendingDepositReference() ?? params.get("reference") ?? params.get("trxref");

    async function finish() {
      if (!reference) {
        setState("error");
        setMessage("No deposit reference came back from Paystack.");
        return;
      }
      try {
        const wallet = await confirmPaystackDeposit(reference);
        clearPendingDepositReference();
        setState("done");
        setMessage(`Your balance is now R${(wallet.balanceCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}.`);
      } catch (err: any) {
        clearPendingDepositReference();
        setState("error");
        setMessage(err.message ?? "That payment didn't complete.");
      }
    }
    finish();
  }, []);

  function continueToApp() {
    // Drop ?reference=... before handing back to the app, so a refresh
    // doesn't replay a spent reference.
    window.history.replaceState(null, "", "/");
    onDone();
  }

  return (
    <View style={styles.screen}>
      {state === "confirming" ? (
        <>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.text}>Confirming your deposit…</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>{state === "done" ? "Deposit complete" : "Deposit didn't go through"}</Text>
          <Text style={styles.text}>{message}</Text>
          <Pressable style={styles.button} onPress={continueToApp}>
            <Text style={styles.buttonText}>Back to ASTA</Text>
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
