#!/bin/sh
# Database migration script for integration tests
# This script runs Prisma db:push and then PostGIS spatial setup

set -e

echo "=== Starting database migration ==="

# Change to the relationaldb-provider package directory
cd /usr/src/app/packages/relationaldb-provider

# Connection parameters
export PGPASSWORD="${RELATIONAL_DB_PASSWORD:-your-super-secret-password}"
PGHOST="${RELATIONAL_DB_HOST:-supabase-db}"
PGUSER="${RELATIONAL_DB_USERNAME:-postgres}"
PGDB="${RELATIONAL_DB_DATABASE:-postgres}"

echo "Running Prisma db:push..."
npx prisma db push --accept-data-loss

echo "Seeding prompt templates..."
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-prompts.ts

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

echo "=== Database migration complete ==="
