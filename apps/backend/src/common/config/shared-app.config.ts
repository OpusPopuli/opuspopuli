import { ConfigService } from '@nestjs/config';
import { LogLevel } from '@qckstrt/logging-provider';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AllExceptionsFilter } from '../exceptions/all-exceptions.filter';
import { GraphQLExceptionFilter } from '../exceptions/graphql-exception.filter';
import { RolesGuard } from '../guards/roles.guard';
import { GqlThrottlerGuard } from '../guards/throttler.guard';
import { PoliciesGuard } from '../guards/policies.guard';

/**
 * Shared throttler configuration for all microservices
 */
export const THROTTLER_CONFIG = [
  {
    name: 'short',
    ttl: 1000, // 1 second
    limit: 10, // 10 requests per second
  },
  {
    name: 'medium',
    ttl: 10000, // 10 seconds
    limit: 50, // 50 requests per 10 seconds
  },
  {
    name: 'long',
    ttl: 60000, // 1 minute
    limit: 100, // 100 requests per minute
  },
];

/**
 * Shared providers for all microservices (guards and filters)
 *
 * Note: AllExceptionsFilter must be registered first (processed last)
 * to catch any unhandled exceptions after more specific filters.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/190
 */
export const SHARED_PROVIDERS = [
  { provide: APP_FILTER, useClass: AllExceptionsFilter },
  { provide: APP_FILTER, useClass: GraphQLExceptionFilter },
  { provide: APP_GUARD, useClass: GqlThrottlerGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: PoliciesGuard },
];

/**
 * Factory function for LoggingModule configuration
 */
export function createLoggingConfig(serviceName: string) {
  return {
    imports: [],
    useFactory: (configService: ConfigService) => ({
      serviceName,
      level:
        configService.get('NODE_ENV') === 'production'
          ? LogLevel.INFO
          : LogLevel.DEBUG,
      format:
        configService.get('NODE_ENV') === 'production'
          ? ('json' as const)
          : ('pretty' as const),
    }),
    inject: [ConfigService],
  };
}
