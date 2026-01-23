-- Initialize Supabase roles with passwords for self-hosted setup
-- This script ensures roles exist and have passwords set
-- Required because the supabase/postgres image initialization order
-- may not have created roles when docker-entrypoint-initdb.d runs
--
-- Based on official Supabase docker setup's roles.sql
-- https://github.com/supabase/supabase/blob/master/docker/volumes/db/roles.sql

-- Get password from environment variable
\set pgpass `echo "$POSTGRES_PASSWORD"`

-- Create roles if they don't exist, then set passwords
-- Using DO blocks for conditional role creation

-- authenticator: Used by PostgREST for connection pooling
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN;
  END IF;
END $$;
ALTER ROLE authenticator WITH PASSWORD :'pgpass';

-- anon: Anonymous/public role
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
END $$;

-- authenticated: Role for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END $$;

-- service_role: Elevated service role that bypasses RLS
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- Grant roles to authenticator (for role switching)
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;

-- supabase_auth_admin: Used by GoTrue auth service
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOINHERIT CREATEROLE LOGIN;
  END IF;
END $$;
ALTER ROLE supabase_auth_admin WITH PASSWORD :'pgpass';

-- supabase_storage_admin: Used by storage-api service
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin NOINHERIT CREATEROLE LOGIN;
  END IF;
END $$;
ALTER ROLE supabase_storage_admin WITH PASSWORD :'pgpass';

-- supabase_admin: General admin role used by postgres-meta
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOINHERIT CREATEROLE LOGIN REPLICATION BYPASSRLS;
  END IF;
END $$;
ALTER ROLE supabase_admin WITH PASSWORD :'pgpass';

-- Grant necessary permissions
GRANT ALL ON DATABASE postgres TO supabase_admin;
GRANT ALL ON SCHEMA public TO supabase_admin, supabase_auth_admin, supabase_storage_admin;

-- Grant usage on public schema to auth roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Log success
DO $$ BEGIN RAISE NOTICE 'Supabase roles initialized with passwords'; END $$;
