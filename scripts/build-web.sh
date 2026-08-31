#!/usr/bin/env bash
# Builds the whole deployable: the Expo web bundle, staged into the backend's
# public/ directory, then the backend itself.
#
# Run from anywhere. This is what the Hostinger build command calls.
#
# Two non-obvious things:
#
# 1. EXPO_PUBLIC_API_URL. Expo inlines EXPO_PUBLIC_* variables into the bundle
#    AT BUILD TIME — they are not read at runtime — so the value baked in here
#    is permanent for this build. Because the backend serves this bundle from
#    its own origin, the correct value is the EMPTY STRING: the client then
#    issues same-origin relative requests (`/me/wallet` rather than
#    `https://host/me/wallet`), which is correct in every environment and needs
#    no per-deploy knowledge of the public hostname. The client reads
#    `process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000"`, and `??`
#    only falls back on null/undefined, so an explicit "" survives.
#
# 2. Every step uses an explicit `cd` in a subshell rather than `npm --prefix`.
#    `--prefix` changes where npm reads package.json but NOT the working
#    directory, so `npm --prefix mobile exec -- expo export` runs Expo in the
#    repo root — where it finds the root package.json, sees no Expo config, and
#    fails with "No platforms are configured to use the Metro bundler".

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Installing mobile dependencies"
( cd mobile && npm ci --include=dev )

echo "==> Exporting web bundle (same-origin API)"
( cd mobile && rm -rf dist && EXPO_PUBLIC_API_URL="" npx expo export --platform web --output-dir dist )

# Guard against staging a stale bundle: if the export above had failed while
# an old mobile/dist lingered, a bare `cp` would silently ship the previous
# build — including whatever API URL it had baked in.
if [ ! -f mobile/dist/index.html ]; then
  echo "ERROR: web export produced no mobile/dist/index.html — refusing to stage a stale build." >&2
  exit 1
fi

echo "==> Staging web bundle into backend/public"
rm -rf backend/public
mkdir -p backend/public
cp -r mobile/dist/. backend/public/

echo "==> Installing backend dependencies"
( cd backend && npm ci --include=dev )

echo "==> Generating Prisma client"
( cd backend && npx prisma generate )

echo "==> Compiling backend"
( cd backend && npm run build )

echo "==> Build complete"
