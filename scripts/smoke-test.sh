#!/usr/bin/env bash
# End-to-end check of the demo's core promises against a running server:
#   1. the demo user can log in and sees the seeded portfolios
#   2. a new user can sign up and gets an empty dashboard
#   3. the new user CANNOT open the demo user's portfolio (404, not 403)
#   4. requests without a session are rejected (401)
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

DEMO=$(login demo demo1234) || fail "demo login"
[ -n "$DEMO" ] && pass "demo user can log in"

out=$(op get-portfolios "$DEMO" null)
[[ "$out" == 200* ]] || fail "get-portfolios as demo: $out"
DEMO_PID=$(echo "$out" | grep -oE '"id":[0-9]+' | head -1 | cut -d: -f2)
count=$(echo "$out" | grep -oE '"holdingsCount"' | wc -l)
[ "$count" -ge 3 ] || fail "expected >=3 seeded portfolios, got $count"
pass "demo user sees $count seeded portfolios"

U="smoke$RANDOM$RANDOM"
curl -sf -X POST "$API/auth/username/signup" -H "Content-Type: application/json" \
  -d "{\"username\":\"$U\",\"password\":\"smoke-pass-123\"}" >/dev/null || fail "signup"
OTHER=$(login "$U" smoke-pass-123) || fail "new user login"
pass "new user can sign up and log in"

out=$(op get-portfolios "$OTHER" null)
[[ "$out" == "200 "*'"json":[]'* ]] || fail "new user should have no portfolios: $out"
pass "new user starts with an empty dashboard"

out=$(op get-portfolio "$OTHER" "{\"id\":$DEMO_PID}")
[[ "$out" == 404* ]] || fail "new user opening demo portfolio should 404: $out"
pass "other users' portfolios return 404"

out=$(op create-investment "$OTHER" "{\"portfolioId\":$DEMO_PID,\"symbol\":\"X\",\"name\":\"X\",\"assetType\":\"Stock\",\"quantity\":1,\"buyPrice\":1,\"currentPrice\":1}")
[[ "$out" == 404* ]] || fail "new user adding to demo portfolio should 404: $out"
pass "other users can't add investments to someone else's portfolio"

out=$(op get-portfolios "" null)
[[ "$out" == 401* ]] || fail "anonymous request should 401: $out"
pass "requests without a session are rejected"

echo "All smoke tests passed."
