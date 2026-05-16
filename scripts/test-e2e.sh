#!/usr/bin/env bash
set -euo pipefail

# Load .env.test from repo root if it exists
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/.env.test" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env.test"
  set +a
fi

if [ -z "${TEST_DATABASE_URL:-}" ]; then
  echo "ERROR: TEST_DATABASE_URL is not set. Add it to .env.test at the repo root." >&2
  exit 1
fi

cleanup() {
  echo "Tearing down..."
  [ -n "${BE_PID:-}" ] && kill "$BE_PID" 2>/dev/null || true
  [ -n "${FE_PID:-}" ] && kill "$FE_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "--- Seeding test DB ---"
npm --prefix "$ROOT" run seed:test

echo "--- Building backend ---"
npm --prefix "$ROOT/backend" run build

echo "--- Building frontend ---"
# Bake the backend URL in so the browser calls it directly (no proxy needed).
VITE_API_URL=http://localhost:3001/api \
  npm --prefix "$ROOT/frontend" run build

echo "--- Starting backend ---"
(
  cd "$ROOT/backend"
  DATABASE_URL="$TEST_DATABASE_URL" \
  JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}" \
  CORS_ORIGIN="http://localhost:4173" \
  NODE_ENV=production \
  PORT=3001 \
  node dist/server.js
) &
BE_PID=$!

echo "--- Starting frontend preview ---"
(
  cd "$ROOT/frontend"
  npm run preview -- --port 4173
) &
FE_PID=$!

echo "--- Waiting for services ---"
"$ROOT/node_modules/.bin/wait-on" \
  "http://localhost:3001/api/health" \
  "http://localhost:4173" \
  --timeout 60000

echo "--- Running Playwright ---"
"$ROOT/node_modules/.bin/playwright" test --config "$ROOT/playwright.config.ts"
