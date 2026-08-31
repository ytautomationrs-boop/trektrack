# Streak

Two competition models in one app, deliberately kept separate because they
do different things with people's money.

**Competitions** — fixed-prize races. You enter against an exact number of
other people, everyone pays the same fixed entry fee, and the prizes are
published before you enter. Finish highest on total steps, distance run,
cycled or swum over the race window and you win. Finishing position also
awards permanent league points, which promote you into higher leagues.

**Pool (StreakPot)** — pooled-stake challenges. Everyone stakes the same
amount and has to hit a daily target every day. Whoever finishes splits the
entire pool, **with zero platform commission** — every cent staked either
comes back to the person who staked it or moves to another participant.

Payments run on **Paystack / PayPal TEST and sandbox mode only**.

> **Compliance note — races**: prizes are fixed and pre-announced, and are
> the same whether the race brought in more or less than they cost. They are
> not a pool of entrants' fees divided among winners. That distinction is
> the point of the model — it puts a race on the same footing as a paid
> amateur sports event paying an advertised purse regardless of turnout,
> rather than a totalisator. Any change that makes a prize a function of
> entries collected undoes it. See `backend/src/modules/races/README.md`.
>
> **Compliance note — StreakPot**: this model *is* a pooled structure by
> design; the payout is a function of who stays in. Zero commission is what
> makes it fair between participants, but it does not change the structure.
> Because the race model was specifically architected to avoid that
> classification, reintroducing a pooled model alongside it is worth a real
> legal opinion before taking money from anyone.

## Current status: invite-only pilot

The app is being run as a **closed web pilot** rather than published to the
app stores. That shapes several things:

- **No public signup.** Account creation requires a valid `InviteCode`.
- **Only admins create races and challenges.** The Create tab is visible but
  gated (`User.isAdmin`), so pilot content is seeded through the normal UI.
- **Web can only verify running and cycling.** A browser has no health store,
  so Strava is the only evidence source and it covers nothing else. The app
  warns before anyone stakes on a metric it cannot verify for them. See
  `DEPLOYMENT.md`.
- **Squad challenges are refused.** The backend has `mode: SQUAD`, but there
  is no squad entity for challenges yet, so creation rejects it rather than
  producing something nobody could take part in.

Deployment lives in **`DEPLOYMENT.md`**.

## How races work

- A race has an **exact required headcount** — 10 racers, or 4 squads of 4.
  It does not exist until that many have entered.
- If a race never fills, it doesn't run and **every entry fee is refunded in
  full**.
- The moment it fills it starts, and the prize commitment becomes
  unconditional.
- Entrants are ranked on their **cumulative total** for a **single metric**.
  No daily targets, no streaks, nothing to miss.
- Finishing position awards points: 1st +5 down to last −4. Points are
  permanent and never reset. Crossing a threshold promotes you a league;
  **there is no demotion**.
- **Public races** are opened by the platform, one per format per league, so
  everyone queues for the same ones and they actually fill.
- **Private races** are created by users, who invite their own entrants with
  a share code.

Race metrics are **steps, running, cycling and swimming**. Sleep is not one —
it cannot be raced fairly (more sleep is not a better performance).

## How StreakPot works

- Everyone stakes the **same fixed amount**, set by whoever created the
  challenge.
- Each day you have to hit a **daily target**. A multi-metric challenge has
  several, and every one of them has to pass for the day to count.
- Miss a required day and you're **eliminated** — your stake moves into the
  pool for whoever finishes.
- A **redemption** can be bought once per challenge to forgive one missed
  day. That fee also goes into the pool; Streak never keeps it.
- At the end, finishers split the whole pool evenly. **If nobody finishes,
  everyone gets their own stake back** — there is no one to pay it to.

StreakPot adds **sleep** as a metric, which races exclude. A personal daily
sleep target is perfectly fair; ranking people on it would not be.

Unlike a race, the creator *does* set the stake and the targets. That is not
an inconsistency: the pot is just the participants' own money redistributed
among themselves, so there is no house edge to protect against. A race's
prize is a platform liability fixed in advance, which is exactly why a race
creator can't touch its fee or prizes.

## Stack

- **Mobile + web**: React Native + Expo (TypeScript) — one codebase for iOS,
  Android *and* the web pilot via React Native Web, with
  `react-native-health` (HealthKit) and `react-native-health-connect`
  (Android's current health-data platform; Google Fit's own APIs are
  deprecated — see `mobile/src/health/README.md`). Those two are native-only
  and are kept out of the web bundle by Metro platform resolution
  (`src/health/registry.web.ts`).
- **Backend**: Node.js + TypeScript + Fastify + Prisma/PostgreSQL.
- **Payments**: Paystack (deposits, bank withdrawals) and PayPal (payouts),
  test/sandbox only, enforced at the env-parsing layer (`backend/src/lib/env.ts`).
- **Jobs**: node-cron in-process scheduler (`backend/src/jobs/`).

## Anti-cheat

Layered friction rather than perfect verification:

1. **Source filtering** — manually-entered HealthKit/Health Connect samples
   are rejected server-side unconditionally.
2. **Cross-sensor corroboration** — steps need motion-coprocessor agreement;
   running/cycling/swimming need a real workout session with a GPS route, not
   a bare distance number.
3. **Statistical anomaly detection** — personal-baseline spikes and physically
   implausible pace, checked server-side on every sample.
4. **Device attestation** — App Attest / Play Integrity at the schema and
   route level (the native call itself is stubbed pending a dev-client build).
5. **Human review** — flagged evidence **holds the prize** of a winning
   entrant rather than paying it out, and participants can report others.

Pace and GPS data are still captured in full for (3). What was removed with
the pooled model is the user-facing pace *target*, not the underlying signal.

## Repo layout

```
backend/    Node/TS/Fastify/Prisma API — see backend/API.md
  src/modules/races/       Fixed-prize races + leagues
  src/modules/challenges/  StreakPot pooled-stake challenges
mobile/     Expo app — iOS, Android and the web pilot
scripts/    build-web.sh — the deploy build Hostinger runs
backups/    Logical DB dumps written by `npm run db:backup`
```

Start with `backend/src/modules/races/README.md` for the race model, then
`backend/prisma/schema.prisma` (whose header explains why the two models
coexist) and `backend/API.md`. `DEPLOYMENT.md` covers hosting.

## Running it

```bash
# backend
cd backend && cp .env.example .env  # fill in DATABASE_URL + Paystack TEST keys
npm install && npm run prisma:migrate && npm run seed && npm run dev

# web (separate terminal) — the pilot target
cd mobile && npm install && npx expo start --web

# native (separate terminal)
cd mobile && npx expo prebuild && npx expo run:android   # or run:ios
```

`EXPO_PUBLIC_API_URL` in `mobile/.env` only affects **native** — web resolves
its own base URL (`src/api/config.ts`), so there's no need to edit it when
switching between web and Android. Native needs `10.0.2.2` for the Android
emulator, `localhost` for the iOS simulator, or your LAN IP for a real device.

To run exactly what production runs (backend serving the built web app):

```bash
npm run build && npm start
# then open http://localhost:4000
```

Useful backend scripts:

| Script | What |
|---|---|
| `npm run seed` | Platform account, metrics, leagues, race formats, prize schedules |
| `npm run db:backup` | Full logical dump to `backups/` |
| `npm run smoke:races` | End-to-end run against a live server (creates test data) |
| `npm run smoke:clean` | Removes that test data, refusing to touch real users |
