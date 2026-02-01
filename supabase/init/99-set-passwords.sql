-- Set passwords for Supabase roles
-- This script runs AFTER the supabase/postgres image's init-scripts
-- by being placed in a subdirectory that sorts after 'init-scripts/'
--
-- The supabase/postgres image creates roles in:
--   /docker-entrypoint-initdb.d/init-scripts/00000000000000-initial-schema.sql
--
-- Our script is mounted to:
--   /docker-entrypoint-initdb.d/zz-custom/99-set-passwords.sql
-- which runs after init-scripts/ (z > i alphabetically)

-- Enable pgvector extension for embeddings/similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable PostGIS extension for geographic location queries
-- Used for privacy-preserving petition location tracking (see #290, #296)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Ensure SRID 4326 (WGS84) exists in spatial_ref_sys
-- Some Docker environments don't populate spatial_ref_sys automatically
INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text)
SELECT 4326, 'EPSG', 4326,
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]',
  '+proj=longlat +datum=WGS84 +no_defs'
WHERE NOT EXISTS (SELECT 1 FROM spatial_ref_sys WHERE srid = 4326);

-- Get password from environment variable
\set pgpass `echo "$POSTGRES_PASSWORD"`

-- Set passwords for login roles (roles already created by supabase init scripts)
ALTER ROLE authenticator WITH PASSWORD :'pgpass';
ALTER ROLE supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER ROLE supabase_storage_admin WITH PASSWORD :'pgpass';
ALTER ROLE supabase_admin WITH PASSWORD :'pgpass';

-- Log success
DO $$ BEGIN RAISE NOTICE 'Supabase role passwords have been set'; END $$;
