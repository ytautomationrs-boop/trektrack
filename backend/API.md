# Streak API

Base URL: `http://localhost:4000` (demo). All bodies are JSON. Authenticated
routes take `Authorization: Bearer <jwt>` from `/auth/login` or `/auth/signup`.

Amounts are always integer cents. Deposits run on Paystack TEST mode and
withdrawals on Paystack/PayPal sandbox only — see `src/lib/env.ts`.

**Wallet model**: real payment-provider transactions happen only at deposit
and withdrawal. Entry fees, prizes and refunds are pure
`User.walletBalanceCents` movements recorded in `LedgerEntry` — no external
call, no per-transaction fee. 1 token = 1 cent, the same unit as every other
`*Cents` field here.

## The one rule everything follows from

A race **does not exist** until exactly `entrantsRequired` entrants have
joined. While `FILLING`, no prize is owed and every fee is fully refundable.
The moment the last slot fills the race starts immediately, fees become
platform revenue, and the prize schedule becomes unconditional.

If signup closes short, the race is `CANCELLED_UNFILLED` and every fee is
refunded **in full** — no platform fee retained. That race never existed, so
there was no service to charge for.

Because a race starts the instant it fills, there is no gap between "full"
and "running", and therefore no withdrawal-before-start case to handle.

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/signup` | `{ email, password, displayName, timezone }` | Creates a user with `walletBalanceCents: 0`. Returns `{ token, user }`. No payment-provider call — everything up to a deposit works with zero Paystack configuration. |
| POST | `/auth/login` | `{ email, password }` | Returns `{ token, user }`. |
| GET | `/me` | — | Session restore on launch. Includes `walletBalanceCents`. |

## Metrics

| Method | Path | Notes |
|---|---|---|
| GET | `/metric-types` | The four active metrics: steps, running, cycling, swimming. Each carries `valueType` (COUNT / DISTANCE_METERS), `unit`, `icon`. **No targets of any kind** — a race ranks on a cumulative total, so there is no daily target, no min/max, and no pace target. Sleep is not a metric. |

## Devices & health connections

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/devices` | `{ platform, deviceModel, osVersion, attestationProvider, passed, isEmulatorSuspected, isJailbrokenOrRooted }` | Records an on-device App Attest / Play Integrity result. |
| POST | `/health-connections` | `{ provider, grantedScopes[] }` | Records a HealthKit / Health Connect permission grant. `provider` is `HEALTHKIT` or `HEALTH_CONNECT` (Google Fit's APIs are deprecated and unsupported). |
| POST | `/health-connections/:provider/revoke` | — | Called when the app detects permission was pulled. |

## Config discovery

| Method | Path | Notes |
|---|---|---|
| GET | `/race-types` | Every race format plus its per-league prize schedule. Public, no auth — a prize is only "pre-announced" if it is actually announced before entering. Includes formats the platform does not run publicly but users may create privately (`allowUserCreated`). |
| GET | `/leagues` | Returns `leaguesByMetric`, keyed by metric. A level number means nothing on its own — see "Leagues". |

## Races

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/races` | — | Query: `scope` (`my_league` default, or `all`), `metricKey`, `format`, `limit`. Public races only, at **your league for each metric**. `scope=all` includes other levels flagged `enterable: false`. |
| GET | `/races/:id` | — | Race + standings. `standingsAreProvisional` is true until resolved — mid-race ordering is never a final position. |
| POST | `/races` | `{ name, metricKey, durationDays, format, entryFeeCents?, visibility?, squadName?, squadJoinPolicy? }` | Creates a **private** race and enters the creator as racer 1, charging the race entry fee. `entryFeeCents` is optional and lets the host set the fee; prizes are calculated server-side from that fee. `durationDays` is 1 or 7. Field size and league are still resolved server-side. `visibility: "PUBLIC"` returns `400 public_race_not_user_creatable`. |
| POST | `/races/:id/enter` | `{ squadId?, squadInviteCode?, squadName?, squadJoinPolicy? }` | Debits the entry fee. Squad races need exactly one of the three squad fields. Returns `startedRace: true` if this entry filled the race. Errors: `402 insufficient_balance`; `400 race_not_open` / `already_entered` / `wrong_league` / `squad_full` / `no_squad_slots` / `squad_invite_only` / `invalid_squad_code`. |
| GET | `/races/by-code/:code` | — | Resolves a private race's invite code so an invitee can see format, fee and prizes before entering. |
| GET | `/race-squads/by-code/:code` | — | Same for a squad code, **without joining**. |
| GET | `/me/races` | — | The user's race history. |

### Who creates what

**Public** races are opened by the platform, one per (format × league), so
everyone in a league queues for the same ones and they can actually reach
their exact headcount. **Private** races are user-created and bring their own
entrants — the creator recruits them, so they never compete for the shared
public pool. That split is why users cannot create public races.

### Squad privacy

Squads are invite-only unless their captain opens them.

- `squadInviteCode` — the captain's shared 8-char code. Always admits you; the code is the permission.
- `squadId` — admits you **only** if that squad is `OPEN`. An invite-only squad returns `squad_invite_only`, so squad ids read off the listing are not a way in.
- `squadName` — founds a squad. `squadJoinPolicy` defaults to `INVITE_ONLY`.

A squad's `inviteCode` is only included for viewers already in that squad;
everyone else gets `null`.

## Evidence

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/race-entries/:id/samples` | `{ samples[] }` | Same `HealthSampleInput` shape and the same validators the anti-fraud pipeline has always used. Samples outside the race window or for another metric are rejected/ignored; a re-submitted sample is recognised by source id rather than counted twice. |
| POST | `/race-entries/:id/sync-strava` | — | Server-side pull for running/cycling races. Also runs hourly as a cron backstop, so an entrant who never opens the app still has real rides counted. |

Pace and GPS data are captured in full and checked for plausibility. What
does not exist is a user-facing pace *target* — races rank on distance or
count alone.

## Leagues

Tracked **independently per metric**. A user has four separate progressions —
steps, running, cycling, swimming — each with its own points and level, so
League 12 for running alongside League 1 for swimming is a normal state.
Points from a race only ever move that race's metric.

| Method | Path | Notes |
|---|---|---|
| GET | `/me/leagues` | All four standings plus `primaryMetricKey` (the metric this user races most). |
| GET | `/me/leagues/:metricKey` | One metric's standing: league, points, points to next promotion, band progress. |
| GET | `/me/league/history` | Point movements with before/after totals. Optional `?metricKey=` to narrow to one track. |

Points: **+5** for a win down to **−4** for last, spread linearly across the
field. 10 entrants → `5,4,3,2,1,0,-1,-2,-3,-4`; 4 squads → `5,2,-1,-4`, with
every squad member receiving the squad's points.

Totals are permanent (no reset, no decay, no admin adjustment) and floored at
zero. `currentLevel` never decreases — there is no demotion path in the code.
`qualifiedForUnopenedLevel` is set when a user has earned a league that has
not opened yet; they are promoted automatically when it opens.

**There is no global rank and no combined total anywhere in this API.** A
rank that sits flat or slides backwards during a bad run is the one progress
signal a user cannot improve by trying harder, and summing four independent
progressions would invent a number that describes nothing.

## Wallet

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/me/wallet` | — | `{ balanceCents, currency }`. |
| POST | `/me/wallet/deposit/intent` | `{ amountCents }` | Paystack hosted checkout; returns `authorizationUrl` + `reference`. |
| POST | `/me/wallet/deposit/confirm` | `{ reference }` | Re-verifies with Paystack before crediting — never trusts the redirect. Idempotent on the reference via a DB constraint. |
| POST | `/me/wallet/withdraw` | `{ amountCents, destination }` | Paystack Transfer or PayPal Payout (test/sandbox). |
| GET | `/me/wallet/payout-methods/paystack/banks` | — | Bank list for the withdrawal form. |
| POST | `/me/wallet/payout-methods/paystack/resolve` | `{ bankCode, accountNumber }` | Confirms whose account it is before the user commits. |

## Account

| Method | Path | Notes |
|---|---|---|
| GET | `/me/ledger` | Full wallet transaction history. |
| GET | `/me/stats` | `racesEntered`, `racesFinished`, `wins`, `podiums`, `totalWonCents`, `primaryMetric`. No rank. |

## Ledger types

| Type | Direction | When |
|---|---|---|
| `DEPOSIT` / `WITHDRAWAL` | user credit / debit | The only two backed by a real provider object |
| `RACE_ENTRY_FEE` | user debit | At entry — `PENDING` until the race starts |
| `RACE_ENTRY_REVENUE` | platform credit | At race start; recognised revenue |
| `RACE_PRIZE` | user credit | At resolution (`PENDING` if held for review) |
| `RACE_PRIZE_EXPENSE` | platform debit | Mirror of the above |
| `RACE_ENTRY_REFUND` | user credit | Race never filled |
| `ADJUSTMENT` / `DISPUTE_REVERSAL` | either | Manual correction |

The distinction that matters: a `RACE_ENTRY_REVENUE` credit is **not** held
against any prize obligation, and a `RACE_PRIZE_EXPENSE` would be the same
amount if that race's fees had been half or double. That is what makes
"revenue vs. pooled stake" answerable from the ledger alone.

## Anti-fraud backstop

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/reports` | `{ reportedUserId, raceId?, reason }` | Participant-filed report. |
| GET | `/admin/reports` | — | Open reports. |
| POST | `/admin/race-flags/:flagId` | `{ decision, reviewedBy? }` | `DISMISSED` or `CONFIRMED_CHEAT`. |

Prize money for an entrant with unresolved MEDIUM/HIGH flags is **held**
rather than paid, and released once flags clear or the hold window elapses.
The timeout release is deliberate: leaving a legitimately-won fixed prize
unpaid because nobody worked the queue would be the worse failure.

## Admin

No separate admin-role system exists in this demo — in production these would
sit behind an internal-only scope rather than a regular user JWT.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/races/fill-report` | Filled vs. cancelled per (race type × league). The number that says whether the league structure can support subdividing further. |
| GET | `/admin/leagues/readiness` | Qualified users vs. entrants needed, per (metric, level). Optional `?metricKey=`. |
| POST | `/admin/leagues/:metricKey/:level/open` | `{ force? }`. Opens one metric's level and promotes every user qualified for it in that metric. Refuses below the recommended threshold without `force`. |
| GET | `/admin/races/review-queue` | Open anomaly flags and held prizes. |
| POST | `/admin/race-entries/:id/disqualify` | `{ reason }`. Ranks the entrant last; the race still runs for everyone else. |
| POST | `/admin/race-prizes/:ledgerEntryId/forfeit` | `{ reason }`. Cancels a held prize. |

## Jobs (not HTTP)

Run in-process by `src/jobs/scheduler.ts`.

| Job | Cadence | What |
|---|---|---|
| `runRaceLifecycle` | 5 min | Cancel + refund unfilled races, resolve finished ones, release cleared prizes, open replacements |
| `runRaceStravaSync` | hourly | Server-side Strava pull for running races (per-application rate limit) |
| `pollPendingWithdrawals` | 2 min | Withdrawal status — no webhook receiver in dev, so status is pulled |

Races **start** inline in `enterRace()` the instant they fill, not on a tick.
