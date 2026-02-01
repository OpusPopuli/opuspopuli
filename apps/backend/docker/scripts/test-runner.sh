#!/bin/sh
# Test runner script for integration tests
# Verifies database state before running tests

set -e

echo "=== Test Runner: Verifying database state ==="

# Connection parameters
export PGPASSWORD="${RELATIONAL_DB_PASSWORD:-your-super-secret-password}"
PGHOST="${RELATIONAL_DB_HOST:-supabase-db}"
PGUSER="${RELATIONAL_DB_USERNAME:-postgres}"
PGDB="${RELATIONAL_DB_DATABASE:-postgres}"

# Verify SRID 4326 exists (required for PostGIS geography operations)
SRID_CHECK=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -t -A -c "SELECT COUNT(*) FROM spatial_ref_sys WHERE srid = 4326;")
if [ "$SRID_CHECK" -eq "0" ]; then
  echo "ERROR: SRID 4326 not found in spatial_ref_sys!"
  exit 1
fi
echo "✓ PostGIS SRID 4326 verified"

echo ""
echo "=== Running integration tests ==="

# Run the actual tests
exec pnpm test:integration
