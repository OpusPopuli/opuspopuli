import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { isProduction } from './environment.config';

/**
 * CORS Configuration
 *
 * Provides environment-aware CORS settings for the API gateway and GraphQL endpoints.
 *
 * Production Mode:
 * - Restricts origins to ALLOWED_ORIGINS environment variable
 * - Validates origin against whitelist
 * - Blocks requests from unauthorized domains
 *
 * Development Mode:
 * - Allows all origins for easier local development
 * - Still enforces credentials and method restrictions
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/189
 */

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
 * Get CORS configuration based on environment
 *
 * @param configService - NestJS ConfigService for reading environment variables
 * @returns CorsOptions for NestJS CORS configuration
 */
export function getCorsConfig(configService: ConfigService): CorsOptions {
  const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS');
  const isProd = isProduction();

  if (isProd && allowedOrigins) {
    const origins = allowedOrigins.split(',').map((o) => o.trim());
    return {
      origin: origins,
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
  const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS');
  const isProd = isProduction();

  if (isProd && allowedOrigins) {
    const origins = allowedOrigins.split(',').map((o) => o.trim());
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
