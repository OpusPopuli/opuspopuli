-- Create the `postgres_test` database used by the backend integration suite.
-- Pairs with apps/backend/__tests__/integration/utils/test-db-bootstrap.ts,
-- which lazily creates the same DB at first test run for already-initialised
-- containers (this script only runs on fresh installs).
--
-- See OpusPopuli/opuspopuli#796 for the full design rationale. Reverting this
-- so integration tests target the main `postgres` database WILL wipe dev
-- state — there is a guard in cleanDatabase() that throws against any DB
-- whose name doesn't end in `_test`.

SELECT 'CREATE DATABASE postgres_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'postgres_test')\gexec
