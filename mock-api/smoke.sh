#!/usr/bin/env bash
# Asserts the four-persona API behaves as documented.
set -u
B=http://localhost:4010
pass=0; fail=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1));
       else echo "  FAIL  $1  (got '$2' want '$3')"; fail=$((fail+1)); fi; }
has(){ if echo "$2" | grep -q "$3"; then echo "  PASS  $1"; pass=$((pass+1));
       else echo "  FAIL  $1  (missing $3)"; fail=$((fail+1)); fi; }
no(){ if echo "$2" | grep -q "$3"; then echo "  FAIL  $1  (should not contain $3)"; fail=$((fail+1));
      else echo "  PASS  $1"; pass=$((pass+1)); fi; }
P(){ curl -s -o /tmp/b -w '%{http_code}' -X POST $B/v1/credit-line/increase-requests \
     -H 'content-type: application/json' -H "X-Test-Persona: $1" \
     -d "{\"requested_amount_cents\":$2}"; }

A=$(curl -s $B/v1/credit-line -H 'X-Test-Persona: approved')
no  "available credit not in payload" "$A" 'available_credit'
no  "remaining room not in payload"   "$A" 'remaining_room'
has "max eligible limit is exposed"   "$A" '"max_eligible_limit_cents": 500000'
has "increase_request starts null"    "$A" '"increase_request": null'
has "unused PII present (ssn_last4)"  "$A" 'ssn_last4'

chk "off-step amount rejected"  "$(P approved 26000)" 422
chk "out-of-range rejected"     "$(P approved 500000)" 422

chk "approved persona: 201"     "$(P approved 25000)" 201
has "  status APPROVED"         "$(cat /tmp/b)" '"status": "APPROVED"'
has "  new limit = 2750"        "$(cat /tmp/b)" '"new_limit_cents": 275000'

chk "second request is 409"     "$(P approved 25000)" 409
has "  names ALREADY_REQUESTED" "$(cat /tmp/b)" 'ALREADY_REQUESTED'
A2=$(curl -s $B/v1/credit-line -H 'X-Test-Persona: approved')
no  "  and increase_request no longer null" "$A2" '"increase_request": null'
has "  credit line now shows the NEW limit" "$A2" '"limit_cents": 275000'

# A member can request once, so each persona exercises one path per run.
# Priya's $800 lands exactly on her ceiling, which pins the boundary as <=
# rather than <.
D=$(curl -s $B/v1/credit-line -H 'X-Test-Persona: utilization-too-high')
has "priya: room is 800 (1800 ceiling - 1000 limit)" "$D" '"max_eligible_limit_cents": 180000'
chk "priya asks 800, inside her room: 201" "$(P utilization-too-high 80000)" 201
has "  APPROVED at exactly her ceiling"    "$(cat /tmp/b)" '"status": "APPROVED"'
has "  new limit = 1800 = her ceiling"     "$(cat /tmp/b)" '"new_limit_cents": 180000'

# Marcus has $500 of room and asks $2,500: overshooting is a decision, not a 422.
chk "marcus asks 2500, over his room: 201" "$(P new-credit-lines 250000)" 201
has "  DECLINED"                    "$(cat /tmp/b)" '"status": "DECLINED"'
has "  reason NEW_CREDIT_LINES"     "$(cat /tmp/b)" 'NEW_CREDIT_LINES'
has "  limit unchanged at 500"      "$(cat /tmp/b)" '"new_limit_cents": 50000'

# Sam has no room at all: even the smallest ask cannot be approved.
S=$(curl -s $B/v1/credit-line -H 'X-Test-Persona: insufficient-history')
has "sam: ceiling equals his limit"  "$S" '"max_eligible_limit_cents": 150000'
chk "sam asks the 100 minimum: 201"  "$(P insufficient-history 10000)" 201
has "  DECLINED"                     "$(cat /tmp/b)" '"status": "DECLINED"'
has "  reason INSUFFICIENT_PAYMENT_HISTORY" "$(cat /tmp/b)" 'INSUFFICIENT_PAYMENT_HISTORY'

echo; echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
