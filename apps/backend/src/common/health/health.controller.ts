import { Controller, Get, Inject, Optional } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
} from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { MemoryHealthIndicator } from './indicators/memory.health';
import { HealthModuleOptions } from './health.module';
import { Public } from '../decorators/public.decorator';

/**
 * Health Controller
 *
 * Provides health check endpoints for Kubernetes liveness and readiness probes.
 * These endpoints are excluded from authentication middleware and marked as public
 * to bypass the global AuthGuard.
 *
 * Endpoints:
 * - GET /health - Full health check with all indicators
 * - GET /health/live - Liveness probe (is the process running?)
 * - GET /health/ready - Readiness probe (is the service ready to handle requests?)
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/209
 */
@Public()
@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    private readonly health: HealthCheckService,
    private readonly memoryHealth: MemoryHealthIndicator,
    @Inject('HEALTH_OPTIONS')
    private readonly options: HealthModuleOptions,
    @Optional()
    private readonly databaseHealth?: DatabaseHealthIndicator,
  ) {}

  /**
   * Full health check endpoint
   *
   * Returns comprehensive health status including:
   * - Database connectivity (if applicable)
   * - Memory usage
   * - Service metadata (uptime, version)
   *
   * Use this for monitoring dashboards and alerting.
   */
  @Get()
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    const checks = [
      // Memory health check
      () => this.memoryHealth.check(),
    ];

    // Add database health check if available
    const dbHealth = this.databaseHealth;
    if (dbHealth) {
      checks.push(() => dbHealth.check());
    }

    const result = await this.health.check(checks);

    // Add service metadata
    return {
      ...result,
      info: {
        ...result.info,
        service: {
          status: 'up',
          name: this.options.serviceName,
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          version: process.env.npm_package_version || '0.0.0',
        },
      },
    };
  }

  /**
   * Liveness probe endpoint
   *
   * Returns basic liveness status - is the process running and responsive?
   * Kubernetes uses this to know when to restart a container.
   *
   * This check is intentionally minimal - if it fails, the process is truly stuck.
   */
  @Get('live')
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([
      // Basic liveness - is the process running and can respond?
      async () => ({
        app: {
          status: 'up' as const,
          name: this.options.serviceName,
        },
      }),
    ]);
  }

  /**
   * Readiness probe endpoint
   *
   * Returns readiness status - is the service ready to handle requests?
   * Kubernetes uses this to know when to send traffic to a pod.
   *
   * Checks database connectivity for services that require it.
   */
  @Get('ready')
  @HealthCheck()
  async readiness(): Promise<HealthCheckResult> {
    const dbHealth = this.databaseHealth;

    // For services with database, check connectivity
    if (dbHealth) {
      return this.health.check([() => dbHealth.check()]);
    }

    // For services without database, just confirm app is ready
    return this.health.check([
      async () => ({
        app: {
          status: 'up' as const,
          name: this.options.serviceName,
        },
      }),
    ]);
  }
}
