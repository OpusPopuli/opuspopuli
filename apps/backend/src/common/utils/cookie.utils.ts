import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

type SameSitePolicy = 'strict' | 'lax' | 'none';

/**
 * Cookie options interface
 */
export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: SameSitePolicy;
  maxAge: number;
  path: string;
  domain?: string;
}

/**
 * Get common cookie options from configuration
 */
export function getCookieOptions(
  configService: ConfigService,
  overrides: Partial<CookieOptions> = {},
): CookieOptions {
  return {
    httpOnly: true,
    secure:
      configService.get<boolean>('cookie.secure') ??
      configService.get('NODE_ENV') === 'production',
    sameSite: configService.get<SameSitePolicy>('cookie.sameSite') || 'strict',
    maxAge:
      configService.get<number>('cookie.accessTokenMaxAge') || 15 * 60 * 1000,
    path: '/',
    domain: configService.get<string>('cookie.domain'),
    ...overrides,
  };
}

/**
 * Set authentication cookies on response
 *
 * @param res - Express response object
 * @param configService - NestJS ConfigService
 * @param accessToken - JWT access token
 * @param refreshToken - Optional refresh token
 */
export function setAuthCookies(
  res: Response,
  configService: ConfigService,
  accessToken: string,
  refreshToken?: string,
): void {
  const accessTokenName =
    configService.get<string>('cookie.accessTokenName') || 'access-token';
  const refreshTokenName =
    configService.get<string>('cookie.refreshTokenName') || 'refresh-token';

  // Set access token cookie
  res.cookie(accessTokenName, accessToken, getCookieOptions(configService));

  // Set refresh token cookie with longer expiry and restricted path
  if (refreshToken) {
    res.cookie(
      refreshTokenName,
      refreshToken,
      getCookieOptions(configService, {
        maxAge:
          configService.get<number>('cookie.refreshTokenMaxAge') ||
          7 * 24 * 60 * 60 * 1000,
        path: '/api/auth/refresh', // Only sent to refresh endpoint
      }),
    );
  }
}

/**
 * Clear authentication cookies on response
 *
 * @param res - Express response object
 * @param configService - NestJS ConfigService
 */
export function clearAuthCookies(
  res: Response,
  configService: ConfigService,
): void {
  const accessTokenName =
    configService.get<string>('cookie.accessTokenName') || 'access-token';
  const refreshTokenName =
    configService.get<string>('cookie.refreshTokenName') || 'refresh-token';
  const domain = configService.get<string>('cookie.domain');

  const clearOptions = {
    httpOnly: true,
    secure:
      configService.get<boolean>('cookie.secure') ??
      configService.get('NODE_ENV') === 'production',
    sameSite: (configService.get<SameSitePolicy>('cookie.sameSite') ||
      'strict') as SameSitePolicy,
    path: '/',
    domain,
  };

  res.clearCookie(accessTokenName, clearOptions);
  res.clearCookie(refreshTokenName, {
    ...clearOptions,
    path: '/api/auth/refresh',
  });
}
