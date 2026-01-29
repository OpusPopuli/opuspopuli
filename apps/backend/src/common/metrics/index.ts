/**
 * Metrics Module
 *
 * Provides Prometheus metrics for observability.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { MetricsModule } from 'src/common/metrics';
 *
 * @Module({
 *   imports: [
 *     MetricsModule.forRoot({ serviceName: 'users-service' }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * ## What You Get
 *
 * 1. **Automatic HTTP metrics** - Request duration, counts, status codes
 * 2. **Default Node.js metrics** - Memory, CPU, event loop lag
 * 3. **Custom metrics API** - Add your own counters, histograms, gauges
 *
 * ## Viewing Metrics
 *
 * ```bash
 * curl http://localhost:3001/metrics
 * ```
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/213
 */
export { MetricsModule, MetricsModuleOptions } from './metrics.module';
export { MetricsService } from './metrics.service';
export { MetricsInterceptor } from './metrics.interceptor';
