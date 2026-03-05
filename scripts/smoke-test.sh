#!/usr/bin/env bash
# ClawAgent MVP - API Smoke Test Suite
# Usage: ./scripts/smoke-test.sh [base_url]
set -euo pipefail

BASE="${1:-http://localhost:3750}"
PASS=0
FAIL=0
ADMIN_TOKEN="clawagent-admin-2026"

check() {
  local name="$1" url="$2" method="${3:-GET}" body="${4:-}"
  local args=(-s -o /tmp/claw_resp -w '%{http_code}')
  [[ "$method" != "GET" ]] && args+=(-X "$method")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  local code
  code=$(curl "${args[@]}" "$url")
  local ok
  ok=$(cat /tmp/claw_resp | node -e "try{const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(j.ok?'true':'false')}catch{console.log('false')}")
  if [[ "$code" =~ ^2 ]] && [[ "$ok" == "true" ]]; then
    echo "  PASS  $name (HTTP $code)"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $name (HTTP $code, ok=$ok)"
    FAIL=$((FAIL+1))
  fi
}

echo "ClawAgent Smoke Tests against $BASE"
echo "======================================"

check "Health"            "$BASE/api/health"
check "Agents list"       "$BASE/api/agents"
check "Tasks list"        "$BASE/api/tasks"
check "Tasks (filter)"    "$BASE/api/tasks?status=open"

# Create a task for further tests
TASK_RESP=$(curl -s -X POST "$BASE/api/tasks/create" -H 'Content-Type: application/json' \
  -d '{"category":"smoke","intent":"Smoke test","max_cost":10,"payment_amount":5}')
TASK_ID=$(echo "$TASK_RESP" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).task.id)")
echo "  Created test task: $TASK_ID"
PASS=$((PASS+1))

check "Task detail"       "$BASE/api/tasks/$TASK_ID"
check "Task match"        "$BASE/api/tasks/$TASK_ID/match"
check "Escrow lock"       "$BASE/api/escrow/lock" POST "{\"task_id\":\"$TASK_ID\",\"amount\":5}"
check "Escrow release"    "$BASE/api/escrow/release" POST "{\"task_id\":\"$TASK_ID\"}"
check "Verify"            "$BASE/api/verify" POST "{\"task_id\":\"$TASK_ID\",\"result\":{\"data\":true}}"

# Get an agent for reputation test
AGENT_ID=$(curl -s "$BASE/api/agents" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).agents[0].id)")
check "Reputation update" "$BASE/api/reputation/update" POST "{\"agent_id\":\"$AGENT_ID\",\"task_id\":\"$TASK_ID\",\"event\":\"completed\"}"
check "Admin dashboard"   "$BASE/api/admin/dashboard?admin_token=$ADMIN_TOKEN"
# Dashboard UI is HTML, just check HTTP 200
UI_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
if [[ "$UI_CODE" == "200" ]]; then
  echo "  PASS  Dashboard UI (HTTP $UI_CODE)"
  PASS=$((PASS+1))
else
  echo "  FAIL  Dashboard UI (HTTP $UI_CODE)"
  FAIL=$((FAIL+1))
fi

echo "======================================"
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && echo "ALL TESTS PASSED" || { echo "SOME TESTS FAILED"; exit 1; }
