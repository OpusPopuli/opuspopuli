import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { IAuthConfig } from 'src/config';

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
  constructor(private configService: ConfigService) {
    const authConfig: IAuthConfig | undefined =
      configService.get<IAuthConfig>('auth');

    if (!authConfig) {
      throw new ConfigurationException('Authentication config is missing');
    }

    const region = configService.get<string>('region');
    const issuer = `https://cognito-idp.${region}.amazonaws.com/${authConfig.userPoolId}`;

    super({
      // Extract JWT from Authorization header OR httpOnly cookie
      // This allows both API clients (header) and browser clients (cookie) to authenticate
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        extractFromCookie,
      ]),
      ignoreExpiration: false,
      audience: authConfig.clientId,
      issuer,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${issuer}/.well-known/jwks.json`,
      }),
    });
  }

  async validate(payload: Record<string, unknown>): Promise<ILogin> {
    return {
      id: payload['sub'] as string,
      email: payload['email'] as string,
      roles: (payload['cognito:groups'] as string[]) || [],
      department: payload['custom:department'] as string,
      clearance: payload['custom:clearance'] as string,
    };
  }
}
