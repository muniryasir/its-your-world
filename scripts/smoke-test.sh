#!/usr/bin/env bash
# End-to-end checks of the server's security rules against a running server.
# Calls the server directly (no browser), the way an attacker would.
#   1. login works; the demo user sees their seeded data
#   2. app pages' data is blocked (403) until the user adds the app
#   3. only live catalog apps can be added
#   4. users can't read or change another user's portfolio (404)
#   5. removing an app blocks access again but keeps the data
#   6. requests without a session are rejected (401)
#   7. Portfolio market + trading: prices come from the server, cash and
#      holdings can't be overspent, other users' portfolios are 404
#   8. Arcade: scores come from the server's replay of the recorded inputs,
#      impossible runs are rejected, other users' runs are 404, the
#      leaderboard shows nicknames only
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
out=$(op get-market "$NEW" null); expect 403 "$out" "market data is blocked before adding the app"
out=$(op buy-asset "$NEW" '{"portfolioId":1,"symbol":"BTC","amount":10}'); expect 403 "$out" "trading is blocked before adding the app"

out=$(op add-app "$NEW" '{"appId":"not-an-app"}'); expect 400 "$out" "unknown apps can't be added"

out=$(op add-app "$NEW" '{"appId":"portfolio"}'); expect 200 "$out" "new user can add Portfolio"
out=$(op get-portfolios "$NEW" null); expect 200 "$out" "portfolio data opens after adding the app"
[[ "$out" == *'"name":"My portfolio"'* ]] || fail "adding Portfolio should create 'My portfolio': $out"
pass "adding Portfolio creates a starter portfolio"

# --- market --------------------------------------------------------------------
out=$(op get-market "$NEW" null); expect 200 "$out" "market loads after adding the app"
n=$(echo "$out" | grep -oE '"symbol":' | wc -l); [ "$n" -eq 40 ] || fail "market should list 40 assets, got $n"
pass "market lists 40 assets"
for c in oil crypto stocks metals; do
  out=$(op get-market "$NEW" "{\"assetClass\":\"$c\"}")
  n=$(echo "$out" | grep -oE '"symbol":' | wc -l); [ "$n" -eq 10 ] || fail "$c should list 10 assets, got $n"
done
pass "each asset class lists its top 10"
out=$(op get-market "$NEW" '{"assetClass":"bonds"}'); expect 400 "$out" "unknown asset classes are rejected"
out=$(op get-asset "$NEW" '{"symbol":"BTC"}'); expect 200 "$out" "asset detail loads"
[[ "$out" == *'"history":'* && "$out" == *'"marketCap":'* ]] || fail "asset detail should include history and market cap: ${out:0:200}"
pass "asset detail includes history and stats"
out=$(op get-asset "$NEW" '{"symbol":"NOPE"}'); expect 404 "$out" "unknown assets return 404"
out=$(op create-portfolio "$NEW" '{"name":"Tiny","startingCash":50}'); expect 400 "$out" "starting cash below the minimum is rejected"

# --- trading -------------------------------------------------------------------
out=$(op get-portfolios "$NEW" null)
NEW_PID=$(echo "$out" | grep -oE '"id":[0-9]+' | head -1 | cut -d: -f2)
out=$(op buy-asset "$NEW" "{\"portfolioId\":$NEW_PID,\"symbol\":\"BTC\",\"amount\":1000,\"price\":1}")
expect 200 "$out" "user can buy an asset with demo cash"
total=$(echo "$out" | grep -oE '"total":[0-9.]+' | cut -d: -f2)
awk -v t="$total" 'BEGIN { exit !(t > 990 && t <= 1000) }' || fail "a \$1000 buy should cost about \$1000 at the server's price (got $total)"
pass "trades use the server's price, not one sent by the client"
out=$(op get-portfolio "$NEW" "{\"id\":$NEW_PID}")
[[ "$out" == *'"symbol":"BTC"'* ]] || fail "bought asset should appear in holdings: ${out:0:200}"
[[ "$out" == *'"side":"BUY"'* ]] || fail "buy should appear in trade history: ${out:0:200}"
pass "holding and trade history are updated"
out=$(op buy-asset "$NEW" "{\"portfolioId\":$NEW_PID,\"symbol\":\"BTC\",\"amount\":100000000}"); expect 400 "$out" "can't spend more cash than the portfolio has"
out=$(op buy-asset "$NEW" "{\"portfolioId\":$NEW_PID,\"symbol\":\"BTC\",\"amount\":-5}"); expect 400 "$out" "negative amounts are rejected"
out=$(op buy-asset "$NEW" "{\"portfolioId\":$NEW_PID,\"symbol\":\"BTC\",\"amount\":5,\"quantity\":1}"); expect 400 "$out" "amount and quantity together are rejected"
out=$(op buy-asset "$NEW" "{\"portfolioId\":$NEW_PID,\"symbol\":\"NOPE\",\"amount\":5}"); expect 404 "$out" "buying an unknown asset returns 404"
out=$(op sell-asset "$NEW" "{\"portfolioId\":$NEW_PID,\"symbol\":\"BTC\",\"quantity\":1000}"); expect 400 "$out" "can't sell more than the portfolio holds"
out=$(op sell-asset "$NEW" "{\"portfolioId\":$NEW_PID,\"symbol\":\"ETH\",\"quantity\":1}"); expect 400 "$out" "can't sell an asset the portfolio doesn't hold"
out=$(op sell-asset "$NEW" "{\"portfolioId\":$NEW_PID,\"symbol\":\"BTC\",\"all\":true}"); expect 200 "$out" "user can sell a whole holding"
out=$(op get-portfolio "$NEW" "{\"id\":$NEW_PID}")
[[ "$out" == *'"holdings":[]'* ]] || fail "selling everything should close the holding: ${out:0:200}"
[[ "$out" == *'"side":"SELL"'* ]] || fail "sell should appear in trade history: ${out:0:200}"
pass "selling everything closes the holding"

# --- ownership ---------------------------------------------------------------
out=$(op get-portfolio "$NEW" "{\"id\":$DEMO_PID}"); expect 404 "$out" "other users' portfolios return 404"
out=$(op buy-asset "$NEW" "{\"portfolioId\":$DEMO_PID,\"symbol\":\"BTC\",\"amount\":10}")
expect 404 "$out" "other users can't buy in someone else's portfolio"
out=$(op sell-asset "$NEW" "{\"portfolioId\":$DEMO_PID,\"symbol\":\"AAPL\",\"all\":true}")
expect 404 "$out" "other users can't sell from someone else's portfolio"
out=$(op get-asset "$NEW" '{"symbol":"AAPL"}')
[[ "$out" != *'"portfolioName":"Long-Term Growth"'* ]] || fail "asset detail must not show other users' positions"
pass "asset detail only shows the user's own positions"

# --- remove / re-add -----------------------------------------------------------
out=$(op remove-app "$NEW" '{"appId":"portfolio"}'); expect 200 "$out" "user can remove Portfolio"
out=$(op get-portfolios "$NEW" null); expect 403 "$out" "removed app's data is blocked again"
out=$(op add-app "$NEW" '{"appId":"portfolio"}'); expect 200 "$out" "user can add Portfolio again"
out=$(op get-portfolios "$NEW" null)
n=$(echo "$out" | grep -oE '"holdingsCount"' | wc -l)
[ "$n" -eq 1 ] || fail "re-adding should keep the data and not create duplicates (got $n portfolios)"
pass "re-adding keeps the data without duplicates"

# --- arcade ------------------------------------------------------------------
# (owned by the Arcade app; see docs/handoff/arcade-app.md)
out=$(op get-arcade "$NEW" null); expect 403 "$out" "arcade data is blocked before adding the app"
out=$(op start-run "$NEW" '{"gameId":"starfall"}'); expect 403 "$out" "runs can't start before adding the Arcade"
out=$(op add-app "$NEW" '{"appId":"arcade"}'); expect 200 "$out" "new user can add the Arcade"
out=$(op get-arcade "$NEW" null); expect 200 "$out" "arcade loads after adding the app"
[[ "$out" == *'"id":"starfall"'*'"added":true'* ]] || fail "adding the Arcade should put Starfall on the shelf: ${out:0:300}"
pass "adding the Arcade puts Starfall on the shelf"
[[ "$out" =~ \"nickname\":\"[A-Za-z]+-[0-9]+\" ]] || fail "new players should get a random nickname: ${out:0:300}"
pass "new players get a random nickname"
out=$(op get-game "$NEW" '{"gameId":"nope"}'); expect 404 "$out" "unknown games return 404"
out=$(op get-game "$NEW" '{"gameId":"starfall"}'); expect 200 "$out" "game page data loads"
[[ "$out" == *'"nickname":"DemoPilot"'* ]] || fail "the seeded leaderboard should include the demo player: ${out:0:300}"
pass "leaderboard lists other players by nickname"
[[ "$out" != *'"userId"'* && "$out" != *'arcade-bot'* && "$out" != *'"username"'* ]] || fail "leaderboard must not expose user ids or logins: ${out:0:300}"
pass "leaderboard doesn't expose user ids or logins"

out=$(op start-run "$NEW" '{"gameId":"starfall"}'); expect 200 "$out" "a run can start"
RUN=$(echo "$out" | grep -oE '"runId":[0-9]+' | cut -d: -f2)
# Three hard drops, then quit. The client also claims a huge score, which must be ignored.
out=$(op finish-run "$NEW" "{\"runId\":$RUN,\"log\":\"G0G0G0Z0\",\"score\":999999}"); expect 200 "$out" "a finished run is accepted"
score=$(echo "$out" | grep -oE '"score":[0-9]+' | head -1 | cut -d: -f2)
[ "$score" -gt 0 ] && [ "$score" -lt 1000 ] || fail "score should come from the replay (3 hard drops = ~100 points), got $score"
pass "the score comes from the server's replay, not from the client ($score)"
out=$(op finish-run "$NEW" "{\"runId\":$RUN,\"log\":\"G0G0G0Z0\"}"); expect 400 "$out" "a run can only be submitted once"
out=$(op get-game "$NEW" '{"gameId":"starfall"}')
[[ "$out" == *"\"best\":{\"id\":$RUN,\"score\":$score"* ]] || fail "the finished run should be the user's best: ${out:0:300}"
pass "the finished run shows as the user's best"

out=$(op start-run "$NEW" '{"gameId":"starfall"}'); RUN=$(echo "$out" | grep -oE '"runId":[0-9]+' | cut -d: -f2)
# A valid log of a 40-second game, submitted a moment after the run started.
out=$(op finish-run "$NEW" "{\"runId\":$RUN,\"log\":\"G0G0G0Z1uo\"}"); expect 400 "$out" "a run longer than the time since it started is rejected"
out=$(op finish-run "$NEW" "{\"runId\":$RUN,\"log\":\"G0Z0\"}"); expect 400 "$out" "a rejected run can't be resubmitted"
out=$(op start-run "$NEW" '{"gameId":"starfall"}'); RUN=$(echo "$out" | grep -oE '"runId":[0-9]+' | cut -d: -f2)
out=$(op finish-run "$NEW" "{\"runId\":$RUN,\"log\":\"score=999999\"}"); expect 400 "$out" "malformed input logs are rejected"
out=$(op start-run "$NEW" '{"gameId":"starfall"}'); RUN=$(echo "$out" | grep -oE '"runId":[0-9]+' | cut -d: -f2)
out=$(op finish-run "$NEW" "{\"runId\":$RUN,\"log\":\"G0G0\"}"); expect 400 "$out" "input logs without an end are rejected"

# A second player, so the demo account's runs stay clean.
U2="smoke2$RANDOM$RANDOM"
curl -sf -X POST "$API/auth/username/signup" -H "Content-Type: application/json" \
  -d "{\"username\":\"$U2\",\"password\":\"smoke-pass-123\"}" >/dev/null || fail "second signup"
OTHER=$(login "$U2" smoke-pass-123) || fail "second user login"
out=$(op add-app "$OTHER" '{"appId":"arcade"}'); expect 200 "$out" "a second user can add the Arcade"
out=$(op start-run "$OTHER" '{"gameId":"starfall"}'); expect 200 "$out" "the second user can start a run"
OTHER_RUN=$(echo "$out" | grep -oE '"runId":[0-9]+' | cut -d: -f2)
out=$(op finish-run "$NEW" "{\"runId\":$OTHER_RUN,\"log\":\"G0Z0\"}"); expect 404 "$out" "other users' runs return 404"
out=$(op finish-run "$OTHER" "{\"runId\":$OTHER_RUN,\"log\":\"G0Z0\"}"); expect 200 "$out" "the owner can still finish their run"

out=$(op set-nickname "$NEW" "{\"nickname\":\"Pilot_$RANDOM\"}"); expect 200 "$out" "players can change their nickname"
out=$(op set-nickname "$NEW" '{"nickname":"demopilot"}'); expect 400 "$out" "nicknames are unique (ignoring case)"
out=$(op set-nickname "$NEW" '{"nickname":"a"}'); expect 400 "$out" "too-short nicknames are rejected"
out=$(op set-nickname "$NEW" '{"nickname":"<b>hi</b>"}'); expect 400 "$out" "nicknames with odd characters are rejected"

out=$(op remove-game "$NEW" '{"gameId":"starfall"}'); expect 200 "$out" "a game can be removed from the shelf"
out=$(op start-run "$NEW" '{"gameId":"starfall"}'); expect 403 "$out" "runs can't start for a game that isn't on the shelf"
out=$(op add-game "$NEW" '{"gameId":"nope"}'); expect 404 "$out" "unknown games can't be added"
out=$(op add-game "$NEW" '{"gameId":"starfall"}'); expect 200 "$out" "a game can be added back to the shelf"

out=$(op remove-app "$NEW" '{"appId":"arcade"}'); expect 200 "$out" "user can remove the Arcade"
out=$(op get-arcade "$NEW" null); expect 403 "$out" "removed Arcade's data is blocked again"
out=$(op finish-run "$NEW" '{"runId":1,"log":"Z0"}'); expect 403 "$out" "removed Arcade's actions are blocked again"
out=$(op add-app "$NEW" '{"appId":"arcade"}'); expect 200 "$out" "user can add the Arcade again"
out=$(op get-arcade "$NEW" null)
[[ "$out" == *'"nickname":"Pilot_'* ]] || fail "re-adding the Arcade should keep the nickname: ${out:0:300}"
[[ "$out" =~ \"best\":$score ]] || fail "re-adding the Arcade should keep the scores: ${out:0:300}"
pass "re-adding the Arcade keeps the nickname and scores"

# --- anonymous ---------------------------------------------------------------
out=$(op get-portfolios "" null); expect 401 "$out" "anonymous portfolio requests are rejected"
out=$(op get-market "" null); expect 401 "$out" "anonymous market requests are rejected"
out=$(op buy-asset "" '{"portfolioId":1,"symbol":"BTC","amount":10}'); expect 401 "$out" "anonymous users can't trade"
out=$(op get-arcade "" null); expect 401 "$out" "anonymous arcade requests are rejected"
out=$(op start-run "" '{"gameId":"starfall"}'); expect 401 "$out" "anonymous users can't start runs"
out=$(op finish-run "" '{"runId":1,"log":"Z0"}'); expect 401 "$out" "anonymous users can't submit runs"
out=$(op get-my-apps "" null); expect 401 "$out" "anonymous world requests are rejected"
out=$(op add-app "" '{"appId":"portfolio"}'); expect 401 "$out" "anonymous users can't add apps"

echo "All smoke tests passed."
