import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ImageBackground } from "react-native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { login, signUp } from "../../api/client";
import { useAppState } from "../../state/useAppState";
import { heroImages } from "../../theme/sportImages";
import { AstaLogo } from "../../components/AstaLogo";

// Some Hermes builds (notably generic/AOSP emulator images without full ICU
// data) return undefined from resolvedOptions().timeZone instead of throwing
// — JSON.stringify then silently drops the key and signup 400s server-side.
function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function AuthScreen() {
  const app = useAppState();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  // Pilot invite gate — there is no public signup without one.
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const user =
        mode === "signup"
          ? await signUp({ email: normalizedEmail, password, displayName: displayName.trim(), timezone: resolveTimezone(), inviteCode: inviteCode.trim() })
          : await login(normalizedEmail, password);
      app.setSession({
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
        bio: user.bio ?? null,
        isAdmin: user.isAdmin,
      });
      if (mode === "login") app.advanceOnboarding("done");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ImageBackground source={{ uri: heroImages.auth }} style={styles.background} imageStyle={styles.backgroundImage}>
      <View style={styles.overlay} />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.brandBlock}>
          <AstaLogo size={88} />
          <Text style={styles.logo}>ASTA</Text>
          <Text style={styles.tagline}>Race. Win. Climb.</Text>
        </View>

        <View style={styles.form}>
          {mode === "signup" && (
            <TextInput style={styles.input} placeholder="Unique username" placeholderTextColor={colors.sub} value={displayName} onChangeText={setDisplayName} autoCapitalize="none" autoCorrect={false} />
          )}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.sub}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput style={styles.input} placeholder="Password" placeholderTextColor={colors.sub} secureTextEntry value={password} onChangeText={setPassword} />
          {mode === "signup" && (
            <TextInput
              style={styles.input}
              placeholder="Invite code"
              placeholderTextColor={colors.sub}
              autoCapitalize="none"
              autoCorrect={false}
              value={inviteCode}
              onChangeText={setInviteCode}
            />
          )}
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={styles.primaryButton} onPress={handleSubmit} disabled={submitting}>
            <Text style={styles.primaryButtonText}>{submitting ? "..." : mode === "signup" ? "Create account" : "Log in"}</Text>
          </Pressable>
          <Pressable onPress={() => setMode(mode === "signup" ? "login" : "signup")}>
            <Text style={styles.switchModeText}>{mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: colors.bg },
  backgroundImage: { opacity: 0.95 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.42)" },
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.xs },
  brandBlock: { alignItems: "center", marginBottom: spacing.xl },
  logo: { fontFamily: fonts.display, fontSize: 48, color: colors.accent, fontStyle: "italic", marginTop: spacing.sm },
  tagline: { fontFamily: fonts.body, fontSize: 18, color: colors.sub, marginTop: spacing.xs },
  form: { width: "100%", gap: spacing.sm },
  input: {
    backgroundColor: colors.glass,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.text,
  },
  error: { fontFamily: fonts.body, fontSize: 12, color: colors.fail },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radii.lg, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.sm },
  primaryButtonText: { fontFamily: fonts.bodyBold, fontSize: 17, color: "#111217" },
  switchModeText: { fontFamily: fonts.body, fontSize: 15, color: colors.text, textAlign: "center", marginTop: spacing.sm },
});
