import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { MetricsModuleOptions } from '../metrics/metrics.module';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Request count and latency for the gateway's GraphQL endpoint (#1456).
 *
 * The gateway had none. Its HTTP metrics come from `MetricsInterceptor`, a
 * Nest interceptor, and Apollo Gateway executes operations without Nest
 * resolvers, so no GraphQL request ever reached it; neither does a 429 from
 * `GraphqlRateLimitMiddleware`, which answers before any interceptor runs.
 * With the civic record open to anyone, the two things worth an alert are
 * exactly those: how often visitors are refused, and how slow the gateway is.
 *
 * Registered first on `/api` and `/api/*`, like the limiter. It records the
 * GraphQL endpoint itself, and any 429 wherever it was refused; a REST
 * route under `/api/` that got through is already recorded by the
 * interceptor, and counting it here too would observe it twice in the
 * route-less latency histogram. One fixed route label, so no cardinality.
 */
@Injectable()
export class GatewayRequestMetricsMiddleware implements NestMiddleware {
  constructor(
    private readonly metrics: MetricsService,
    @Inject('METRICS_OPTIONS') private readonly options: MetricsModuleOptions,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const started = process.hrtime.bigint();
    const isGraphql =
      (req.originalUrl ?? req.url ?? '').split('?')[0] === '/api';
    res.once('finish', () => {
      if (!isGraphql && res.statusCode !== 429) return;
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this.metrics.recordHttpRequest(
        req.method,
        '/api',
        res.statusCode,
        seconds,
        this.options.serviceName,
      );
    });
    next();
  }
}
