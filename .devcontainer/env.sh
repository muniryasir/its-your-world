#!/usr/bin/env bash
# Writes .env.server / .env.client for the current environment.
# In Codespaces the public URL depends on the codespace name, so this runs on every start.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${CODESPACE_NAME:-}" ]; then
  APP_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  API_URL="${APP_URL}/server"
  DB_HOST="db"
else
  APP_URL="http://localhost:3000"
  API_URL="http://localhost:3001"
  DB_HOST="localhost"
fi

cat > .env.server <<ENV
DATABASE_URL=postgresql://postgres:postgres@${DB_HOST}:5432/itsyourworld
WASP_WEB_CLIENT_URL=${APP_URL}
ENV

cat > .env.client <<ENV
REACT_APP_API_URL=${API_URL}
ENV

echo "env files written (app: ${APP_URL})"
