# Deploying the pilot to Hostinger Node.js Web App hosting

One Hostinger Node.js Web App serves both the API and the exported web app:

- One HTTPS domain is used for the Fastify API, the Expo web bundle, Strava
  callback bridges, and the Paystack web callback.
- The web client uses same-origin relative API paths in production
  (`/me/wallet`, not an absolute API host), so no production localhost URL or
  stale build-time API URL is needed.
- The backend owns the SPA fallback in `registerWebApp`
  (`backend/src/server.ts`). That fallback is required for fresh browser
  navigations to `/paystack-callback` and `/strava-callback`.

To split the app later, serve `mobile/dist` from a static host, set the web
build's API origin intentionally, and configure SPA rewrites on that host.
For the current pilot, keep the single Hostinger Node.js Web App.

## Hostinger settings

Use the repository root as the application root.

| Hostinger field | Value |
|---|---|
| Package manager | npm |
| Node.js version | 22.12.0 or newer |
| Install command | `npm install` |
| Build command | `npm run build` |
| Start command | `npm start` |
| Entry file | `backend/start.cjs` |
| Output directory | Not separate; the server serves `backend/public` |
| Health check path | `/health` |

The root `npm run build` command installs both subprojects with their lock
files, exports the Expo web bundle into `backend/public`, generates Prisma,
and compiles the backend. The root `npm start` command runs
`prisma migrate deploy --schema backend/prisma/schema.prisma` and then starts
`backend/start.cjs`, which loads the compiled backend from
`backend/dist/server.js`.

Hostinger should supply `PORT` at runtime. The server reads `process.env.PORT`
and binds to `0.0.0.0`.

## Environment variables

Add these in Hostinger. Do not commit real values to the repository.

Required:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | External PostgreSQL connection string reachable from Hostinger. Must not point to localhost. |
| `JWT_SECRET` | Long random production secret. Do not reuse local values. |
| `PAYSTACK_SECRET_KEY` | Paystack test key; must start with `sk_test_`. |
| `PAYSTACK_PUBLIC_KEY` | Paystack test key; must start with `pk_test_`. |
| `PAYPAL_SANDBOX_CLIENT_ID` | PayPal sandbox app client id. |
| `PAYPAL_SANDBOX_SECRET` | PayPal sandbox app secret. |
| `NODE_ENV` | `production`. |

Hostinger/runtime:

| Variable | Notes |
|---|---|
| `PORT` | Usually provided by Hostinger. Set only if Hostinger asks you to. |

Recommended before inviting pilot users:

| Variable | Notes |
|---|---|
| `WEB_APP_URL` | Final HTTPS origin, no trailing slash, e.g. `https://streak.example.com`. Required for web Paystack deposits and web Strava callback redirects. |
| `SUPPORT_EMAIL` | Shown via `GET /config`. |
| `TERMS_URL` | Shown via `GET /config`. |
| `PRIVACY_URL` | Shown via `GET /config`. |

Optional:

| Variable | Notes |
|---|---|
| `STRAVA_CLIENT_ID` | Enables Strava when paired with the secret and redirect URI. |
| `STRAVA_CLIENT_SECRET` | Strava OAuth secret. |
| `STRAVA_WEB_REDIRECT_URI` | `https://<your-domain>/integrations/strava/web-callback`. |
| `STRAVA_REDIRECT_URI` | `https://<your-domain>/integrations/strava/mobile-callback`; only needed for native builds. |
| `EXPO_ACCESS_TOKEN` | Only needed if Expo push enhanced security is enabled. |
| `DEPOSITS_ENABLED` | Defaults to `false`. Set `true` only when Paystack deposits should be reachable. |
| `AUTOMATED_PAYOUTS_ENABLED` | Defaults to `false`. Set `true` only when provider payouts should be automated. |

There is no Redis requirement. Jobs run in-process through `node-cron`.

## Database

The app uses Prisma with PostgreSQL. Hostinger must be able to reach the
database over the network. Use a managed PostgreSQL provider or a database
host that allows inbound connections from Hostinger.

Migrations run on every production start through:

```bash
npm --prefix backend exec -- prisma migrate deploy --schema backend/prisma/schema.prisma
```

The seed does not run automatically. Run it once after the first deployment:

```bash
cd backend && npx tsx prisma/seed.ts
```

Then make your own account an admin:

```bash
cd backend && npx tsx -e "
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
await p.user.update({ where: { email: 'YOU@example.com' }, data: { isAdmin: true } });
await p.\$disconnect();
"
```

## Domain and callbacks

After connecting the real Hostinger HTTPS domain:

- Set `WEB_APP_URL` to the final origin, for example
  `https://streak.example.com`.
- If Strava is enabled, set the Strava Authorization Callback Domain to the
  bare domain, for example `streak.example.com`, and set
  `STRAVA_WEB_REDIRECT_URI` to
  `https://streak.example.com/integrations/strava/web-callback`.
- If native builds are used, set `STRAVA_REDIRECT_URI` to
  `https://streak.example.com/integrations/strava/mobile-callback`.
- In Paystack, use the same HTTPS domain for web callbacks. The backend sends
  the exact per-transaction callback URL as
  `${WEB_APP_URL}/paystack-callback`.

## Verify deployment

```bash
curl https://<your-domain>/health
curl -I https://<your-domain>/
curl -I https://<your-domain>/paystack-callback
curl -I https://<your-domain>/strava-callback
curl -H 'Accept: application/json' \
  -o /dev/null -w '%{http_code}\n' \
  https://<your-domain>/no-such-route
```

Expected:

- `/health` returns JSON with `ok: true`.
- `/`, `/paystack-callback`, and `/strava-callback` return the web app.
- an unknown JSON/API route returns JSON 404, not the HTML app shell.

## Operational notes

Push notifications use Expo's push service. `EXPO_ACCESS_TOKEN` is only
required if enhanced security is enabled. Web push also requires VAPID setup
in the Expo project before browser notifications can be delivered.

Scheduled jobs run inside the API process. Keep the Hostinger app at one
running instance unless you intentionally move jobs into a separate worker,
because each instance would run the same cron jobs.

Payments are still test/sandbox-only. The backend validates Paystack test key
prefixes at startup.
