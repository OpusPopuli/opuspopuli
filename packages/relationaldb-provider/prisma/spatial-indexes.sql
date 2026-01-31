-- Spatial indexes for PostGIS columns
-- Run after db:push to create indexes not supported by Prisma
-- Usage: pnpm --filter @qckstrt/relationaldb-provider db:spatial-indexes

-- GIST index on documents.scan_location for proximity queries
-- Enables efficient "find documents scanned near this location" queries
-- See issue #290, #296 for privacy-preserving location tracking
CREATE INDEX IF NOT EXISTS documents_scan_location_gist_idx
  ON documents USING GIST (scan_location);

-- Log success
DO $$ BEGIN RAISE NOTICE 'Spatial indexes created successfully'; END $$;
