import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { registerPushToken, deregisterPushToken } from "../api/client";

/**
 * Push-notification registration.
 *
 * Every failure path here is non-fatal by design. Notifications are a
 * convenience layer over a product that has to work without them — someone
 * who denies the permission prompt, uses a browser with no push support, or
 * runs a build with no project id must still be able to race, stake, check
 * in and get paid. So nothing in this module throws to its caller; it
 * reports what happened and the app carries on.
 *
 * ## Web needs VAPID keys
 *
 * On web, Expo issues a push token via the browser Push API, which requires
 * a VAPID key pair configured on the Expo project. Without it,
 * getExpoPushTokenAsync throws and this returns "unsupported" — which is the
 * honest state for the pilot until those keys exist. See DEPLOYMENT.md.
 *
 * Note also that iOS Safari only delivers web push to a site the user has
 * added to their home screen as a PWA. Desktop and Android browsers do not
 * have that restriction.
 */

export type PushRegistrationResult =
  | { status: "registered"; token: string }
  | { status: "denied" }
  | { status: "unsupported"; reason: string };

let cachedToken: string | null = null;

// Show notifications while the app is in the foreground too. Without this,
// Expo's default is to deliver silently when the app is already open — which
// for a check-in reminder means the person most likely to act on it is the
// one who never sees it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;

    if (!granted && existing.canAskAgain) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return { status: "denied" };

    // projectId is required by Expo's push service to route a token. It comes
    // from app.json's `extra.eas.projectId` once the project is linked to
    // EAS; before that it is genuinely absent rather than wrong, so this
    // reports unsupported instead of guessing.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

    await registerPushToken(token, Platform.OS === "ios" ? "IOS" : Platform.OS === "android" ? "ANDROID" : "WEB");
    cachedToken = token;
    return { status: "registered", token };
  } catch (err: any) {
    // The common causes are all environmental rather than bugs: no VAPID key
    // on web, no projectId, a simulator with no push entitlement.
    return { status: "unsupported", reason: err?.message ?? "Push notifications aren't available here." };
  }
}

/**
 * Stops this device receiving the signed-out account's notifications.
 *
 * Worth doing properly: without it, a shared or handed-on device keeps
 * delivering someone else's race results and payout amounts to whoever holds
 * it next.
 */
export async function unregisterForPushNotifications(): Promise<void> {
  if (!cachedToken) return;
  try {
    await deregisterPushToken(cachedToken);
  } catch {
    // Best-effort. The backend also prunes tokens Expo reports as
    // DeviceNotRegistered, so a missed deregistration self-heals.
  } finally {
    cachedToken = null;
  }
}
