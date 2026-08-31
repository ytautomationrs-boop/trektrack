# Streak backend

Node.js + TypeScript + Fastify + Prisma/PostgreSQL. Wallet deposits run on
**Paystack TEST MODE only** — see the guardrail in `src/lib/env.ts`, which
refuses to boot against a live (`sk_live_`) key. Every other money movement
(entry fees, prizes, refunds) is an internal wallet-balance ledger entry with
no payment-provider call at all — see `API.md` "Wallet".

## Compliance note

Prizes are fixed and pre-announced, and are the same whether a race brought
in more or less than they cost. They are not a pool of entrants' fees divided
among winners. That distinction is the point of the model — it puts a race on
the footing of a paid amateur sports event paying an advertised purse
regardless of turnout, rather than a totalisator.

**Any change that makes a prize a function of entries collected undoes it.**
See `src/modules/races/README.md`. Do not point this at live keys or real
funds without separate legal review.

## Setup

```bash
cp .env.example .env   # DATABASE_URL, PAYSTACK_SECRET_KEY (sk_test_...), PAYSTACK_PUBLIC_KEY (pk_test_...)
npm install
npm run prisma:migrate
npm run seed
npm run dev
```

Paystack test cards: https://paystack.com/docs/payments/test-payments —
`4084 0840 8408 4081` always succeeds, any future expiry/CVV, OTP `123456`.

Optional: to enable Strava, also set `STRAVA_CLIENT_ID` /
`STRAVA_CLIENT_SECRET` / `STRAVA_REDIRECT_URI` (register a free app at
https://developers.strava.com). Everything — including running and cycling
races — works fully without these; Strava is opt-in corroboration on top of
HealthKit/Health Connect, never a requirement.

## Layout

- `prisma/schema.prisma` — the data model, commented per section.
- `prisma/seed.ts` — platform account, metrics, per-metric leagues, race
  formats, prize schedules. Idempotent.
- `src/modules/races/` — **the model lives here**; start with its README.
- `src/modules/health/validators/` — anti-cheat ingestion rules, keyed by
  `MetricTypeDefinition.validationRuleKey`. Strava-sourced samples run
  through these same validators, not a separate trust path.
- `src/modules/anomaly/rules/` — statistical checks (personal-baseline spike,
  pace plausibility) plus the review endpoints.
- `src/modules/{auth,wallet,devices,metricTypes,account,integrations}/` —
  one folder per domain, each with `schemas.ts` (Zod), `routes.ts`, and a
  `service.ts` where there is real logic beyond CRUD.
- `src/jobs/` — node-cron scheduler: race lifecycle, Strava sync, withdrawal
  polling.

## Scripts

| Script | What |
|---|---|
| `npm run dev` | Watch-mode server on :4000 |
| `npm run seed` | Seed config (safe to re-run) |
| `npm run db:backup` | Full logical dump to `../backups/` — uses raw SQL, so it works even when the client and DB have drifted |
| `npm run smoke:races` | End-to-end run against a live server; creates test data |
| `npm run smoke:clean` | Removes that test data, refusing to touch real users |
| `npm test` | Unit tests (points scale, promotion cadence) |
