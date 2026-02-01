-- Spatial setup for PostGIS columns
-- Run after db:push to create indexes and ensure SRID exists
-- Usage: pnpm --filter @qckstrt/relationaldb-provider db:spatial-indexes

-- Ensure PostGIS extension is enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- Ensure SRID 4326 (WGS84) exists in spatial_ref_sys
-- Some Docker environments don't populate spatial_ref_sys automatically
-- This is required for ST_SetSRID and geography operations
INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text)
VALUES (
  4326,
  'EPSG',
  4326,
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]',
  '+proj=longlat +datum=WGS84 +no_defs'
)
ON CONFLICT (srid) DO NOTHING;

-- Verify SRID 4326 exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM spatial_ref_sys WHERE srid = 4326) THEN
    RAISE EXCEPTION 'SRID 4326 not found in spatial_ref_sys after initialization';
  END IF;
  RAISE NOTICE 'PostGIS SRID 4326 (WGS84) verified';
END $$;

-- GIST index on documents.scan_location for proximity queries
-- Enables efficient "find documents scanned near this location" queries
-- See issue #290, #296 for privacy-preserving location tracking
CREATE INDEX IF NOT EXISTS documents_scan_location_gist_idx
  ON documents USING GIST (scan_location);

-- Log success
DO $$ BEGIN RAISE NOTICE 'Spatial indexes created successfully'; END $$;
