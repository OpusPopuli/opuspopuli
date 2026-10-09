/**
 * Metrics Interceptor
 *
 * NestJS interceptor that automatically records HTTP request metrics.
 * Applied globally to capture all incoming requests.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/213
 */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

/**
 * Interceptor that records HTTP request duration and counts
 *
 * ## How it works:
 * 1. Records the start time when request begins
 * 2. After response is sent, calculates duration
 * 3. Records metrics with labels for method, route, status code
 *
 * ## Excludes:
 * - /metrics endpoint (to avoid infinite loop)
 * - /health endpoints (too noisy, not useful)
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly metricsService: MetricsService,
    @Inject('METRICS_OPTIONS')
    private readonly options: { serviceName: string },
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only handle HTTP requests (not WebSocket, GraphQL subscriptions, etc.)
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Skip metrics and health endpoints
    const path = request.path || request.url;
    if (this.shouldSkip(path)) {
      return next.handle();
    }

    const startTime = process.hrtime.bigint();
    const method = request.method;
    const route = this.getRoute(request);

    return next.handle().pipe(
      tap({
        next: () => {
          this.recordMetrics(method, route, response.statusCode, startTime);
        },
        error: (error) => {
          // Record error metrics with appropriate status code
          const statusCode = error.status || error.statusCode || 500;
          this.recordMetrics(method, route, statusCode, startTime);
        },
      }),
    );
  }

  /**
   * Check if this path should be skipped for metrics
   */
  private shouldSkip(path: string): boolean {
    const skipPaths = ['/metrics', '/health', '/health/live', '/health/ready'];
    return skipPaths.some((skip) => path.startsWith(skip));
  }

  /**
   * Get the route **pattern**, or a fixed placeholder — never the raw URL.
   *
   * The pattern (`/users/:id`) is bounded by the routes the app registers. The
   * raw path is bounded by nothing, because it is chosen by the caller, so the
   * previous fallback put caller-controlled text into a metric label (#1344).
   *
   * In practice little reached that fallback: the interceptor is bound globally
   * via `APP_INTERCEPTOR` and the app registers no wildcard routes, so NestJS
   * answers an unmatched path with a 404 without running interceptors. That
   * makes this hardening rather than an incident — but "no handler matched" is
   * all the fallback can honestly report, and reporting it as a distinct value
   * is more useful than a thousand one-off paths anyway: `unmatched` rising is
   * a signal, whereas the raw paths were noise that also cost memory.
   */
  private getRoute(request: {
    route?: { path?: string };
    path?: string;
    url?: string;
  }): string {
    return request.route?.path ?? 'unmatched';
  }

  /**
   * Record the metrics
   */
  private recordMetrics(
    method: string,
    route: string,
    statusCode: number,
    startTime: bigint,
  ): void {
    const endTime = process.hrtime.bigint();
    const durationNs = endTime - startTime;
    const durationSeconds = Number(durationNs) / 1e9;

    this.metricsService.recordHttpRequest(
      method,
      route,
      statusCode,
      durationSeconds,
      this.options.serviceName,
    );
  }
}
