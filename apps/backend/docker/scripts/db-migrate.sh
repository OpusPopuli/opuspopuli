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

echo "Running Prisma migrate deploy..."
npx prisma migrate deploy

# NOTE: local prompt_templates seeding intentionally removed. When the
# region is configured with PROMPT_SERVICE_URL the prompt-service is the
# authoritative source for templates; the local prompt_templates table is
# only used as a failover cache and does not need to be seeded at deploy
# time. seed-prompts.ts can be run manually in dev environments that lack
# access to a prompt-service. See issue #605.

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

echo "=== Seeding default admin user ==="
ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@opuspopuli.local}"
ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-Admin1234!}"
ADMIN_USERNAME="${SEED_ADMIN_USERNAME:-admin}"
SUPABASE_INTERNAL_URL="${SUPABASE_URL:-http://supabase-kong:8000}"
SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

# Use GoTrue admin API via Node.js — raw SQL bcrypt is not compatible with GoTrue's validator
node -e "
const http = require('http');
const https = require('https');
const fs = require('fs');
const { URL } = require('url');

const base = '${SUPABASE_INTERNAL_URL}/auth/v1/admin/users';
const key = '${SERVICE_ROLE_KEY}';
const email = '${ADMIN_EMAIL}';
const password = '${ADMIN_PASSWORD}';
const username = '${ADMIN_USERNAME}';

function request(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method, headers
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const authHeaders = { apikey: key, Authorization: 'Bearer ' + key };

  // Check if user already exists
  const listRes = await request('GET', base + '?email=' + encodeURIComponent(email), authHeaders);
  const list = JSON.parse(listRes.body);
  const existing = (list.users || []).find(u => u.email === email);

  if (existing) {
    console.log('Admin user already exists, skipping.');
    fs.writeFileSync('/tmp/admin_user_id', existing.id);
    return;
  }

  const body = JSON.stringify({
    email, password, email_confirm: true,
    app_metadata: { roles: ['admin'] },
    user_metadata: { username }
  });

  const res = await request('POST', base,
    { ...authHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body
  );

  if (res.status !== 200 && res.status !== 201) {
    throw new Error('GoTrue admin API error ' + res.status + ': ' + res.body);
  }

  const user = JSON.parse(res.body);
  console.log('Admin user created: ' + user.email + ' (id=' + user.id + ')');
  fs.writeFileSync('/tmp/admin_user_id', user.id);
}

// Non-fatal: GoTrue may still be starting up alongside db-migrate.
// A failed seed is logged but does not block service startup.
main().catch(err => { console.error('Seed skipped (GoTrue unavailable):', err.message); });
"

ADMIN_USER_ID=$(cat /tmp/admin_user_id 2>/dev/null || echo "")
if [ -n "$ADMIN_USER_ID" ]; then
  psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -c "
    INSERT INTO public.users (id, email, auth_strategy, created, updated)
    VALUES ('${ADMIN_USER_ID}', '${ADMIN_EMAIL}', 'password', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  " -q
  echo "public.users record ensured (id=${ADMIN_USER_ID})."
fi

echo "=== Database migration complete ==="
