#!/usr/bin/env bash
# Codespaces diagnostics for It's Your World.
#
# Collects everything needed to debug "the app doesn't open in the browser",
# writes it to logs/diagnostics.log and pushes that log to the `diagnostics`
# branch on GitHub so it can be read without copy-pasting terminal output.
#
#   bash scripts/diagnose.sh          run now
#   bash scripts/diagnose.sh --wait   wait (up to 5 min) for the app to start first
#
# Runs automatically in the background every time the codespace starts.
# Never prints tokens or secrets.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
LOG=logs/diagnostics.log
WASP_LOG=/tmp/wasp-start.log
SETUP_LOG=/tmp/codespace-setup.log

if [ "${1:-}" = "--wait" ]; then
  for i in $(seq 1 150); do
    c=$(curl -s -o /dev/null -m 5 -w "%{http_code}" http://127.0.0.1:3000/ || true)
    [ "$c" = "200" ] && break
    sleep 2
  done
  sleep 5
fi

APP_URL=""
[ -n "${CODESPACE_NAME:-}" ] && APP_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"

section() { printf '\n===== %s =====\n' "$1"; }
code() { curl -s -o /dev/null -m 15 -w "%{http_code} (%{time_total}s)" "$@" 2>/dev/null || true; }
redact() { sed -E 's/(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/[REDACTED]/g; /^[Ss]et-[Cc]ookie:/d; /^[Cc]ookie:/d'; }

{
  section "Run"
  echo "time:        $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "git HEAD:    $(git log -1 --oneline 2>/dev/null)"
  echo "codespace:   ${CODESPACE_NAME:-<not a codespace>}"
  echo "fwd domain:  ${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-<unset>}"
  echo "CODESPACES:  ${CODESPACES:-<unset>}"
  echo "user:        $(whoami)"
  echo "app URL:     ${APP_URL:-<n/a>}"
  echo "node: $(node -v 2>&1)  npm: $(npm -v 2>&1)  wasp: $(wasp version 2>/dev/null | head -1)"

  section "Editor / client hints"
  echo "TERM_PROGRAM=${TERM_PROGRAM:-}  BROWSER=${BROWSER:-}"
  echo "VSCODE_GIT_IPC_HANDLE set: $([ -n "${VSCODE_GIT_IPC_HANDLE:-}" ] && echo yes || echo no)"
  ps -eo pid,args 2>/dev/null | grep -E "vscode-server|code-server|server-main" | grep -v grep | cut -c1-200 | head -5

  section "Listening ports"
  (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E ":(3000|3001|5432|8080)\b|Local" 

  section "Network interfaces"
  ip -brief addr 2>/dev/null || hostname -I
  echo "ipv6 disabled (all): $(cat /proc/sys/net/ipv6/conf/all/disable_ipv6 2>/dev/null || echo n/a)"

  section "Local HTTP checks"
  echo "client 127.0.0.1:3000  -> $(code http://127.0.0.1:3000/)"
  echo "client [::1]:3000      -> $(code 'http://[::1]:3000/')"
  echo "client localhost:3000  -> $(code http://localhost:3000/)"
  echo "server 127.0.0.1:3001  -> $(code http://127.0.0.1:3001/)"
  echo "proxy  :3000/server    -> $(code -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/server/auth/username/login)  (400/401 = proxy works)"
  echo "browser-style request  -> $(code -H 'Accept: text/html' -H "Host: ${CODESPACE_NAME:-x}-3000.app.github.dev" http://127.0.0.1:3000/)"

  section "Client API URL seen by Vite process"
  for pid in $(pgrep -f "vite" 2>/dev/null); do
    tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -E "^(REACT_APP_API_URL|CODESPACES|CODESPACE_NAME)=" | sed "s/^/pid $pid: /"
  done
  echo "(vite.config.ts sets REACT_APP_API_URL at load time; check served page:)"
  curl -s -m 15 http://127.0.0.1:3000/ | grep -oE 'https?://[a-zA-Z0-9.-]+(:[0-9]+)?(/server)?' | sort -u | head -10

  section "Through GitHub's port forwarder (from inside the codespace)"
  if [ -n "$APP_URL" ]; then
    echo "-- with codespace token (what a signed-in browser should get):"
    curl -s -i -m 20 -H "X-Github-Token: ${GITHUB_TOKEN:-}" "$APP_URL/" 2>&1 | head -20 | redact
    echo
    echo "-- without token (expect redirect to GitHub sign-in for a private port):"
    curl -s -i -m 20 "$APP_URL/" 2>&1 | head -12 | redact
  else
    echo "not in a codespace"
  fi

  section "Port visibility (gh)"
  if command -v gh >/dev/null && [ -n "${CODESPACE_NAME:-}" ]; then
    gh codespace ports -c "$CODESPACE_NAME" 2>&1 | redact | head -10
  else
    echo "gh not available"
  fi

  section "Env files (DATABASE_URL host only)"
  [ -f .env.server ] && sed -E 's#(postgresql://)[^@]*@#\1***@#' .env.server || echo ".env.server missing"
  [ -f .env.client ] && { echo ".env.client present (Wasp rejects it in dev):"; cat .env.client; }

  section "Postgres"
  pg_isready -h localhost 2>&1

  section "Setup log (tail)"
  [ -f "$SETUP_LOG" ] && tail -25 "$SETUP_LOG" | redact || echo "no setup log"

  section "wasp start log (tail)"
  [ -f "$WASP_LOG" ] && sed 's/\x1b\[[0-9;]*m//g' "$WASP_LOG" | tail -60 | redact || echo "no wasp log (app not started via start-app.sh)"
} > "$LOG" 2>&1

echo "Diagnostics written to $LOG"

# Push the log to the `diagnostics` branch without touching the working tree.
if [ "${NO_PUSH:-}" != "1" ] && git remote get-url origin >/dev/null 2>&1; then
  export GIT_INDEX_FILE=$(mktemp)
  rm -f "$GIT_INDEX_FILE"
  blob=$(git hash-object -w "$LOG")
  git update-index --add --cacheinfo 100644,"$blob",diagnostics.log
  tree=$(git write-tree)
  commit=$(GIT_AUTHOR_NAME=diagnostics GIT_AUTHOR_EMAIL=diagnostics@localhost \
           GIT_COMMITTER_NAME=diagnostics GIT_COMMITTER_EMAIL=diagnostics@localhost \
           git commit-tree "$tree" -m "Diagnostics ${CODESPACE_NAME:-local} $(date -u +%FT%TZ)")
  rm -f "$GIT_INDEX_FILE"
  if git push -q -f origin "$commit:refs/heads/diagnostics" 2>/dev/null; then
    echo "Pushed to the 'diagnostics' branch on GitHub."
  else
    echo "Could not push the log; it's still in $LOG"
  fi
fi
