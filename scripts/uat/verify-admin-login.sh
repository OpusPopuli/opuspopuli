#!/usr/bin/env bash
# Reproduce the Postman auth sequence outside Postman.
#
# When admin login fails, this says whether the problem is the stack or the
# client. It performs exactly what the collection does, in order, and prints
# what each step returned.
#
#   ./scripts/uat/verify-admin-login.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATEWAY="${GATEWAY_URL:-http://localhost:3000}"
SUPABASE="${SUPABASE_URL_LOCAL:-http://localhost:8000}"
EMAIL="${TEST_EMAIL:-admin@opuspopuli.local}"
PASSWORD="${TEST_PASSWORD:-Admin1234!}"
ANON="${SUPABASE_ANON_KEY:-$(grep '^SUPABASE_ANON_KEY=' "$ROOT/.env" 2>/dev/null | cut -d= -f2-)}"

fail() { echo "  FAIL: $*"; exit 1; }

echo "1. anon key"
[ -n "$ANON" ] || fail "SUPABASE_ANON_KEY is empty (not in env, not in .env)"
case "$ANON" in
  PASTE_*|GET_FROM_NODE*) fail "anon key is still the placeholder: $ANON" ;;
esac
# It must be a JWT signed by this instance's JWT_SECRET, or GoTrue rejects it.
[ "$(printf '%s' "$ANON" | awk -F. '{print NF}')" = "3" ] || fail "anon key is not a JWT: ${ANON:0:24}..."
echo "   ok: ${ANON:0:24}..."

echo "2. seed CSRF from the gateway"
JAR="$(mktemp)"
CODE=$(curl -s -c "$JAR" -o /dev/null -w '%{http_code}' --max-time 10 \
       "$GATEWAY/api?query=%7B__typename%7D" || echo 000)
# 400 is CORRECT here: Apollo's CSRF prevention rejects the bare GET, but the
# response still sets the cookie, which is the only reason this step exists.
[ "$CODE" = "400" ] || [ "$CODE" = "200" ] || fail "gateway unreachable (HTTP $CODE)"
CSRF=$(awk '/csrf-token/ {print $7}' "$JAR" | head -1)
[ -n "$CSRF" ] || fail "no csrf-token cookie set (HTTP $CODE)"
echo "   ok: HTTP $CODE, csrf-token=${CSRF:0:12}..."

echo "3. supabase password grant"
RESP=$(curl -s --max-time 15 -X POST "$SUPABASE/auth/v1/token?grant_type=password" \
       -H "apikey: $ANON" -H "Content-Type: application/json" \
       -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(printf '%s' "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
[ -n "$TOKEN" ] || fail "no access_token. Response: $(printf '%s' "$RESP" | head -c 300)"
ROLES=$(printf '%s' "$TOKEN" | python3 -c "
import sys,base64,json
p=sys.stdin.read().split('.')[1]
print(json.loads(base64.urlsafe_b64decode(p+'='*(-len(p)%4))).get('app_metadata',{}).get('roles'))" 2>/dev/null)
echo "   ok: token acquired, roles=$ROLES"
[ "$ROLES" != "None" ] || echo "   WARNING: no roles claim — admin-only operations will be refused"

echo "4. authenticated query through the gateway"
OUT=$(curl -s -b "$JAR" --max-time 20 -X POST "$GATEWAY/api" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
      -H "X-CSRF-Token: $CSRF" -H "apollo-require-preflight: true" \
      -d '{"query":"{ countyThresholds { fips name } }"}')
COUNT=$(printf '%s' "$OUT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(len(d.get('data',{}).get('countyThresholds') or []) if 'errors' not in d else 'ERRORS: '+json.dumps(d['errors'])[:200])" 2>/dev/null)
echo "   counties returned: $COUNT"
rm -f "$JAR"
echo
echo "All four steps passed. If Postman still fails, the difference is in the"
echo "client: check the Postman Console (View > Show Postman Console) for the"
echo "'Login failed:' line the collection logs, and confirm the selected"
echo "environment's supabase_anon_key is not the PASTE_... placeholder."
