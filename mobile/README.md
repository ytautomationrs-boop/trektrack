# Streak mobile

Expo + React Native + TypeScript. Targets iOS and Android from one codebase.

## Setup

```bash
npm install
cp .env.example .env   # set EXPO_PUBLIC_API_URL
npx expo prebuild       # needed once — react-native-health / react-native-health-connect are native modules, this isn't Expo Go-compatible
npx expo run:ios        # or: npx expo run:android
```

HealthKit/Health Connect native modules mean this needs a dev client build
(`expo run:ios` / `expo run:android` or EAS Build), not the plain Expo Go
app.

## Layout

- `src/theme/tokens.ts` — the design reference palette/fonts/status colors.
  Nothing else should hardcode a hex value.
- `src/components/MetricCard/` — the one card shell + 4 viz variants
  (ring/bar/dot-grid/route-bar) keyed off `MetricTypeDefinition.vizType`
  from the backend. See its header comment for how a 5th metric type slots
  in without new layout code.
- `src/health/` — the HealthKit/Health Connect integration layer. See
  `src/health/README.md` for the full plan (per-metric read strategy,
  source-metadata filtering, defense-in-depth against a modified client).
- `src/state/AppStateMachine.ts` — the single logic class driving
  cross-screen flow state (onboarding step, which modal is active,
  session). Screens are dumb consumers via `useAppState()`.
- `src/api/` — typed client for the backend (`API.md` in `../backend`).
- `src/screens/` — one folder per flow: auth, onboarding, home (your races),
  races (discover + race detail), create (create a private race), wallet,
  profile (four per-metric league badges).

## What's stubbed vs. real

- **Real**: the full data flow — auth, race browse/enter/create,
  health-sample ingestion → anti-fraud validation → ranked scoring,
  per-metric leagues and points, ledger, the wallet. Entering a race is a
  wallet-balance debit (`POST /races/:id/enter`) — no payment flow at all, since the fee
  never touches a payment provider (see `API.md` "Wallet/token model" in
  `../backend`). Real money only moves at deposit and withdrawal:
  depositing (`src/screens/wallet/WalletScreen.tsx`) opens Paystack's
  hosted checkout in a browser session (`src/integrations/paystack.ts`,
  same `expo-web-browser` pattern as the Strava OAuth flow) and the backend
  re-verifies the transaction with Paystack itself before crediting the
  wallet — it never trusts the client-visible redirect alone. Use
  Paystack's test card numbers (e.g. `4084 0840 8408 4081`) in the checkout
  page. Withdrawal is simulated, not a real payout.
- **Stubbed pending a native build**: `src/health/attestation.ts` (App
  Attest / Play Integrity — Expo's managed SDK doesn't expose these; the
  function signature is final, the native call underneath needs a small
  native module).
