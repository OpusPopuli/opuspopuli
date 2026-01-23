#!/bin/bash
# Ensure Supabase internal users have passwords set
# This runs after the default Supabase init scripts
# The script uses POSTGRES_PASSWORD from environment

set -e

echo "Setting passwords for Supabase internal roles..."

# Wait a moment for roles to be created by earlier init scripts
sleep 2

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Set password for authenticator role (used by PostgREST)
    DO \$\$
    BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
        ALTER ROLE authenticator WITH PASSWORD '$POSTGRES_PASSWORD';
        RAISE NOTICE 'Set password for authenticator';
      ELSE
        RAISE NOTICE 'Role authenticator does not exist yet';
      END IF;
    END
    \$\$;

    -- Set password for supabase_auth_admin role (used by GoTrue)
    DO \$\$
    BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
        ALTER ROLE supabase_auth_admin WITH PASSWORD '$POSTGRES_PASSWORD';
        RAISE NOTICE 'Set password for supabase_auth_admin';
      ELSE
        RAISE NOTICE 'Role supabase_auth_admin does not exist yet';
      END IF;
    END
    \$\$;

    -- Set password for supabase_storage_admin role (used by Storage API)
    DO \$\$
    BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
        ALTER ROLE supabase_storage_admin WITH PASSWORD '$POSTGRES_PASSWORD';
        RAISE NOTICE 'Set password for supabase_storage_admin';
      ELSE
        RAISE NOTICE 'Role supabase_storage_admin does not exist yet';
      END IF;
    END
    \$\$;

    -- Set password for supabase_admin role (used by Studio/Meta)
    DO \$\$
    BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN
        ALTER ROLE supabase_admin WITH PASSWORD '$POSTGRES_PASSWORD';
        RAISE NOTICE 'Set password for supabase_admin';
      ELSE
        RAISE NOTICE 'Role supabase_admin does not exist yet';
      END IF;
    END
    \$\$;
EOSQL

echo "Supabase role passwords configured!"
