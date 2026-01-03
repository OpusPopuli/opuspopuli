import {
  Injectable,
  Logger,
  NestMiddleware,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { safeCompare } from '../utils/crypto.utils';

/**
 * CSRF Middleware - Stateless Double-Submit Cookie Pattern
 *
 * Protection against Cross-Site Request Forgery attacks:
 * 1. On every response, set/refresh a CSRF token cookie (not httpOnly, so JS can read it)
 * 2. On mutations (POST, PUT, DELETE, PATCH), validate that X-CSRF-Token header matches the cookie
 *
 * This is a stateless pattern - no server-side token storage required.
 * Security relies on the Same-Origin Policy preventing other sites from reading our cookies.
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CsrfMiddleware.name, {
    timestamp: true,
  });
  private readonly enabled: boolean;
  private readonly cookieName: string;
  private readonly headerName: string;
  private readonly tokenMaxAge: number;
  private readonly cookieDomain: string | undefined;
  private readonly secureCookies: boolean;
  private readonly sameSite: 'strict' | 'lax' | 'none';

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('csrf.enabled') ?? true;
    this.cookieName =
      this.configService.get<string>('csrf.cookieName') || 'csrf-token';
    this.headerName =
      this.configService.get<string>('csrf.headerName') || 'x-csrf-token';
    this.tokenMaxAge =
      this.configService.get<number>('csrf.tokenMaxAge') || 24 * 60 * 60 * 1000;
    this.cookieDomain = this.configService.get<string>('csrf.cookieDomain');
    this.secureCookies =
      this.configService.get<boolean>('cookie.secure') ??
      this.configService.get('NODE_ENV') === 'production';
    this.sameSite =
      this.configService.get<'strict' | 'lax' | 'none'>('cookie.sameSite') ||
      'strict';

    this.logger.log(
      `CSRF protection ${this.enabled ? 'enabled' : 'disabled'} - ` +
        `cookie: ${this.cookieName}, header: ${this.headerName}`,
    );
  }

  /**
   * Safe HTTP methods that don't require CSRF validation
   * These methods should not have side effects per RFC 7231
   */
  private readonly safeMethods = ['GET', 'HEAD', 'OPTIONS'];

  /**
   * Extract CSRF token from cookie
   */
  private getTokenFromCookie(req: Request): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cookies = (req as any).cookies;
    if (cookies && typeof cookies === 'object') {
      return cookies[this.cookieName];
    }

    // Fallback: parse cookie header manually
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return undefined;

    const cookies_parsed = cookieHeader.split(';').reduce(
      (acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        if (key && value) {
          acc[key] = decodeURIComponent(value);
        }
        return acc;
      },
      {} as Record<string, string>,
    );

    return cookies_parsed[this.cookieName];
  }

  /**
   * Extract CSRF token from header
   */
  private getTokenFromHeader(req: Request): string | undefined {
    const headerValue = req.headers[this.headerName.toLowerCase()];
    return Array.isArray(headerValue) ? headerValue[0] : headerValue;
  }

  /**
   * Generate a new CSRF token using cryptographically secure random UUID
   */
  private generateToken(): string {
    return randomUUID();
  }

  /**
   * Set CSRF token cookie on response
   */
  private setTokenCookie(res: Response, token: string): void {
    res.cookie(this.cookieName, token, {
      httpOnly: false, // JS needs to read this to send in header
      secure: this.secureCookies,
      sameSite: this.sameSite,
      maxAge: this.tokenMaxAge,
      path: '/',
      domain: this.cookieDomain,
    });
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Skip if CSRF protection is disabled
    if (!this.enabled) {
      return next();
    }

    // Get existing token from cookie or generate new one
    let csrfToken = this.getTokenFromCookie(req);
    if (!csrfToken) {
      csrfToken = this.generateToken();
    }

    // Always set/refresh the cookie
    this.setTokenCookie(res, csrfToken);

    // For safe methods, no validation needed
    if (this.safeMethods.includes(req.method.toUpperCase())) {
      return next();
    }

    // For non-safe methods, validate the token
    const headerToken = this.getTokenFromHeader(req);

    if (!headerToken) {
      this.logger.warn(
        `CSRF validation failed: Missing ${this.headerName} header for ${req.method} ${req.path}`,
      );
      throw new ForbiddenException('CSRF token required');
    }

    // Use constant-time comparison to prevent timing attacks
    // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/195
    if (!safeCompare(headerToken, csrfToken)) {
      this.logger.warn(
        `CSRF validation failed: Token mismatch for ${req.method} ${req.path}`,
      );
      throw new ForbiddenException('Invalid CSRF token');
    }

    return next();
  }
}
