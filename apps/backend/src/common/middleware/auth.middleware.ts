import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Request, Response, NextFunction } from 'express';

import passport from 'passport';

// Headers that should be masked in logs to prevent credential exposure
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'x-api-key'];

/**
 * Mask sensitive headers for safe logging
 */
function maskSensitiveHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const masked = { ...headers };
  for (const header of SENSITIVE_HEADERS) {
    if (masked[header]) {
      masked[header] = '[REDACTED]';
    }
  }
  return masked;
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly apiKeys: Map<string, string>;
  private readonly logger = new Logger(AuthMiddleware.name, {
    timestamp: true,
  });

  constructor(private readonly configService: ConfigService) {
    this.apiKeys =
      this.configService.get<Map<string, string>>('apiKeys') ||
      new Map<string, string>();
  }

  private async validateRequest(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    if (req.headers.authorization) {
      passport.authenticate(
        'jwt',
        { session: false },
        (err: Error | null, user: Express.User | false) => {
          if (err) {
            return next(err);
          }

          if (!user) {
            return res.send({
              success: false,
              message: 'Authorization Token is Invalid!',
            });
          }

          // Store user in req.user (Express standard) instead of headers
          // This prevents header spoofing if middleware is bypassed
          req.user = user;

          return next();
        },
      )(req, res, next);
    } else {
      return next();
    }
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Mask sensitive headers to prevent credential exposure in logs
    this.logger.log(
      `Request: ${JSON.stringify(maskSensitiveHeaders(req.headers as Record<string, unknown>))}`,
    );

    return this.validateRequest(req, res, next);
  }
}
