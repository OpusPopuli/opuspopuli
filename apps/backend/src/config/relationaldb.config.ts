import { registerAs } from '@nestjs/config';

/**
 * Parse an optional integer from environment variable
 */
function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse an optional boolean from environment variable
 */
function parseOptionalBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return value.toLowerCase() === 'true';
}

/**
 * Relational Database Configuration
 *
 * Maps RELATIONAL_DB_* environment variables to nested config.
 *
 * Connection pool settings are handled directly by Prisma via DATABASE_URL
 * query parameters. See DbService.buildDatasourceUrl() for details.
 * Env vars: PRISMA_CONNECTION_LIMIT, PRISMA_POOL_TIMEOUT
 *
 * Connection retry settings (exponential backoff):
 * - RELATIONAL_DB_RETRY_MAX_ATTEMPTS: Max retry attempts (default: 5)
 * - RELATIONAL_DB_RETRY_BASE_DELAY_MS: Base delay in ms (default: 1000)
 * - RELATIONAL_DB_RETRY_MAX_DELAY_MS: Max delay in ms (default: 30000)
 * - RELATIONAL_DB_RETRY_USE_JITTER: Add jitter to prevent thundering herd (default: true)
 */
export default registerAs('relationaldb', () => ({
  provider: process.env.RELATIONAL_DB_PROVIDER || 'postgres',
  postgres: {
    host: process.env.RELATIONAL_DB_HOST || 'localhost',
    port: Number.parseInt(process.env.RELATIONAL_DB_PORT || '5432', 10),
    database: process.env.RELATIONAL_DB_DATABASE || 'postgres',
    username: process.env.RELATIONAL_DB_USERNAME || 'postgres',
    password: process.env.RELATIONAL_DB_PASSWORD || 'postgres',
    ssl: process.env.RELATIONAL_DB_SSL === 'true',
    retry: {
      maxAttempts: parseOptionalInt(
        process.env.RELATIONAL_DB_RETRY_MAX_ATTEMPTS,
      ),
      baseDelayMs: parseOptionalInt(
        process.env.RELATIONAL_DB_RETRY_BASE_DELAY_MS,
      ),
      maxDelayMs: parseOptionalInt(
        process.env.RELATIONAL_DB_RETRY_MAX_DELAY_MS,
      ),
      useJitter: parseOptionalBool(process.env.RELATIONAL_DB_RETRY_USE_JITTER),
    },
  },
}));
