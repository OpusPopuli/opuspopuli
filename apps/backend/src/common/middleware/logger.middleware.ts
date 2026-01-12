import { Inject, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  ILogger,
  LOGGER,
  createLogger,
  LogLevel,
} from '@qckstrt/logging-provider';
import { isProduction } from 'src/config/environment.config';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger: ILogger;

  constructor(@Optional() @Inject(LOGGER) logger?: ILogger) {
    // Use injected logger or create a default one
    this.logger =
      logger?.child('LoggerMiddleware') ??
      createLogger({
        serviceName: 'backend',
        level: LogLevel.INFO,
        format: isProduction() ? 'json' : 'pretty',
      });
  }

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const requestId =
      (req.headers['x-request-id'] as string) || crypto.randomUUID();
    const userId = req.headers['user'] as string;
    const ipAddress = this.extractIpAddress(req);

    // Attach audit context to request for downstream use
    req.auditContext = {
      requestId,
      ipAddress,
      userAgent: req.headers['user-agent'],
      startTime: start,
    };

    res.setHeader('x-request-id', requestId);

    // Set request context
    this.logger.setRequestId(requestId);
    if (userId) {
      this.logger.setUserId(userId);
    }

    // Log incoming request
    this.logger.info('Incoming request', undefined, {
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
      ipAddress,
    });

    // Log response on finish
    res.on('finish', () => {
      const duration = Date.now() - start;
      this.logger.info('Request completed', undefined, {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        durationMs: duration,
        ipAddress,
      });
    });

    next();
  }

  private extractIpAddress(req: Request): string | undefined {
    // Check X-Forwarded-For header (load balancer/proxy)
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor.split(',')[0];
      return ips?.trim();
    }

    // Check other common headers
    const realIp = req.headers['x-real-ip'];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    // Fall back to socket remote address
    return req.ip || req.socket?.remoteAddress || undefined;
  }
}
