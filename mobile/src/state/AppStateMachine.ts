import { logout as clearPersistedSession } from "../api/client";
import { unregisterForPushNotifications } from "../notifications/register";

// Single logic class driving cross-screen flow state: onboarding progress
// and session. Screens are dumb consumers via the useAppState() hook below —
// they read state and call methods on this class, never mutating flow state
// directly. Deliberately separate from React Navigation, which owns *screen*
// transitions; this owns *business* flow state that outlives one screen.
//
// The daily-result and payout modals lived here under the pooled model.
// A race has no daily verdict to interrupt you with, and prizes land in the
// wallet rather than behind a celebration modal, so both are gone.

export type OnboardingStep = "intro" | "connect_health" | "permission_denied" | "pick_starter_metric" | "done";

// isAdmin gates whether Create is a live action during the pilot — see
// screens/create/CreateRaceScreen.tsx.
export type Session = { userId: string; displayName: string; email: string; avatarUrl: string | null; bio: string | null; isAdmin: boolean } | null;

type Listener = () => void;

class AppStateMachineImpl {
  private listeners = new Set<Listener>();

  /** Bumped on every mutation — the one piece of state useAppState() actually subscribes to, since useSyncExternalStore needs a primitive snapshot to compare. */
  version = 0;

  session: Session = null;
  onboardingStep: OnboardingStep = "intro";
  selectedStarterMetricKeys: string[] = [];

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // ── Session ──────────────────────────────────────────────
  setSession(session: Session) {
    this.session = session;
    this.emit();
  }

  logout() {
    // Deregister BEFORE the JWT is cleared — the call is authenticated, and
    // without it this device keeps receiving the signed-out account's race
    // results and payout amounts.
    unregisterForPushNotifications().finally(() => clearPersistedSession());
    this.session = null;
    this.onboardingStep = "intro";
    this.emit();
  }

  // ── Onboarding ───────────────────────────────────────────
  advanceOnboarding(next: OnboardingStep) {
    this.onboardingStep = next;
    this.emit();
  }

  selectStarterMetrics(metricKeys: string[]) {
    this.selectedStarterMetricKeys = metricKeys;
    this.onboardingStep = "done";
    this.emit();
  }

}

export const AppStateMachine = new AppStateMachineImpl();
