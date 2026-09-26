import {Capacitor} from "@capacitor/core";
import {signInProvider,acceptProviderSession,type ProviderConfig,type Provider} from "../../api/providerClient";
import React, { useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ImageBackground } from "react-native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import {request} from "../../api/http";
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
  const [phone,setPhone]=useState(""),[code,setCode]=useState(""),[mfa,setMfa]=useState(false),[sms,setSms]=useState(false);
  const [providers,setProviders]=useState<ProviderConfig|null>(null),[registration,setRegistration]=useState<string|null>(null);
  useEffect(()=>{request<ProviderConfig>("/auth/config").then(setProviders).catch(()=>{});},[]);
  async function providerLogin(provider:Provider){
   if(!providers)return;setSubmitting(true);setError(null);
   try{const data=await signInProvider(provider,providers);if(data.needsUsername){setRegistration(data.registrationToken);setMode('signup');}else{app.setSession(await acceptProviderSession(data));app.advanceOnboarding('done');}}
   catch(error:any){if(!/cancel/i.test(error.message))setError(error.message);}
   finally{setSubmitting(false);}
  }

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
      if(registration){
       const data=await request<any>('/auth/provider/signup',{method:'POST',body:JSON.stringify({registrationToken:registration,displayName:displayName.trim(),inviteCode:inviteCode.trim(),timezone:resolveTimezone()})});
       app.setSession(await acceptProviderSession(data));return;
      }
      const normalizedEmail = email.trim().toLowerCase();
      const user =
        mode === "signup"
          ? await signUp({ email: normalizedEmail, password, displayName: displayName.trim(), timezone: resolveTimezone(), inviteCode: inviteCode.trim(), phoneNumber: phone.trim() || undefined, code:code || undefined })
          : await login(normalizedEmail, password,code || undefined);
      app.setSession({
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
        coverUrl: user.coverUrl ?? null,
        bio: user.bio ?? null,
        isAdmin: user.isAdmin,
      });
      if (mode === "login") app.advanceOnboarding("done");
    } catch (err: any) {
      if(err.mfaRequired)setMfa(true);
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
          <AstaLogo symbol size={104} />
          <Text style={styles.tagline}>Race. Win. Climb.</Text>
        </View>

        <View style={styles.form}>
          {Capacitor.isNativePlatform() && !registration && providers && <>
           {providers.apple?<Pressable accessibilityRole="button" style={styles.providerButton} disabled={submitting} onPress={()=>void providerLogin('apple')}><Text style={styles.providerText}>Continue with Apple</Text></Pressable>:null}
           {providers.google && providers.googleIosClientId?<Pressable accessibilityRole="button" style={styles.providerButton} disabled={submitting} onPress={()=>void providerLogin('google')}><Text style={styles.providerText}>Continue with Google</Text></Pressable>:null}
          </>}
          {registration?<Text style={styles.switchModeText}>Choose your unique username to finish joining ASTA.</Text>:null}
          {mode === "signup" && (
            <TextInput keyboardAppearance="dark" style={styles.input} placeholder="Unique username" placeholderTextColor={colors.sub} value={displayName} onChangeText={setDisplayName} autoCapitalize="none" autoCorrect={false} />
          )}
          {!registration && <><TextInput keyboardAppearance="dark"
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.sub}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput keyboardAppearance="dark" style={styles.input} placeholder="Password" placeholderTextColor={colors.sub} secureTextEntry value={password} onChangeText={setPassword} /></>}
          {mode === "signup" && (
            <TextInput keyboardAppearance="dark"
              style={styles.input}
              placeholder="Invite code"
              placeholderTextColor={colors.sub}
              autoCapitalize="none"
              autoCorrect={false}
              value={inviteCode}
              onChangeText={setInviteCode}
            />
          )}
          {mode==='signup' && sms && <><Text style={styles.switchModeText}>Protect your account with SMS two-factor authentication (optional).</Text><TextInput accessibilityLabel="Phone number" keyboardAppearance="dark" style={styles.input} placeholder="Phone with country code, e.g. +27821234567" placeholderTextColor={colors.sub} value={phone} onChangeText={setPhone} keyboardType="phone-pad" /></>}
          {mfa && <><TextInput accessibilityLabel="SMS verification code" keyboardAppearance="dark" style={styles.input} placeholder="SMS verification code" placeholderTextColor={colors.sub} value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={10}/><Pressable disabled={submitting} onPress={()=>{setCode('');setMfa(false);}}><Text style={styles.switchModeText}>Request a new code (wait one minute)</Text></Pressable></>}
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={styles.primaryButton} onPress={handleSubmit} disabled={submitting}>
            <Text style={styles.primaryButtonText}>{submitting ? "..." : mfa ? "Verify and continue" : mode === "signup" ? "Create account" : "Log in"}</Text>
          </Pressable>
          <Pressable onPress={() => {setRegistration(null);setMode(mode === "signup" ? "login" : "signup");setCode("");setMfa(false);setError(null);setPhone("");}}>
            <Text style={styles.switchModeText}>{mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  providerButton:{minHeight:48,borderRadius:12,backgroundColor:"#ffffff",justifyContent:"center",alignItems:"center"},providerText:{fontFamily:fonts.bodySemiBold,color:"#111111",fontSize:17},
  background: { flex: 1, backgroundColor: colors.bg },
  backgroundImage: { opacity: 0.95 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.42)" },
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.xs },
  brandBlock: { alignItems: "center", marginBottom: spacing.xl },
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
