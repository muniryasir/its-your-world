#!/usr/bin/env bash
# End-to-end checks of the server's security rules against a running server.
# Calls the server directly (no browser), the way an attacker would.
#   1. login works; the demo user sees their seeded data
#   2. app pages' data is blocked (403) until the user adds the app
#   3. only live catalog apps can be added
#   4. users can't read or change another user's portfolio (404)
#   5. removing an app blocks access again but keeps the data
#   6. requests without a session are rejected (401)
set -euo pipefail
API="${1:-http://localhost:3001}"
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; exit 1; }

op() { # op <operation-route> <token> <json-args>  -> prints "<status> <body>"
  curl -s -o /tmp/body -w "%{http_code}" -X POST "$API/operations/$1" \
    -H "Content-Type: application/json" ${2:+-H "Authorization: Bearer $2"} \
    -d "{\"json\": $3}"
  echo " $(cat /tmp/body)"
}
login() {
  curl -sf -X POST "$API/auth/username/login" -H "Content-Type: application/json" \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" | sed -E 's/.*"sessionId":"([^"]+)".*/\1/'
}
expect() { # expect <prefix> <output> <label>
  [[ "$2" == $1* ]] || fail "$3 (got: ${2:0:200})"
  pass "$3"
}

# --- demo user ---------------------------------------------------------------
DEMO=$(login demo demo1234) || fail "demo login"
[ -n "$DEMO" ] && pass "demo user can log in"
out=$(op get-my-apps "$DEMO" null); expect 200 "$out" "demo user's apps load"
[[ "$out" == *'"appId":"portfolio"'* ]] || fail "demo user should have Portfolio added: $out"
pass "demo user has Portfolio added"
out=$(op get-portfolios "$DEMO" null); expect 200 "$out" "demo user can read their portfolios"
DEMO_PID=$(echo "$out" | grep -oE '"id":[0-9]+' | head -1 | cut -d: -f2)
count=$(echo "$out" | grep -oE '"holdingsCount"' | wc -l)
[ "$count" -ge 3 ] || fail "expected >=3 seeded portfolios, got $count"
pass "demo user sees $count seeded portfolios"

# --- new user ----------------------------------------------------------------
U="smoke$RANDOM$RANDOM"
curl -sf -X POST "$API/auth/username/signup" -H "Content-Type: application/json" \
  -d "{\"username\":\"$U\",\"password\":\"smoke-pass-123\"}" >/dev/null || fail "signup"
NEW=$(login "$U" smoke-pass-123) || fail "new user login"
pass "new user can sign up and log in"

out=$(op get-my-apps "$NEW" null); [[ "$out" == "200 "*'"json":[]'* ]] || fail "new user should start with no apps: $out"
pass "new user starts with an empty world"
out=$(op get-portfolios "$NEW" null); expect 403 "$out" "portfolio data is blocked before adding the app"
out=$(op create-portfolio "$NEW" '{"name":"x"}'); expect 403 "$out" "portfolio actions are blocked before adding the app"

out=$(op add-app "$NEW" '{"appId":"arcade"}'); expect 400 "$out" "coming-soon apps can't be added"
out=$(op add-app "$NEW" '{"appId":"not-an-app"}'); expect 400 "$out" "unknown apps can't be added"

out=$(op add-app "$NEW" '{"appId":"portfolio"}'); expect 200 "$out" "new user can add Portfolio"
out=$(op get-portfolios "$NEW" null); expect 200 "$out" "portfolio data opens after adding the app"
[[ "$out" == *'"name":"My portfolio"'* ]] || fail "adding Portfolio should create 'My portfolio': $out"
pass "adding Portfolio creates a starter portfolio"

# --- ownership ---------------------------------------------------------------
out=$(op get-portfolio "$NEW" "{\"id\":$DEMO_PID}"); expect 404 "$out" "other users' portfolios return 404"
out=$(op create-investment "$NEW" "{\"portfolioId\":$DEMO_PID,\"symbol\":\"X\",\"name\":\"X\",\"assetType\":\"Stock\",\"quantity\":1,\"buyPrice\":1,\"currentPrice\":1}")
expect 404 "$out" "other users can't add investments to someone else's portfolio"

# --- remove / re-add -----------------------------------------------------------
out=$(op remove-app "$NEW" '{"appId":"portfolio"}'); expect 200 "$out" "user can remove Portfolio"
out=$(op get-portfolios "$NEW" null); expect 403 "$out" "removed app's data is blocked again"
out=$(op add-app "$NEW" '{"appId":"portfolio"}'); expect 200 "$out" "user can add Portfolio again"
out=$(op get-portfolios "$NEW" null)
n=$(echo "$out" | grep -oE '"holdingsCount"' | wc -l)
[ "$n" -eq 1 ] || fail "re-adding should keep the data and not create duplicates (got $n portfolios)"
pass "re-adding keeps the data without duplicates"

# --- anonymous ---------------------------------------------------------------
out=$(op get-portfolios "" null); expect 401 "$out" "anonymous portfolio requests are rejected"
out=$(op get-my-apps "" null); expect 401 "$out" "anonymous world requests are rejected"
out=$(op add-app "" '{"appId":"portfolio"}'); expect 401 "$out" "anonymous users can't add apps"

echo "All smoke tests passed."
