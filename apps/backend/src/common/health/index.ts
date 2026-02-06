/**
 * Health Module
 *
 * Provides health check endpoints for Kubernetes liveness and readiness probes.
 *
 * @example
 * ```typescript
 * // For API Gateway (no database)
 * import { HealthModule } from 'src/common/health';
 *
 * @Module({
 *   imports: [
 *     HealthModule.forRoot({ serviceName: 'api-gateway' }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // For services with database
 * @Module({
 *   imports: [
 *     HealthModule.forRoot({ serviceName: 'users-service', hasDatabase: true }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/209
 */
export { HealthModule, HealthModuleOptions } from './health.module';
export { HealthController } from './health.controller';
export { DatabaseHealthIndicator } from './indicators/database.health';
export { MemoryHealthIndicator } from './indicators/memory.health';
