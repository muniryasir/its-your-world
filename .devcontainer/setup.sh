#!/usr/bin/env bash
# Runs once when the codespace is created.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing PostgreSQL"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql >/dev/null
bash .devcontainer/start-db.sh
sudo -u postgres psql -qc "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='itsyourworld'" | grep -q 1 \
  || sudo -u postgres createdb itsyourworld

echo "==> Installing Wasp CLI"
npm install -g @wasp.sh/wasp-cli@0.26.0

echo "==> Writing env files"
bash .devcontainer/env.sh

echo "==> Installing dependencies"
wasp install

echo "==> Applying database migrations"
wasp db migrate-dev

echo "==> Seeding demo data (demo / demo1234)"
wasp db seed

echo "==> Done. The app starts automatically; if not, run: wasp start"
