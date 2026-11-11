#!/bin/sh
# Database migration script for integration tests
# This script runs Prisma migrate deploy and then PostGIS spatial setup

set -e

echo "=== Starting database migration ==="

# Change to the relationaldb-provider package directory
cd /usr/src/app/packages/relationaldb-provider

# Connection parameters
export PGPASSWORD="${RELATIONAL_DB_PASSWORD:-your-super-secret-password}"
PGHOST="${RELATIONAL_DB_HOST:-opuspopuli-db}"
PGUSER="${RELATIONAL_DB_USERNAME:-postgres}"
PGDB="${RELATIONAL_DB_DATABASE:-postgres}"

# Ensure the target database exists before running migrations. Required for
# the integration compose stack (#796) where DATABASE_URL points at
# `postgres_test`, which may not yet exist on a developer's local install.
# Postgres has no `CREATE DATABASE IF NOT EXISTS`, hence the conditional.
# Skips quietly for the production-shaped `postgres` database, which is
# created by the Postgres image itself.
if [ "$PGDB" != "postgres" ]; then
  echo "Ensuring database \"$PGDB\" exists..."
  EXISTS=$(psql -h "$PGHOST" -U "$PGUSER" -d postgres -tA -c \
    "SELECT 1 FROM pg_database WHERE datname='$PGDB'")
  if [ "$EXISTS" != "1" ]; then
    psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "CREATE DATABASE \"$PGDB\""
  fi
  echo "Installing required extensions into \"$PGDB\"..."
  for ext in pgcrypto pg_trgm postgis uuid-ossp vector supabase_vault; do
    psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=0 -c \
      "CREATE EXTENSION IF NOT EXISTS \"$ext\"" || \
      echo "  (skipped $ext — not installed in this Postgres image)"
  done
fi

echo "Running Prisma migrate deploy..."
npx prisma migrate deploy

# prompt_templates is NOT seeded here (opuspopuli#1246).
#
# Prompt text lives in prompt-service, which versions and content-hashes it.
# This repo used to carry a 367-line inline copy for nodes running without
# PROMPT_SERVICE_URL; that copy is gone, and with it the possibility of two
# divergent versions of the same prompt where nothing records which one an
# output came from.
#
# A node that needs AI features runs prompt-service and sets
# PROMPT_SERVICE_URL — `requirePromptServiceUrl` already refuses to boot
# without it in production. Without it, PromptClientService now throws on the
# first prompt fetch rather than degrading.
#
# That throw is the point. #920 was expensive because it was survivable: a
# wiped prompt_templates table fell through to hardcoded stubs, extraction
# produced records the domain mapper rejected, and meetings went silently to
# zero. A boot-time failure is the cheaper version of that week.

echo "Checking spatial_ref_sys BEFORE setup..."
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -c "SELECT schemaname, tablename FROM pg_tables WHERE tablename = 'spatial_ref_sys';"
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -c "SELECT COUNT(*) as total_srids FROM spatial_ref_sys;"
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -c "SELECT srid FROM spatial_ref_sys WHERE srid = 4326;"
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -c "SHOW search_path;"

echo "Running PostGIS spatial setup..."
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -f prisma/spatial-indexes.sql

echo "Checking spatial_ref_sys AFTER setup..."
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -c "SELECT COUNT(*) as total_srids FROM spatial_ref_sys;"
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -c "SELECT srid FROM spatial_ref_sys WHERE srid = 4326;"

echo "Testing ST_SetSRID with SRID 4326..."
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -c "SELECT ST_AsText(ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326));"
echo "Testing ST_SetSRID with SRID 4326 as GEOGRAPHY (this is what the app uses)..."
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -c "SELECT ST_AsText(ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography);"

# Bootstrap seeds (admin account, Vault secrets). Policy and tests live in
# apps/backend/scripts/bootstrap-seed/seed.ts: development, test and UAT get
# working defaults only with SEED_DEV_DEFAULTS=true; every other stack, any
# NODE_ENV, never gets the published ones, and an existing admin or Vault
# secret is never overwritten.
SEED_TS="/usr/src/app/apps/backend/scripts/bootstrap-seed/seed.ts"
TS_NODE="/usr/src/app/apps/backend/node_modules/.bin/ts-node"
# Loud, because every seed below is non-fatal: without this a broken image
# would skip the seeds on every deploy and only say "non-fatal".
if [ ! -x "$TS_NODE" ] || [ ! -f "$SEED_TS" ]; then
  echo "!!! BOOTSTRAP SEED UNAVAILABLE: $TS_NODE or $SEED_TS missing from the image. Admin and Vault seeds will not run. !!!" >&2
fi

echo "=== Seeding default admin user ==="
ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@opuspopuli.local}"
# Stdout is the admin's id and nothing else; progress goes to stderr.
# Non-fatal: GoTrue may still be starting alongside db-migrate.
ADMIN_USER_ID=$("$TS_NODE" --transpile-only "$SEED_TS" admin) || ADMIN_USER_ID=""
# Anything but a bare UUID (a stray warning on stdout) is ignored rather than
# handed to psql, where ON_ERROR_STOP would end the script before the seeds.
is_uuid() {
  # One line, and that line a UUID. grep -x alone matches any single line.
  [ "$(printf '%s\n' "$1" | wc -l | tr -d ' ')" = 1 ] &&
    printf '%s' "$1" | grep -Eqx '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
}
if ! is_uuid "$ADMIN_USER_ID"; then
  [ -n "$ADMIN_USER_ID" ] && echo "Admin seed printed something other than an id; public.users not ensured." >&2
  ADMIN_USER_ID=""
fi
if [ -n "$ADMIN_USER_ID" ]; then
  psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -q -v ON_ERROR_STOP=1 \
    -v id="$ADMIN_USER_ID" -v email="$ADMIN_EMAIL" <<'SQL'
INSERT INTO public.users (id, email, auth_strategy, created, updated)
VALUES (:'id', :'email', 'password', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
SQL
  echo "public.users record ensured (id=${ADMIN_USER_ID})."
fi

# ============================================================
# Seed SensitiveProfile T3 encryption key into Supabase Vault (#742)
# ============================================================
# seed.ts vault, over HTTP like the admin seed:
#  1. pg-meta /query installs/refreshes the vault RPC functions
#     (idempotent CREATE OR REPLACE), then NOTIFY pgrst reloads PostgREST.
#  2. PostgREST /rest/v1/rpc/vault_create_secret writes each secret,
#     service_role auth required.
#
# With SEED_DEV_DEFAULTS=true (UAT, integration, e2e) each secret is upserted
# with its SEED_* value or a dev default, so those stacks just work. Anywhere
# else a secret already in Vault is never rewritten, the encryption key is
# generated when absent and none is supplied, and the published defaults are
# never written.

# ============================================================
# Provision storage buckets + grants (#1363)
# ============================================================
# Runs BEFORE the vault seed and independently of it: retention must not
# depend on SERVICE_ROLE_KEY being present, and a stack with no AI features
# still archives its bulk exports.
#
# Applied through pg-meta /query, which executes as `supabase_admin`
# (superuser). That is the only role that can write `storage.buckets` —
# `postgres` has no grant on it and cannot SET ROLE to the owner.
#
# Idempotent, and deliberately part of `docker compose up` rather than a
# runbook step: the bulk-archive tier (#1277) retained NOTHING in any
# environment from the day it shipped, because the bucket and the grants it
# needed existed in no environment and nothing created them. A new operator
# must get a stack that retains archives without being told to go and click
# something.
STORAGE_BUCKETS_FILE="/usr/src/app/supabase/migrations/98_storage_buckets.sql"
PG_META_URL="${PG_META_URL:-http://supabase-meta:8080}"

if [ -f "$STORAGE_BUCKETS_FILE" ]; then
  echo "=== Provisioning storage buckets + grants via pg-meta ==="
  export STORAGE_BUCKETS_FILE PG_META_URL
  node -e "
const fs = require('fs');
const http = require('http');
const { URL } = require('url');
const sql = fs.readFileSync(process.env.STORAGE_BUCKETS_FILE, 'utf8');
const u = new URL(process.env.PG_META_URL + '/query');
const body = JSON.stringify({ query: sql });
const req = http.request({
  hostname: u.hostname,
  port: u.port || 80,
  path: u.pathname,
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
}, (res) => {
  let data = '';
  res.on('data', (c) => (data += c));
  res.on('end', () => {
    if (res.statusCode >= 400) {
      // Non-fatal, like the vault seed: a sync must still run, and the
      // archive degrades to recording the snapshot without its bytes.
      console.warn('Storage provisioning failed (non-fatal): ' + res.statusCode + ' ' + data.slice(0, 300));
    } else {
      console.log('Storage buckets + grants provisioned');
    }
  });
});
req.on('error', (err) => console.warn('Storage provisioning unreachable (non-fatal):', err.message));
req.write(body);
req.end();
"
else
  echo "=== Skipping storage provisioning (98_storage_buckets.sql not found) ==="
fi

VAULT_FUNCTIONS_FILE="/usr/src/app/supabase/migrations/99_vault_functions.sql"
if [ -f "$VAULT_FUNCTIONS_FILE" ]; then
  echo "=== Installing Vault RPC functions and seeding bootstrap secrets ==="
  export VAULT_FUNCTIONS_FILE PG_META_URL
  "$TS_NODE" --transpile-only "$SEED_TS" vault || echo "Vault seed failed (non-fatal)"
else
  echo "=== Skipping vault setup (99_vault_functions.sql not found) ==="
fi

echo "=== Database migration complete ==="
