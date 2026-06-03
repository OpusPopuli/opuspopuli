/**
 * Lazy `postgres_test` database bootstrap for the backend integration suite
 * (#796). Existing local containers were initialised before
 * `supabase/init/01-create-test-db.sql` existed, so this helper creates the
 * test database on first run if it isn't already there. Postgres doesn't
 * support `CREATE DATABASE IF NOT EXISTS`, hence the explicit `pg_database`
 * check.
 *
 * Called from `globalSetup` so it runs once per `pnpm test:integration`
 * invocation, well before any worker process imports the Prisma client.
 *
 * Why a fresh `pg` client and not the Prisma client: this runs BEFORE we
 * point DATABASE_URL at the test DB, so we need a temporary admin
 * connection to the default `postgres` database to issue the CREATE.
 */

import { Client } from 'pg';

const ADMIN_DB_NAME = 'postgres';
const TEST_DB_NAME = 'postgres_test';

/**
 * Extensions required by the application schema. Postgres extensions are
 * per-database, so a freshly-created `postgres_test` needs them installed
 * before `prisma migrate deploy` runs (the schema declares geography
 * columns, vectors, uuid generators, etc.). Mirrors what the supabase
 * docker init scripts install into the default `postgres` DB.
 *
 * `supabase_vault` is best-effort — it may not be available on every
 * Postgres image (e.g. plain `postgres:17` in CI), so failure to install
 * it is logged but not fatal. Tests that depend on vault should mock the
 * vault layer or skip on non-supabase images.
 */
const REQUIRED_EXTENSIONS = [
  'pgcrypto',
  'pg_trgm',
  'postgis',
  'uuid-ossp',
  'vector',
  'supabase_vault',
] as const;

function getAdminUrl(): string {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error(
      'ensureTestDatabase: DATABASE_URL must be set so we know how to connect ' +
        'to the admin Postgres instance before creating the test DB.',
    );
  }
  return adminUrl;
}

/**
 * Ensure `postgres_test` exists and has every extension the application
 * schema depends on (postgis, pgvector, etc.). No-op if already present.
 * Returns the connection URL to the test DB so the caller can swap
 * `DATABASE_URL`.
 */
export async function ensureTestDatabase(): Promise<string> {
  const adminUrl = getAdminUrl();
  await createDatabaseIfMissing(adminUrl);
  const testDbUrl = adminUrl.replace(
    new RegExp(`/${ADMIN_DB_NAME}([?#]|$)`),
    `/${TEST_DB_NAME}$1`,
  );
  await installExtensions(testDbUrl);
  return testDbUrl;
}

async function createDatabaseIfMissing(adminUrl: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DB_NAME],
    );
    if (result.rowCount === 0) {
      // `CREATE DATABASE` can't be parameterized; the name is a hardcoded
      // identifier, so safe to interpolate. Don't expose this helper to
      // anything that takes user input.
      await client.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    }
  } finally {
    await client.end();
  }
}

async function installExtensions(testDbUrl: string): Promise<void> {
  const client = new Client({ connectionString: testDbUrl });
  try {
    await client.connect();
    for (const ext of REQUIRED_EXTENSIONS) {
      // Identifier is from the hardcoded REQUIRED_EXTENSIONS list, so safe
      // to interpolate. `IF NOT EXISTS` makes this idempotent across runs.
      try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
      } catch (err) {
        // Best-effort — extensions like supabase_vault aren't available on
        // every Postgres image. Vault-dependent tests should mock the
        // vault layer on those images.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  (skipped extension "${ext}": ${msg})`);
      }
    }
  } finally {
    await client.end();
  }
}
