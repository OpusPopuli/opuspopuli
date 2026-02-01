#!/bin/sh
# Database migration script for integration tests
# This script runs Prisma db:push and then PostGIS spatial setup

set -e

echo "=== Starting database migration ==="

# Change to the relationaldb-provider package directory
cd /usr/src/app/packages/relationaldb-provider

echo "Running Prisma db:push..."
npx prisma db push --accept-data-loss

echo "Running PostGIS spatial setup..."
# Use explicit connection parameters since $DATABASE_URL may not work with psql in all environments
PGPASSWORD="${RELATIONAL_DB_PASSWORD:-your-super-secret-password}" psql \
  -h "${RELATIONAL_DB_HOST:-supabase-db}" \
  -U "${RELATIONAL_DB_USERNAME:-postgres}" \
  -d "${RELATIONAL_DB_DATABASE:-postgres}" \
  -f prisma/spatial-indexes.sql

echo "=== Database migration complete ==="
