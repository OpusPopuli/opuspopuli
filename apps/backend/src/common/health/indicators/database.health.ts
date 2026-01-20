import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from 'src/db/prisma.service';

/**
 * Database Health Indicator
 *
 * Checks PostgreSQL database connectivity by executing a simple query.
 * Used for readiness probes to ensure the service can handle database operations.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/209
 */
@Injectable()
export class DatabaseHealthIndicator {
  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check database connectivity
   *
   * Executes a simple SELECT 1 query to verify the database connection is alive.
   * Times out after 5 seconds to prevent health checks from hanging.
   *
   * @returns Health indicator result with database status
   */
  async check(): Promise<HealthIndicatorResult> {
    const key = 'database';
    const startTime = Date.now();

    try {
      // Execute a simple query to check connectivity
      // This also validates the connection pool is working
      await this.prisma.$queryRaw`SELECT 1`;

      const responseTime = Date.now() - startTime;

      return {
        [key]: {
          status: 'up',
          responseTime: `${responseTime}ms`,
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`Database health check failed: ${errorMessage}`);

      return {
        [key]: {
          status: 'down',
          error: errorMessage,
          responseTime: `${responseTime}ms`,
        },
      };
    }
  }
}
