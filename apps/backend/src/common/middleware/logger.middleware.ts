import { Inject, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { resolveClientIp } from '../utils/client-ip';
import { maskIpAddress } from '../utils/pii-masker';
import { redactUrl } from '../tracing-redaction';
import {
  ILogger,
  LOGGER,
  createLogger,
  LogLevel,
} from '@opuspopuli/logging-provider';
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

    // The log lines get a masked IP, a URL with its query values removed, and
    // no user agent (#1460). The audit context above keeps the full IP and
    // the user agent: the audit log is where they are meant to be kept. The
    // logging provider's redaction would catch an IPv4 address, but its IPv6
    // pattern misses compressed forms, so the IP is masked here rather than
    // trusted to a regex.
    const logIp = ipAddress ? maskIpAddress(ipAddress) : undefined;
    const logUrl = redactUrl(req.url);

    // Log incoming request
    this.logger.info('Incoming request', undefined, {
      method: req.method,
      url: logUrl,
      ipAddress: logIp,
    });

    // Log response on finish
    res.on('finish', () => {
      const duration = Date.now() - start;
      this.logger.info('Request completed', undefined, {
        method: req.method,
        url: logUrl,
        statusCode: res.statusCode,
        durationMs: duration,
        ipAddress: logIp,
      });
    });

    next();
  }

  private extractIpAddress(req: Request): string | undefined {
    // Never the client-chosen first x-forwarded-for hop, nor x-real-ip,
    // which a client can also set (#1456).
    return resolveClientIp(req.headers, req.ip || req.socket?.remoteAddress);
  }
}
