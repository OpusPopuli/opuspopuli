import { DynamicModule, Module, Provider } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { MemoryHealthIndicator } from './indicators/memory.health';

/**
 * Health Module Configuration Options
 */
export interface HealthModuleOptions {
  /**
   * Service name for identification in health responses
   */
  serviceName: string;

  /**
   * Whether this service has a database connection to check
   * @default false
   */
  hasDatabase?: boolean;

  /**
   * Memory heap threshold in bytes for health check
   * @default 150 * 1024 * 1024 (150MB)
   */
  memoryHeapThreshold?: number;

  /**
   * Memory RSS threshold in bytes for health check
   * @default 300 * 1024 * 1024 (300MB)
   */
  memoryRssThreshold?: number;
}

/**
 * Health Module
 *
 * Provides health check endpoints for Kubernetes liveness and readiness probes.
 *
 * Endpoints:
 * - GET /health - Full health check with all indicators
 * - GET /health/live - Liveness probe (is the process running?)
 * - GET /health/ready - Readiness probe (is the service ready to handle requests?)
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/209
 */
@Module({})
export class HealthModule {
  /**
   * Configure the health module for a specific service
   *
   * @example
   * ```typescript
   * // For API Gateway (no database)
   * HealthModule.forRoot({ serviceName: 'api-gateway' })
   *
   * // For Users service (with database)
   * HealthModule.forRoot({ serviceName: 'users-service', hasDatabase: true })
   * ```
   */
  static forRoot(options: HealthModuleOptions): DynamicModule {
    const providers: Provider[] = [
      {
        provide: 'HEALTH_OPTIONS',
        useValue: options,
      },
      MemoryHealthIndicator,
    ];

    // Only add database health indicator if service uses database
    if (options.hasDatabase) {
      providers.push(DatabaseHealthIndicator);
    }

    return {
      module: HealthModule,
      imports: [TerminusModule],
      controllers: [HealthController],
      providers,
      exports: ['HEALTH_OPTIONS'],
    };
  }
}
