#!/usr/bin/env bash
# Runs once when the codespace is created.
set -euo pipefail
cd "$(dirname "$0")/.."

# Keep a log; on failure print the tail (also as a GitHub annotation for CI).
LOG=/tmp/codespace-setup.log
exec > >(tee "$LOG") 2>&1
on_error() {
  local line=$1 cmd=$2
  sleep 1
  echo "!! Setup failed at line $line: $cmd  (full log: $LOG)"
  echo "::error title=devcontainer-setup::line $line: $cmd%0A$(tail -40 "$LOG" | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')"
}
trap 'on_error $LINENO "$BASH_COMMAND"' ERR

echo "==> Installing PostgreSQL"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql >/dev/null
bash .devcontainer/start-db.sh
sudo runuser -u postgres -- psql -qc "ALTER USER postgres PASSWORD 'postgres';"
sudo runuser -u postgres -- psql -tc "SELECT 1 FROM pg_database WHERE datname='itsyourworld'" | grep -q 1 \
  || sudo runuser -u postgres -- createdb itsyourworld

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
