# StreakPot — pooled-stake challenges

The original Streak model, reintroduced alongside the fixed-prize race model
as a free, zero-commission engagement layer. See
`../races/README.md` for the other half, and the header of
`prisma/schema.prisma` for why the two coexist rather than merge.

## The shape of it

Everyone stakes the same fixed amount. Each day you have to hit a daily
target — several, for a multi-metric challenge, and every one has to pass for
the day to count. Miss a required day and you're eliminated; your stake moves
into the pool. At the end, whoever finished splits the whole pool evenly.

**Zero platform commission is structural, not a setting.** Look at
`LedgerEntryType` in the schema: races have a `*_REVENUE` / `*_EXPENSE` pair
for every movement, because a race entry fee becomes platform revenue and a
prize is a platform liability. StreakPot has no such pair. Every cent staked
either returns to the person who staked it (`STAKE_REFUND`) or moves to
another participant (`POOL_PAYOUT`) — there is nowhere in the enum for the
platform to take a cut. The smoke suite asserts the platform balance is
unchanged across a full stake → forfeit → payout cycle rather than trusting
the code to be honest about it.

The redemption fee works the same way: it's charged to the buyer and folded
into the pool, never kept.

## Why the creator sets the stake here, but not a race's entry fee

A race's prize is a platform liability fixed before anyone enters, so letting
a creator set it would make the prize a function of what entrants paid in —
the exact structure the race model exists to avoid. A challenge's pot is just
the participants' own money redistributed among themselves, so there is no
house edge to protect against and no reason to withhold the controls.

## Anti-fraud

Challenge check-ins run the same stack as races: `runValidation` on the way
in (manual-entry rejection, pedometer corroboration, GPS-route requirements)
and `runAnomalyDetection` against the submitter's personal baseline.

**Evidence is retained.** `ChallengeHealthSample` mirrors
`RaceHealthSample`: every accepted sample is stored against the participant
and the day's check-in, with the same re-sync duplicate guard, so a disputed
day has the underlying activity behind it rather than one computed total.
Flags raised go into `ChallengeAnomalyFlag` and surface at
`GET /admin/challenges/review-queue`.

Note that scoring is **not** derived from these rows.
`DailyMetricResult.actualValue` is still computed from the submitted payload
and replaces the previous value on each submission — races sum their stored
samples, challenges do not. Storing evidence deliberately didn't change how a
day is scored.

**The baseline spans both models.** `personalBaseline()` reads race *and*
challenge evidence, because a person's activity history is the same history
wherever it was logged. Before challenge samples were persisted this could
only see race data, so anyone who had only ever done challenges had a
permanently empty baseline — and `baselineSpike` needs three or more values
to fire at all, so it never did for them.

### ⚠️ Still open: flags don't gate a payout

An open flag on a race holds the **prize** until review clears it. There is
no equivalent here, and the reason is a genuine design question rather than
missing work:

A held race prize is a platform liability that simply isn't paid — nobody
else's money is involved. A pool share is *other participants' money that has
already been divided*. So "holding" one has no obvious resolution: if the
share is ultimately forfeited, does it go back to the other finishers
(changing what they were already told they'd won), or back to whoever staked
it (rewarding the eliminated)?

Until that's decided, flags are recorded and surfaced, and a human acts on
them through disqualification before resolution rather than the system
silently gating money. **Worth deciding before StreakPot stakes get large.**

## Squad challenges do not exist yet

`Challenge.mode` has a `SQUAD` member and `eliminationScope` has
`WHOLE_GROUP`, but there is no `ChallengeSquad` entity — no slots, no
captain, no invite code — so squads cannot be formed and `WHOLE_GROUP` has
nothing to scope to. Creation refuses `SQUAD` (see `schemas.ts`), and
`eliminateParticipant` deliberately does not cascade. Building it means
adding that entity first, mirroring `RaceSquad`.

## Files

| File | What |
|---|---|
| `service.ts` | Create, join, withdraw, invites, the decorated payload |
| `scoring.ts` | Daily check-in ingestion, pass/fail, cutoff finalisation |
| `resolution.ts` | Start, eliminate, redemption, the zero-cut pool split |
| `reminders.ts` | The daily "you haven't checked in" nudge |
| `stravaSync.ts` | Server-side Strava pull — the only web-reachable evidence |
| `routes.ts` | HTTP surface, including `/streakpot/metric-types` |
