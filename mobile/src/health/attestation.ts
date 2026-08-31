import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Application from "expo-application";

// App Attest (iOS) / Play Integrity (Android) wrapper — spec 3e. Expo's
// managed SDK doesn't expose these natively; a real build adds a small
// native module (e.g. `expo-app-attest` config plugin or a bare RN module
// wrapping DeviceCheck/Play Integrity) behind this exact function
// signature, so nothing else in the app needs to change.
export type AttestationOutcome = {
  passed: boolean;
  isEmulatorSuspected: boolean;
  isJailbrokenOrRooted: boolean;
};

export async function attestDevice(): Promise<AttestationOutcome> {
  const isEmulatorSuspected = !Device.isDevice;

  // Placeholder heuristic pending the native module: a real build calls
  // DCAppAttestService.attestKey (iOS) or the Play Integrity API's
  // requestIntegrityToken (Android), sends the resulting token to the
  // server for verification, and only then reports `passed`. Wiring the
  // server-side verification path is a small addition to
  // backend/src/modules/devices/routes.ts (see the comment on
  // RegisterDeviceSchema.passed).
  const passed = !isEmulatorSuspected;

  return {
    passed,
    isEmulatorSuspected,
    isJailbrokenOrRooted: false, // native jailbreak/root heuristics belong in the same native module
  };
}

export function currentDeviceInfo() {
  return {
    platform: Platform.OS === "ios" ? ("IOS" as const) : ("ANDROID" as const),
    deviceModel: Device.modelName ?? "unknown",
    osVersion: Device.osVersion ?? "unknown",
    attestationProvider: Platform.OS === "ios" ? ("APP_ATTEST" as const) : ("PLAY_INTEGRITY" as const),
    appVersion: Application.nativeApplicationVersion ?? "0.1.0",
  };
}
