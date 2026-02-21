import { Logger } from '@nestjs/common';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { isProduction } from './environment.config';

/**
 * CORS Configuration
 *
 * Provides environment-aware CORS settings for the API gateway and GraphQL endpoints.
 *
 * Production Mode:
 * - Requires ALLOWED_ORIGINS to be set (throws on startup if missing)
 * - Validates each origin is a valid HTTPS URL
 * - Logs CORS rejections for security auditing
 * - Applies to both HTTP and WebSocket connections
 *
 * Development Mode:
 * - Allows all origins for easier local development
 * - Still enforces credentials and method restrictions
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/189
 * @see https://github.com/OpusPopuli/opuspopuli/issues/381
 */

const logger = new Logger('CorsConfig');

/**
 * Standard allowed headers for CORS requests
 */
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Requested-With',
  'X-CSRF-Token',
];

/**
 * Standard allowed HTTP methods for CORS requests
 */
export const CORS_ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'];

/**
 * Cache duration for preflight requests (24 hours)
 */
export const CORS_MAX_AGE = 86400;

/**
 * Validate that an origin is a valid HTTPS URL (required in production).
 * Allows http://localhost for development convenience, though in production
 * mode HTTPS is enforced.
 */
export function isValidProductionOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Parse and validate the ALLOWED_ORIGINS environment variable.
 *
 * In production:
 * - Throws if ALLOWED_ORIGINS is unset or empty
 * - Throws if any origin is not a valid HTTPS URL
 *
 * In development:
 * - Returns null (all origins allowed)
 */
export function parseAllowedOrigins(
  configService: ConfigService,
): string[] | null {
  const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS');
  const isProd = isProduction();

  if (!isProd) {
    return allowedOrigins
      ? allowedOrigins
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : null;
  }

  // Production: ALLOWED_ORIGINS is required (defense in depth — env.validation.ts also enforces this)
  if (!allowedOrigins || allowedOrigins.trim() === '') {
    throw new Error(
      'ALLOWED_ORIGINS must be set in production. Provide a comma-separated list of HTTPS origins.',
    );
  }

  const origins = allowedOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error(
      'ALLOWED_ORIGINS must contain at least one valid origin in production.',
    );
  }

  const invalidOrigins = origins.filter((o) => !isValidProductionOrigin(o));
  if (invalidOrigins.length > 0) {
    throw new Error(
      `Invalid origins in ALLOWED_ORIGINS: ${invalidOrigins.join(', ')}. All production origins must use HTTPS.`,
    );
  }

  logger.log(
    `Production CORS configured with ${origins.length} allowed origin(s)`,
  );
  return origins;
}

/**
 * Get CORS configuration based on environment
 *
 * In production, uses a callback function to validate each request origin
 * and log rejections for security auditing.
 *
 * @param configService - NestJS ConfigService for reading environment variables
 * @returns CorsOptions for NestJS CORS configuration
 */
export function getCorsConfig(configService: ConfigService): CorsOptions {
  const origins = parseAllowedOrigins(configService);

  if (origins) {
    const originSet = new Set(origins);
    return {
      origin: (
        requestOrigin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        // Allow requests with no origin (e.g., server-to-server, curl)
        if (!requestOrigin) {
          callback(null, true);
          return;
        }

        if (originSet.has(requestOrigin)) {
          callback(null, true);
        } else {
          logger.warn(
            `CORS rejection: origin="${requestOrigin}" is not in the allowed list`,
          );
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: CORS_ALLOWED_METHODS,
      allowedHeaders: CORS_ALLOWED_HEADERS,
      credentials: true,
      maxAge: CORS_MAX_AGE,
    };
  }

  // Development: allow all origins for easier testing
  return {
    origin: true,
    methods: CORS_ALLOWED_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    credentials: true,
  };
}

/**
 * Get CORS configuration for Apollo Server / GraphQL
 *
 * Apollo Server uses a slightly different CORS format.
 * This function returns configuration compatible with Apollo Server.
 *
 * @param configService - NestJS ConfigService for reading environment variables
 * @returns CORS configuration for Apollo Server
 */
export function getGraphQLCorsConfig(configService: ConfigService): {
  origin: string[] | boolean;
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
} {
  const origins = parseAllowedOrigins(configService);

  if (origins) {
    return {
      origin: origins,
      credentials: true,
      methods: CORS_ALLOWED_METHODS,
      allowedHeaders: CORS_ALLOWED_HEADERS,
    };
  }

  // Development: allow all origins for easier testing
  return {
    origin: true,
    credentials: true,
    methods: CORS_ALLOWED_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
  };
}
