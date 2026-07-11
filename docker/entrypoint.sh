#!/bin/sh
set -e

cd /app

echo "==> Running database migrations"
# migrate.ts references ./drizzle relative to cwd, so run from packages/server.
( cd packages/server && /app/node_modules/.bin/tsx src/db/migrate.ts )

echo "==> Starting server on :${PORT:-3000}"
exec /app/node_modules/.bin/tsx packages/server/src/index.ts
