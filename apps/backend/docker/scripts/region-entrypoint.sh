#!/bin/sh
# Region service entrypoint
# Syncs the Prisma schema (idempotent) then starts the service.
# Ensures the DB schema matches the code regardless of how the container is started.

set -e

echo "=== Syncing Prisma schema ==="
cd /usr/src/app/packages/relationaldb-provider
npx prisma db push --accept-data-loss

echo "=== Starting region service ==="
cd /usr/src/app/apps/backend
exec node --max-old-space-size=1536 dist/src/apps/region/apps/region/src/main
