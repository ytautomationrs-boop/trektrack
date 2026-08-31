import { useSyncExternalStore } from "react";
import { AppStateMachine } from "./AppStateMachine";

// React binding for the state machine — re-renders the consuming component
// whenever any flow-state field changes (see `version` on the class) and
// hands back the singleton itself so callers can call its methods directly.
export function useAppState() {
  useSyncExternalStore(AppStateMachine.subscribe, () => AppStateMachine.version);
  return AppStateMachine;
}
