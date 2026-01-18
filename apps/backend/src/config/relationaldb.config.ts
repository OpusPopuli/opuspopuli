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
 * Connection pool settings:
 * - RELATIONAL_DB_POOL_MAX: Maximum connections (default: 20)
 * - RELATIONAL_DB_POOL_MIN: Minimum connections (default: 5)
 * - RELATIONAL_DB_IDLE_TIMEOUT_MS: Idle timeout in ms (default: 30000)
 * - RELATIONAL_DB_CONNECTION_TIMEOUT_MS: Connection timeout in ms (default: 5000)
 * - RELATIONAL_DB_ACQUIRE_TIMEOUT_MS: Acquire timeout in ms (default: 10000)
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
    pool: {
      max: parseOptionalInt(process.env.RELATIONAL_DB_POOL_MAX),
      min: parseOptionalInt(process.env.RELATIONAL_DB_POOL_MIN),
      idleTimeoutMs: parseOptionalInt(
        process.env.RELATIONAL_DB_IDLE_TIMEOUT_MS,
      ),
      connectionTimeoutMs: parseOptionalInt(
        process.env.RELATIONAL_DB_CONNECTION_TIMEOUT_MS,
      ),
      acquireTimeoutMs: parseOptionalInt(
        process.env.RELATIONAL_DB_ACQUIRE_TIMEOUT_MS,
      ),
    },
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
