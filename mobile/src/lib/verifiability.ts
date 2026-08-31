import { Platform } from "react-native";
import { showAlert } from "./alert";

/**
 * Whether a metric can be scored on the platform the user is actually on.
 *
 * There are two evidence paths, and they cover different things:
 *
 * 1. **A workout file** the user exports from a watch or training app
 *    (see backend/src/modules/imports/workoutFile.ts). Available everywhere,
 *    including the browser. A workout file describes an ACTIVITY, so it
 *    covers running, cycling and swimming — any pool-capable watch records a
 *    swim — but NOT steps or sleep, which are daily totals a phone
 *    accumulates rather than something a watch writes a file for.
 *
 * 2. **The device health store** (HealthKit / Health Connect), which reads
 *    everything including steps and sleep. Native only: a browser has no
 *    health store, which is the whole reason path 1 exists.
 *
 * So the answer genuinely depends on the platform, and on whether the screen
 * asking has a health sync wired up at all — which is why `hasHealthSync`
 * is a parameter rather than assumed. Today the StreakPot detail screen has
 * one and the race screen does not.
 */
export const IMPORTABLE_METRICS = ["running", "cycling", "swimming"];

/** True when nothing available here can score this metric. */
export function isUnverifiable(metricKey: string, opts: { hasHealthSync?: boolean } = {}): boolean {
  if (IMPORTABLE_METRICS.includes(metricKey)) return false;
  // Steps and sleep: only the health store reaches them, and only natively.
  return !(opts.hasHealthSync && Platform.OS !== "web");
}

function listMetrics(keys: string[]): string {
  if (keys.length === 1) return keys[0]!;
  return `${keys.slice(0, -1).join(", ")} and ${keys[keys.length - 1]}`;
}

/**
 * Gate on paying to enter something that cannot be scored here.
 *
 * The detail screens carry a warning card, but a card is passive: it sits
 * above a prize table with the Enter button far below it, and the races list
 * had no warning at all — one tap there took the entry fee outright. Either
 * way someone could pay for a competition their total would stay at zero in,
 * having read nothing.
 *
 * A confirmation rather than a block, because a race entry stays refundable
 * for a full refund until the race locks, and someone may be entering
 * knowing they will finish it on their phone. What it must not be is
 * accidental.
 */
export function confirmVerifiable(
  metricKeys: string[],
  costLabel: string,
  onProceed: () => void,
  opts: { hasHealthSync?: boolean } = {}
) {
  const unverifiable = [...new Set(metricKeys.filter((m) => isUnverifiable(m, opts)))];
  if (unverifiable.length === 0) {
    onProceed();
    return;
  }

  const reason =
    Platform.OS === "web"
      ? `there's no such file for ${listMetrics(unverifiable)} — it's a daily total rather than a recorded activity, and a browser can't read your phone's health data.`
      : `there's no such file for ${listMetrics(unverifiable)}, and this screen can't read it from Health either.`;

  showAlert("This can't be scored here", `Streak scores from a workout file you export from your watch or training app, and ${reason} Your total would stay at zero.`, [
    { text: "Not now", style: "cancel" },
    { text: `Enter anyway · ${costLabel}`, onPress: onProceed },
  ]);
}
