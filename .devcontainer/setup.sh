#!/usr/bin/env bash
# Runs once when the codespace is created.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing Wasp CLI"
npm install -g @wasp.sh/wasp-cli@0.26.0

echo "==> Writing env files"
bash .devcontainer/env.sh

echo "==> Installing dependencies"
wasp install

echo "==> Waiting for Postgres"
for i in $(seq 1 30); do
  (echo > /dev/tcp/db/5432) >/dev/null 2>&1 && break
  sleep 1
done

echo "==> Applying database migrations"
wasp db migrate-dev --name init

echo "==> Seeding demo data (demo / demo1234)"
wasp db seed

echo "==> Done. The app starts automatically; if not, run: wasp start"
