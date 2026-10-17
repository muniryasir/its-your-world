#!/usr/bin/env bash
# Starts the app and keeps a copy of its output for scripts/diagnose.sh.
cd "$(dirname "$0")/.."
wasp start 2>&1 | tee /tmp/wasp-start.log
