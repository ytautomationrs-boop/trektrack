# Fixed-prize races

The app's only competition model. It replaced a pooled-stake model
(challenges, stakes, pots, tiers, daily targets, streaks, redemption), which
has been removed entirely — schema, code, screens and ledger types.

## Why it is shaped this way

The old model collected every entrant's stake into a pot and split that pot
among finishers. The payout was a function of who entered: change the turnout
and every payout changed. That structure resembles a **totalisator**, a
licensed category in most jurisdictions.

This model sits outside that classification, on the same footing as a paid
amateur sports race — a mountain-bike race pays its advertised purse whether
30 or 300 people show up:

| | Old pooled model (removed) | Fixed-prize races |
|---|---|---|
| Headcount | Open-ended | **Exactly N**, always |
| Prize source | The entrants' own pooled stakes | A standing schedule set in advance |
| Prize depends on turnout | Yes, directly | **No** — identical every time |
| Entry fee is | An escrowed stake | **Platform revenue** at race start |
| Who carries downside | Nobody (payout bounded by pot) | **The platform** |
| Scoring | Pass/fail vs a daily target | **Ranked** on an aggregate total |

The last row of that table is the honest one to keep in view: with a fixed
purse the platform can lose money on a race. That is not a defect, it is what
distinguishes a prize from a pot — see *Margin* below.

## The existence condition

This is the load-bearing rule, and most of the design follows from it.

A race **does not exist** until exactly `entrantCount` entrants have joined.
While `status = FILLING`:

- no prize is owed to anyone
- entry fees are held as `RACE_ENTRY_FEE` / `PENDING` — debited from the
  wallet, but not recognised as revenue
- if the signup window closes short, the race is `CANCELLED_UNFILLED` and
  **every fee is refunded in full**, with no platform fee retained

The moment the Nth entrant joins, `startRace()` runs inline in the same
transaction: status flips to `RUNNING`, the fees become revenue, and the
prize schedule becomes an unconditional obligation.

**Withdrawal before start** — flagged in the brief as a possible edge case.
It does not exist here, by construction: the race starts the instant it fills,
so there is no window between "full" and "running" for anyone to leave. This
is why `enterRace()` starts the race itself rather than leaving it to a job.

**Mid-race removal** — a confirmed cheat is disqualified (`disqualifyEntry`),
ranked last, and forfeits their fee. The race is **not** voided and does not
lose its field: nine honest entrants should not lose their contest because a
tenth cheated. The existence condition was met when the race filled; it is
not re-evaluated afterwards.

### Concurrency

"Exactly N" cannot be a count-then-insert — two concurrent tenth entrants
would both read nine and both insert. Every entry takes a row lock on the
race first (`SELECT ... FOR UPDATE` in `enterRace`), which serialises entries
to the same race. Entries to different races never contend. The fill check is
`entrantsNow === entrantsRequired`, strictly equal and never `>=`.

## Ledger: revenue vs. pooled stake

The existing `LedgerEntryType` values all carry pooled-stake semantics, so
races add their own rather than overloading them:

| Type | Direction | When |
|---|---|---|
| `RACE_ENTRY_FEE` | user debit | at entry — `PENDING` until the race starts |
| `RACE_ENTRY_REVENUE` | platform credit | at race start; recognised revenue |
| `RACE_PRIZE` | user credit | at resolution (or `PENDING` if held for review) |
| `RACE_PRIZE_EXPENSE` | platform debit | mirror of the above |
| `RACE_ENTRY_REFUND` | user credit | race never filled |

`LedgerEntry` gained one nullable `raceId` column. It is deliberately not a
reuse of `challengeId` — every existing query filters on `challengeId`, and a
race entry must never be miscounted as pooled-challenge activity.

The distinction the brief asked for is answerable from the ledger alone: a
`RACE_ENTRY_REVENUE` credit is not held against any prize obligation, and a
`RACE_PRIZE_EXPENSE` debit would be the same amount if that race's fees had
been half or double.

### Margin

`seedRaces.ts` refuses to seed a schedule paying out more than
`MAX_PRIZE_TO_REVENUE_RATIO` (85%) of a full race's entry revenue. Launch
schedules run at a 20–25% margin:

| Format | Field | Entry | Revenue | Prizes | Margin |
|---|---|---|---|---|---|
| Steps 7d solo | 10 | R50 | R500 | R400 | 20% |
| Steps 1d solo | 10 | R25 | R250 | R200 | 20% |
| Steps 7d squad | 4×4 | R50 | R800 | R600 | 25% |

For reference, the schedule sketched in the brief (R500/300/150/100/50 =
R1,100) needs a R110 entry fee just to break even at 10 entrants.

## Squad privacy

Squads are **invite-only by default**. Founding one produces a shareable
8-character code; opening the squad to anyone in the race is an explicit
opt-in (`squadJoinPolicy: "OPEN"`).

Three ways in, and the access rule is the point:

| Given | Admits you when |
|---|---|
| `squadInviteCode` | always — the code *is* the permission |
| `squadId` | only if that squad is `OPEN` |
| `squadName` | founds a new one, `INVITE_ONLY` unless you opt out |

The default is closed because the two mistakes are not symmetric. A captain
who wanted an open squad and got a private one shares a code; a captain who
wanted a private squad and got an open one has already lost a seat — and in a
squad race a passenger costs the other three the prize, since every member's
activity feeds one aggregate.

`inviteCode` is only returned to someone already in that squad
(`decorateRace`). Returning it to every viewer would make "invite-only"
decorative — anyone could read a code off the listing and let themselves in.
Non-members still see the squad exists and that it is locked.

`GET /race-squads/by-code/:code` resolves a code to the squad, race, fee and
prize schedule **without joining**, so an invitee can see what they are
committing to before any money moves.

Deliberately simpler than the pooled model's `ChallengeInvite`: one code per
squad rather than per-invitee rows to issue, revoke and expire. A squad race
is a single short-lived contest, not a standing roster, so that machinery
would not earn itself here.

## Leagues

Tracked **independently per metric**. A user has four separate progressions —
steps, running, cycling, swimming — each with its own point total, level and
promotion history. Someone can sit in League 12 for running and League 1 for
swimming simultaneously, and both are correct: races are single-metric, so
ability in one says nothing about another.

That follows from the model rather than being bolted onto it. If a race is
always one metric, a league that mixed them would rank people on a number
nobody actually competed for.

| Table | Key | Why |
|---|---|---|
| `LeagueLevel` | `(metricKey, level)` | A level is only meaningful within a metric |
| `UserLeagueState` | `(userId, metricKey)` | Up to four rows per user, created lazily |
| `RacePointEntry` | carries `metricKey` | Point history readable per metric without a join |

**Thresholds** are seeded identically across all four metrics today — same
names, same 15-point bands — so they behave like shared configuration. They
are *stored* per metric so one can be retuned later (swimming promoting
faster because the field is thinner, say) without a migration.

**`isOpen` is why the table had to be per-metric at all.** It is the
fill-rate valve, and readiness is inherently per-metric: steps may have
plenty of racers while swimming has almost none. "League 2 is ready" for
steps says nothing whatsoever about swimming.

**New users** start at the base league in every metric. No row is written
until they first touch that metric — an absent row and a League-1/zero-point
row mean the same thing, and lazy creation collapses them.

There is **no combined total** and no global rank. Summing four independent
progressions would invent a number that describes nothing.

### The points scale

Points per finishing position, spread linearly from **+5 for a win** to
**−4 for last**, whatever the field size. One formula reproduces both scales
in the brief exactly:

- 10 entrants → `5, 4, 3, 2, 1, 0, -1, -2, -3, -4`
- 4 squads → `5, 2, -1, -4` (every member of a squad gets the squad's points)

Pinned in `config.test.ts`, because a mistake here is invisible at runtime —
nothing throws, users just quietly end up in the wrong league forever.

**Permanent.** `UserLeagueState.totalPoints` is written only by
`applyRaceResult()`, only with a delta from a race result. No reset, no decay,
no season rollover, no admin adjustment path. Every movement is audited in
`RacePointEntry`.

**Floored at zero.** The stored total never goes negative, though the audit
row records the un-floored delta (a −4 against a 2-point total records
`points: -4, before: 2, after: 0`).

**No demotion, ever.** `currentLevel` is only ever assigned via `Math.max`
against its current value. There is no code path that lowers it.

### Why narrow leagues

15-point bands. Two firsts plus a couple of top-4 results promotes:

```
two wins                   = 10   not yet
two wins + a 3rd           = 13   not yet
two wins + a 3rd + a 4th   = 15   promoted
```

Frequent visible promotions, rather than one slowly-moving number that can
sit flat through a bad run.

### The `isOpen` gate — and why it is not a demotion

With permanent points and no demotion, the earliest and most active users
promote out of League 1 within weeks. At launch volume League 2 would then
hold five people and its races would never fill — stranding exactly the users
who earned their way there.

So `qualifiedLevel` (what your points entitle you to) is tracked separately
from `currentLevel` (where you actually are). Points accrue and thresholds
apply from day one; a level is only *opened* once enough qualified users
exist to fill its races, and opening promotes everyone qualified at once.

This never demotes anyone: a closed league is not somewhere anyone was
standing. `openLeagueLevel()` refuses to open a level below its recommended
qualified-user count without an explicit `force`.

### No global rank

There is no numeric global position anywhere — not in this module, and it was
**removed from the pooled model too** (`GET /me/stats` used to return one and
`ProfileScreen` rendered it as `#412`). A rank that sits flat or slides
backwards during a bad run is the one progress signal a user cannot improve
by trying harder in the short term.

Per-challenge placement on history cards ("#3 of 12") is unaffected — that is
a result within one contest the user entered, not a standing among all users.

## Scoring

**Pure aggregate total.** Sum the single metric over the race window, rank
highest first. No target, no daily pass/fail, no elimination, no partial
credit. Ties break by entry order.

**Single metric, by construction.** `RaceType` carries one `metricKey`, not a
list — the model cannot express a mixed-metric race, because there is no
fair way to weight swum metres against run metres in one ranked ordering.

**Sleep is excluded** from races and leagues entirely, enforced by
`RACE_ELIGIBLE_METRIC_KEYS` at seed time and again at race creation. It
remains available to the pooled model.

### Timezones

A race window is a single shared UTC interval, so every entrant races the
identical number of seconds. This is the correct analogue of the pooled
model's timezone locking, not a weakening of it: local day boundaries are
right for a pass/fail day, but in a ranked race they would hand whoever is
furthest west extra hours at the edges. `RaceEntry.timezone` is still locked
at entry, and still used for the anomaly baseline and for display.

### Priority allocation is deliberately not applied

`lib/allocation.ts` splits one real activity total across overlapping
same-metric challenges. Races are excluded in both directions.

In a pass/fail pot, an allocated share only affects whether you personally
cleared a target. In a ranked contest for a fixed prize it would score you on
a partial total against rivals on full totals — a structural disadvantage,
invisible to the user, caused by an unrelated challenge they happen to be in.

Accepted consequence: a user in two concurrent steps races has the same steps
counted toward both. Each prize is fixed and independent, so this is not
double-dipping a shared pot, and the alternative (one active race per metric)
would cut fill rates where they are already the binding constraint.

## Anti-fraud

Reused unchanged, operating on plain objects rather than rows:
`runValidation` (manual-entry rejection, pedometer corroboration, GPS routes),
`runAnomalyDetection` (baseline spikes, pace plausibility), Strava, device
attestation, and the re-sync duplicate guard.

Two things that needed attention:

1. **`generic.threshold_hugging` and `performance.target_barely_met` are
   meaningless here** — there is no threshold to hug. `AnomalyContext.target`
   is now optional and those rules skip themselves rather than being fed a
   fabricated number. Every other rule applies unchanged.
2. **Races create a cheat incentive the pooled model doesn't have**: beating
   second place by a hair. Prize money for an entrant with unresolved
   MEDIUM/HIGH flags is **held** rather than paid, and released once flags
   clear or the hold window elapses. The timeout release is deliberate —
   leaving a legitimately-won fixed prize unpaid forever because nobody
   worked the queue would be the worse failure.

The anomaly baseline is drawn from **both** models' evidence tables. A user's
real activity history is the same history whichever model logged it, and a
baseline computed from half of it is easier to walk past.

## Fill rate is the binding constraint

Every `(race type × league × duration)` is a separate pool needing its exact
headcount. Four metrics × two durations × three leagues is 24 pools needing
240 concurrent signups for one round of everything.

At launch volume (< 50/week) that means: **one open league, three active race
types, all on steps.** The other race types are seeded as inactive rows —
switching one on is a DB flag, not a deploy.

`GET /admin/races/fill-report` reports filled vs. cancelled per pool. A low
fill rate anywhere is the signal *not* to add leagues or race types, since
each one divides the same entrants further. `ensureOpenRaces()` keeps exactly
one FILLING race per pool for the same reason — two would split the queue and
could leave both short.

## What was NOT reused, and why

- **`lib/allocation.ts`** — see above.
- **`HealthSample`** — its `participantId` is a required FK to
  `ChallengeParticipant`; making it nullable would loosen a constraint the
  pooled model relies on. `RaceHealthSample` duplicates the *table shape*, not
  the pipeline — validation and anomaly logic are genuinely shared.
- **`EscrowStatus`** — pooled-stake semantics. There is no escrow here.
- **Tier-eligibility gating** — the brief asked to reuse this. **It does not
  exist in the codebase.** `ChallengeTier` only selects which target preset
  populates a metric requirement; nothing blocks an experienced user from a
  beginner challenge. Moot for this model, since leagues replace tiers and
  everyone starts at League 1 — but worth knowing it was never built.

## Files

| File | What |
|---|---|
| `config.ts` | Platform-wide policy: points scale, floor, bands, guardrails |
| `leagues.ts` | Points, promotion, the `isOpen` gate, standings |
| `service.ts` | Race creation, entry, atomic fill/start, refunds |
| `scoring.ts` | Sample ingestion, aggregation, live standings |
| `resolution.ts` | Ranking, fixed prizes, points, prize holds |
| `routes.ts` | HTTP surface, including `/admin/*` |
| `schemas.ts` | Zod request schemas |
| `config.test.ts` | Points scale and promotion cadence |
| `../../../scripts/smoke-races.ts` | End-to-end run against a live server (`npm run smoke:races`) |
| `../../../scripts/cleanup-smoke.ts` | Removes smoke data, refusing to touch real users (`npm run smoke:clean`) |
| `../../jobs/raceLifecycle.ts` | Cancel → resolve → release → reopen tick |
| `../../../prisma/seedRaces.ts` | Leagues, race types, prize schedules |

## Running it

```bash
npm run prisma:migrate
npm run seed && npm run seed:races
npm run dev
```

`seed:races` must run after `seed` — race types reference metric types.
