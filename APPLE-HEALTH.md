# Apple Health competitions

The installed Capacitor iPhone app uses `ASTAHealthPlugin.swift`, not the legacy React Native Health adapter. Build 3 introduces the native bridge and requires a new Xcode installation; a web deployment alone cannot grant HealthKit access.

- Read-only Steps permission, requested only after Connect Apple Health.
- Today’s steps stay on the phone. Only cumulative totals for the signed-in user's entered, running step competitions go to the server.
- Automatically recorded Apple device sources are used. Manual entries and third-party writers are excluded. HealthKit cumulative statistics merge phone/Watch overlap.
- Background HKObserverQuery is registered at app launch. Hourly background delivery is requested; iOS controls actual delivery, and force-quitting/locked data/network outages can delay it. Foreground refresh and an active dashboard refresh every minute provide catch-up.
- Each sync rereads the complete race window. Repeated syncs replace one entry snapshot; older requests cannot roll it back. Newer Health corrections may decrease the total. If Health returns no readable data, retain the previous server total rather than treating a revoked permission as zero.
- Apple does not disclose read-permission denial. A completed permission prompt is not proof that steps can be read. The dashboard distinguishes no readable data and last successful sync.
- Race standings and final scoring use the snapshot instead of adding legacy step imports on top. Other metrics keep their existing scoring.
- A two-hour final sync window precedes step-race resolution, to accommodate batched Health delivery. The original activity finish time remains strict. No changes to completed results.
- Build 4 moves the step dashboard to the Activity tab and removes the personal daily goal. Social → Your profile contains identity editing and posts. Activity retains race history, created competitions, wallet, and settings.
- Sign-out/account switching disables sync and clears native Health session state. Session credentials use device-only Keychain storage. Disconnect stops Health observers/background delivery; prior competition evidence remains part of the race record. Account deletion cascades snapshots with entries.
- The endpoints enforce ownership, race status, exact start/end bounds, plausible total cadence, and stale-request protection. These are device-reported totals, not cryptographic proof of Health provenance. The previous client-supplied pedometer comparison could not validate Apple Watch steps left on a wrist while the phone stayed at home. Strong App Attest / anti-cheat controls remain separate work before relying on this as tamper-proof cash-prize evidence.

## Validation

Backend route tests cover ownership, replacement/idempotency, stale writes, downward corrections, closed races, and invalid windows/counts. Scoring tests cover snapshot precedence. A sync-window test covers the two-hour step-only grace. The iOS release build and provisioning profile include HealthKit and background delivery entitlements.

Physical-device checks still required: allow Steps, compare dashboard with Apple Health (manual/third-party steps are intentionally excluded), take a short walk, background and reopen ASTA, check a running race and its provisional ranking, and test denial/disconnect. Background delivery cannot be validated with the browser fixture or simulator. Never create fake competition evidence in production for testing.
