/**
 * Environment Configuration
 *
 * Centralizes environment detection to ensure consistent behavior
 * across the entire application. Always use these helpers instead
 * of directly checking process.env.NODE_ENV.
 *
 * SECURITY: Inconsistent environment checks can lead to production
 * security features being disabled or development features being
 * enabled in production.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/206
 */

/**
 * Valid environment values
 */
export type Environment = 'production' | 'development' | 'test';

/**
 * Get the current environment, normalized to one of: production, development, test
 *
 * Supports legacy 'dev' and 'prod' values for backwards compatibility,
 * normalizing them to 'development' and 'production' respectively.
 */
export function getEnvironment(): Environment {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();

  switch (nodeEnv) {
    case 'production':
    case 'prod':
      return 'production';
    case 'test':
      return 'test';
    case 'development':
    case 'dev':
    default:
      return 'development';
  }
}

/**
 * Check if the current environment is production
 *
 * @example
 * ```typescript
 * import { isProduction } from 'src/config/environment.config';
 *
 * if (isProduction()) {
 *   // Enable production-only security features
 * }
 * ```
 */
export function isProduction(): boolean {
  return getEnvironment() === 'production';
}

/**
 * Check if the current environment is development
 *
 * @example
 * ```typescript
 * import { isDevelopment } from 'src/config/environment.config';
 *
 * if (isDevelopment()) {
 *   // Enable development helpers
 * }
 * ```
 */
export function isDevelopment(): boolean {
  return getEnvironment() === 'development';
}

/**
 * Check if the current environment is test
 *
 * @example
 * ```typescript
 * import { isTest } from 'src/config/environment.config';
 *
 * if (isTest()) {
 *   // Mock external services
 * }
 * ```
 */
export function isTest(): boolean {
  return getEnvironment() === 'test';
}

/**
 * Check if the current environment is NOT production
 * Useful for enabling debug features in development and test
 */
export function isNonProduction(): boolean {
  return !isProduction();
}
