#!/usr/bin/env bash
# Writes .env.server (database connection). Safe to re-run.
# The client API URL for Codespaces is handled in vite.config.ts.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${CODESPACES:-}" ]; then DB_HOST="db"; else DB_HOST="localhost"; fi

cat > .env.server <<ENV
DATABASE_URL=postgresql://postgres:postgres@${DB_HOST}:5432/itsyourworld
ENV
rm -f .env.client
echo ".env.server written (database host: ${DB_HOST})"
