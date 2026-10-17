#!/usr/bin/env bash
# Runs a command; if it fails, re-emits the tail of its output as a GitHub
# annotation so the error is visible on the run summary page.
set -o pipefail
title="$1"; shift
log=$(mktemp)
"$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}
if [ "$code" -ne 0 ]; then
  msg=$(sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -v '^\s*$' | tail -60 | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')
  echo "::error title=${title}::${msg}"
fi
exit "$code"
