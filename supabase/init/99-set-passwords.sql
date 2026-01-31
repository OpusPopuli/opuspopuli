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

-- Get password from environment variable
\set pgpass `echo "$POSTGRES_PASSWORD"`

-- Set passwords for login roles (roles already created by supabase init scripts)
ALTER ROLE authenticator WITH PASSWORD :'pgpass';
ALTER ROLE supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER ROLE supabase_storage_admin WITH PASSWORD :'pgpass';
ALTER ROLE supabase_admin WITH PASSWORD :'pgpass';

-- Log success
DO $$ BEGIN RAISE NOTICE 'Supabase role passwords have been set'; END $$;
