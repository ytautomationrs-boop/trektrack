# ASTA Pools

+ → Pools. Independent of competitions and events.

## Rollout

The redesign, wallet ledger and signed Health sync are implemented.
POOLS_WALLET_ENABLED defaults off. Keep it off until the paid-entry model is
cleared for launch and build 9's Health + App Attest flow is verified on a
physical iPhone. Compilation is not that verification. Existing TEST Pools
remain test credits; they are never converted into wallet money.

## Rules

7–365 days, 2–50 people. Full Pools start next local midnight. Every daily target
must pass. Going above a target does not eliminate anyone else. One remaining
player wins once results are final; multiple finishers share equally, including
forfeitures. Remainder cents go one each in join order. If none finish, refund
all entries. No commission. Leaving before start refunds.

Walking steps, running/cycling/swimming kilometres, main sleep hours and optional
bed/wake deadlines. Sleep uses asleep duration, not time in bed, on its wake date.

## Wallet

ZAR buyIn/payout fields are integer cents; TEST uses whole nonwithdrawable credits.
Existing User.walletBalanceCents and LedgerEntry hold the financial records.
Pool/user locks, atomic transactions and unique references guard all movements.
STAKE_HOLD closes on leave/settlement; STAKE_REFUND and POOL_PAYOUT credit wallets.
Ledger externalProvider is asta-pools; descriptions name the Pool. Unsettled
wallet Pools block account deletion. Paid Pools reject all simulation endpoints.

## Health and integrity

Capacitor reads Apple-produced, non-manual activity. Steps use cumulative Health
statistics. Overlapping workouts are not counted twice. Sleep stages are merged
with awake gaps excluded. Only the owner sees their raw daily reports.

Wallet days have a 24-hour sync grace period. Current/prior-day snapshots have
strict server time/rate checks. HealthKit cannot distinguish denied read access
from absent data. Missing data is shown as Not synced. Permission, background
sync, overnight sleep and end-of-day settlement need physical-device validation.

Production App Attest enrollment validates Apple's attestation against ASTA's
team/bundle and a one-use five-minute challenge. Snapshots sign exact payloads
with another challenge; the server checks account-bound keys, signature and
increasing counters. The JS bridge does not expose arbitrary signing. There is
no fallback to the old self-reported device passed flag. App Attest mitigates
spoofed clients, but cannot prove every recorded physical activity is genuine.

## Simulation and checks

TEST remains available: fill players → jump to day 1 → enter totals → save all
and close day. Reports save together; missing entries block advancement. Enter
zero to simulate a missed goal. TEST does not wait for Health sync grace.

Pools engine/store tests run alongside Health competition and account-deletion
checks. PGlite tests exercise SQL transactions, wallet isolation, refunds,
settlements, private reports and real ECDSA assertion signatures. Physical Apple
attestation enrollment is still required before enabling wallet entry.

## Home and Play update (build 10)

Tabs are Home, Play, create, Social, and Profile. Play contains Pools, Competitions, and Events. Home excludes finished/withdrawn races, completed Pools, eliminated members, and TEST records. Only current challenge metrics appear. Display-only Health totals stay on the phone. Walking distance means recorded walking workouts, not estimated distance from steps.

The public Pools API accepts explicit ZAR creation only. It no longer registers simulation endpoints or returns test balances or records. Historical tests remain isolated and are never converted to rands. The paid rollout flag remains unchanged.

Health permissions and device verification are reused. Initial connection starts syncing in the background. Build 10 adds the native dailyActivity method and is required for Home activity readings.

Competition creation now accepts authenticated users, preserving fee validation, league rules, and wallet deductions. The old admin balance auto-top-up is removed.
