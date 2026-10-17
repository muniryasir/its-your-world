#!/usr/bin/env bash
# Starts the Postgres server that lives inside the dev container.
set -euo pipefail
sudo service postgresql start >/dev/null
for i in $(seq 1 30); do
  pg_isready -h localhost -q && break
  sleep 1
done
echo "Postgres is running."
