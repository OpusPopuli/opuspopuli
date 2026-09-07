#!/bin/sh
# Region service entrypoint — starts the service. Schema is NOT synced here.
#
# This used to run `prisma db push --accept-data-loss` first. That was both
# redundant and destructive (#1168):
#
#   - Redundant: every stack declares
#     `region.depends_on.db-migrate: service_completed_successfully`, and
#     db-migrate.sh already runs `prisma migrate deploy` plus the raw-SQL
#     index files. Migrations are the source of truth for schema.
#
#   - Destructive: `db push` force-reconciles the database to schema.prisma,
#     and Prisma cannot express HNSW/GiST/GIN indexes or generated columns.
#     Every raw-SQL index was therefore dropped as "drift" on each container
#     start. Verified on the node 2026-09-07: propositions_embedding_hnsw_idx
#     (petition retrieval, #1074), documents_scan_location_gist_idx and
#     user_addresses_point_gist_idx were all missing in production — those
#     queries had silently degraded to sequential scans. Correct results,
#     invisible cost, which is why it went unnoticed.
#
# If a safety net is ever wanted for a hand-started container, it must be
# `migrate deploy` — never `db push --accept-data-loss` against real data.

set -e

echo "=== Starting region service ==="
cd /usr/src/app/apps/backend
exec node --max-old-space-size=1536 dist/src/apps/region/apps/region/src/main
