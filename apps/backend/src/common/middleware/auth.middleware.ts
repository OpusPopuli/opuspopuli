import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Request, Response, NextFunction } from 'express';

import passport from 'passport';

// Headers that should be masked in logs to prevent credential exposure
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'x-api-key'];

/**
 * Routes that must run even when the presented access token does not validate.
 *
 * These are the session-lifecycle endpoints, and for both of them a bad token
 * is the NORMAL case rather than an error: renewal exists because the access
 * token has expired, and sign-out is most needed by the session that has
 * already gone stale.
 *
 * Without this, the middleware below answers the request itself and the route
 * never runs — so the endpoint whose entire job is to clear your cookies could
 * not clear them precisely when they most needed clearing. That was a
 * production bug: a user clicked "log out", the request was rejected here, the
 * cookies survived, and they stayed signed in as the previous account while
 * registering a new one.
 *
 * Skipping authentication is safe for exactly these two because neither trusts
 * `req.user`. Refresh authenticates with the refresh cookie, which GoTrue
 * validates; logout only clears cookies and asks the provider to revoke a token
 * that the caller already possessed. Nothing here grants access to data.
 */
const SESSION_LIFECYCLE_PATHS = ['/api/auth/refresh', '/api/auth/logout'];

function isSessionLifecyclePath(req: Request): boolean {
  // `path` excludes the query string; startsWith would let
  // `/api/auth/logout-something` through.
  const path = (req.path || req.url || '').split('?')[0];
  return SESSION_LIFECYCLE_PATHS.includes(path);
}

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
    // Extract JWT from httpOnly cookie if no Authorization header present
    if (!req.headers.authorization && req.cookies?.['access-token']) {
      req.headers.authorization = `Bearer ${req.cookies['access-token']}`;
    }

    if (req.headers.authorization) {
      passport.authenticate(
        'jwt',
        { session: false },
        (err: Error | null, user: Express.User | false) => {
          if (err) {
            return next(err);
          }

          if (!user) {
            // Let the session-lifecycle routes decide for themselves. They are
            // reached with a dead token by design, and answering here would
            // stop logout from clearing the very cookie that failed to
            // validate. `req.user` stays unset, so anything downstream that
            // needs an authenticated caller still sees none.
            if (isSessionLifecyclePath(req)) {
              return next();
            }

            // NOTE: this answers 200 with `success: false`, which is wrong —
            // an auth failure is indistinguishable from a successful call to
            // any client that checks the status code first. Deliberately NOT
            // changed here: it alters every auth-failure response on the
            // gateway, which is too wide a blast radius to attach to an urgent
            // logout fix that cannot be end-to-end tested first. Tracked
            // separately.
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
