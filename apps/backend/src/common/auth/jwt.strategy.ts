import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

import { ILogin } from 'src/interfaces/login.interface';
import { ConfigurationException } from 'src/common/exceptions/app.exceptions';

/**
 * Extract JWT from httpOnly cookie
 * Used as fallback when Authorization header is not present
 */
const extractFromCookie = (req: Request): string | null => {
  if (req?.cookies?.['access-token']) {
    return req.cookies['access-token'];
  }
  return null;
};

export const isLoggedIn = (login: unknown): login is ILogin =>
  typeof login === 'object' &&
  login !== null &&
  'email' in login &&
  'id' in login &&
  'roles' in login &&
  'department' in login &&
  'clearance' in login;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const jwtSecret = configService.get<string>('AUTH_JWT_SECRET');
    if (!jwtSecret) {
      throw new ConfigurationException(
        'AUTH_JWT_SECRET is required for Supabase JWT validation',
      );
    }

    super({
      // Extract JWT from Authorization header OR httpOnly cookie
      // This allows both API clients (header) and browser clients (cookie) to authenticate
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        extractFromCookie,
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: Record<string, unknown>): Promise<ILogin> {
    const appMetadata = payload['app_metadata'] as
      | Record<string, unknown>
      | undefined;
    const userMetadata = payload['user_metadata'] as
      | Record<string, unknown>
      | undefined;

    return {
      id: payload['sub'] as string,
      email: payload['email'] as string,
      roles: (appMetadata?.['roles'] as string[]) || [],
      department: (userMetadata?.['department'] as string) || '',
      clearance: (userMetadata?.['clearance'] as string) || '',
    };
  }
}
