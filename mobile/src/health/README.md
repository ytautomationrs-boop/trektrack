> The installed Capacitor iPhone app now uses `ios/App/App/ASTAHealthPlugin.swift`. See the repository’s `APPLE-HEALTH.md`. The React Native adapter plan below is for the separate React Native build.

# HealthKit / Health Connect integration layer — plan

## Platform reality check (2026)

Google's Fit REST/Recording APIs are deprecated and being shut down; the
live Android path for third-party apps is **Health Connect** (which the
Google Fit app itself now writes into, along with Fitbit, Garmin, etc.).
`HealthProvider.GOOGLE_FIT` still exists in the schema for labeling/legacy
reasons, but the actual Android implementation here targets Health Connect
via `react-native-health-connect`. iOS targets HealthKit via
`react-native-health`.

## Architecture: one adapter interface, two platform implementations

```
mobile/src/health/
  types.ts            // HealthAdapter interface + shared sample shape (mirrors backend HealthSampleInputSchema)
  registry.ts          // resolves an adapter by DataSourceCategory + Platform at runtime
  adapters/
    healthkit.ts        // iOS — react-native-health
    healthConnect.ts     // Android — react-native-health-connect
  permissions.ts        // onboarding permission request/denial flow
  attestation.ts        // App Attest / Play Integrity wrapper (spec 3e)
  sync.ts               // orchestrates: read → attach corroboration → POST /participants/:id/samples
```

Every screen and the rest of the app talks to `HealthAdapter`, never to
`react-native-health` / `react-native-health-connect` directly. Adding a
fifth metric type (e.g. "run distance") means: add a `DataSourceCategory`
case to the relevant adapter method (usually a few lines, since HealthKit
and Health Connect both already expose the record type), not a new adapter.

```ts
// types.ts (shape)
interface HealthAdapter {
  requestPermissions(categories: DataSourceCategory[]): Promise<PermissionResult>;
  readDailyAggregate(category: DataSourceCategory, day: LocalDayWindow): Promise<RawSample[]>;
  // Cycling/swimming need the full workout session, not just a number —
  // spec 3c. Steps/sleep use readDailyAggregate.
  readWorkoutSessions(category: DataSourceCategory, day: LocalDayWindow): Promise<RawWorkoutSample[]>;
}
```

## Per-metric read plan

| Metric | iOS (HealthKit) | Android (Health Connect) | Anti-fraud data attached |
|---|---|---|---|
| Steps | `HKQuantityTypeIdentifierStepCount` daily sum, **plus** `CMPedometer.queryPedometerData` for the same window as corroboration | `StepsRecord` aggregate, **plus** `ActivityRecognition`/on-device step-detector count as corroboration where available | `corroboration.pedometerStepCount`, `corroboration.gaitConfidence` — validated server-side by `steps.pedometer_corroboration` |
| Cycling | `HKWorkoutActivityType.cycling` sessions via `HKWorkoutQuery`, requiring `HKWorkoutRoute` (GPS), `totalDistance`, `duration`, `HKQuantityTypeIdentifierFlightsClimbed`/elevation | `ExerciseSessionRecord` (type=EXERCISE_TYPE_BIKING) + `ExerciseRoute` + `DistanceRecord` | `corroboration.gpsRoute[]`, `elevationGainMeters`, `hasHeartRate` — validated by `workout.gps_route_required` |
| Swimming | `HKWorkoutActivityType.swimming` sessions, `HKQuantityTypeIdentifierSwimmingStrokeCount`, lap metadata | `ExerciseSessionRecord` (type=EXERCISE_TYPE_SWIMMING_POOL) + `SwimmingStrokesRecord` | `corroboration.strokeCount`, `poolLengthMeters` — validated by `workout.session_required` |
| Sleep | `HKCategoryTypeIdentifierSleepAnalysis`, preferring watch-sourced stage samples (`asleepCore/Deep/REM`) over phone `inBed`/`asleepUnspecified` | `SleepSessionRecord` with `SleepStageRecord` children, preferring records whose `Metadata.dataOrigin` is a wearable package | `isWearableSourced` flag drives `sleep.stationary_only_flag` anomaly rule server-side |

## Source metadata filtering (spec 3b) — where it happens

Both platforms expose per-sample provenance; the adapter maps it into the
shared `wasManualEntry` / `isWearableSourced` / `sourceBundleId` /
`sourceName` fields on every sample **before** it ever reaches the server:

- **HealthKit**: `sample.sourceRevision.source.bundleIdentifier` and
  `.name`. `wasManualEntry` = true when the source bundle id is the Health
  app itself (`com.apple.Health`) AND there's no paired `HKDevice` — that
  combination is HealthKit's own signal for "the user typed this in the
  Health app." A sample with a non-nil `HKDevice` (Watch, or a paired
  Bluetooth wearable) sets `isWearableSourced = true`.
- **Health Connect**: `record.metadata.dataOrigin.packageName` identifies
  the writing app. `wasManualEntry` = true when `dataOrigin.packageName`
  is Health Connect's own manual-entry UI package. `isWearableSourced` is
  derived from `record.metadata.device?.type` (`TYPE_WATCH`, etc.).

The server independently re-rejects `wasManualEntry: true` regardless of
what the client sends (`modules/health/validators`), so a compromised or
modified client can't just flip the flag — see next section.

## Defense in depth against a modified client

A user can, in principle, run a patched build of this app that lies about
`wasManualEntry`/`corroboration`. Three independent layers make that not
worth the effort for a small stake, per spec 3g:

1. **App Attest / Play Integrity** (`attestation.ts`) runs at every
   `/participants/:id/samples` call and the server rejects samples from a
   device that fails attestation or looks like an emulator/rooted device
   (`Device.attestationStatus`, `isEmulatorSuspected`, `isJailbrokenOrRooted`
   in the schema).
2. **Server-side validators** re-derive plausibility from the corroboration
   payload itself (pace vs. GPS distance/time, gait confidence threshold)
   rather than trusting a boolean — see `backend/src/modules/health/validators`.
3. **Statistical anomaly detection + human review queue** catch what slips
   past both of the above — a device that passes attestation and sends
   internally-consistent-but-fabricated corroboration data still has to
   beat the user's own historical baseline, which is much harder to fake
   convincingly over a multi-week challenge than a single day.

None of this is "perfect verification" — HealthKit/Health Connect will
ultimately trust whatever a sufficiently sophisticated spoofing tool writes
into them. The goal, per spec, is layered friction proportionate to the
stake size, same approach StepBet uses in production.

## Permission-denied / revoked-mid-challenge handling

- Onboarding (`screens/onboarding`) shows a simulated "connecting…" state
  then a permission-denied fallback screen that explains steps/sleep/etc.
  can't be verified without the connection and offers Settings deep-link +
  retry, per spec 5.
- `sync.ts` calls `POST /health-connections/:provider/revoke` the moment a
  read fails with a permissions error (not a data error), so the backend's
  daily verification job can tell "revoked" apart from an ordinary
  `SYNC_ISSUE` in copy/notifications shown to the user (spec 2 edge case).
