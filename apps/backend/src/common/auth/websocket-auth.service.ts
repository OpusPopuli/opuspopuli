import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt, { JwtHeader, JwtPayload, SigningKeyCallback } from 'jsonwebtoken';
import jwksRsa, { JwksClient } from 'jwks-rsa';
import { ILogin } from 'src/interfaces/login.interface';

interface ISupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

/**
 * WebSocket Authentication Service
 *
 * Validates JWT tokens from WebSocket connection params for GraphQL subscriptions.
 * Uses Supabase Auth JWKS verification for token validation.
 *
 * SECURITY: This prevents unauthorized access to real-time subscription data.
 * All WebSocket connections must provide a valid JWT in connection params.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/194
 */
@Injectable()
export class WebSocketAuthService {
  private readonly logger = new Logger(WebSocketAuthService.name);
  private readonly jwksClient: JwksClient;
  private readonly issuer: string;

  constructor(private readonly configService: ConfigService) {
    const supabaseConfig = this.configService.get<ISupabaseConfig>('supabase');
    if (!supabaseConfig?.url) {
      throw new Error('Supabase configuration is missing');
    }

    // Supabase Auth JWT issuer is the project URL with /auth/v1
    this.issuer = `${supabaseConfig.url}/auth/v1`;

    // Initialize JWKS client for fetching Supabase public keys
    this.jwksClient = jwksRsa({
      jwksUri: `${supabaseConfig.url}/auth/v1/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 600000, // 10 minutes
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }

  /**
   * Get the signing key from Supabase JWKS endpoint
   */
  private getKey(header: JwtHeader, callback: SigningKeyCallback): void {
    if (!header.kid) {
      callback(new Error('No kid found in token header'));
      return;
    }

    this.jwksClient.getSigningKey(header.kid, (err, key) => {
      if (err) {
        callback(err);
        return;
      }
      const signingKey = key?.getPublicKey();
      callback(null, signingKey);
    });
  }

  /**
   * Validate a JWT token and return the user payload
   *
   * @param token - JWT token from WebSocket connection params
   * @returns Promise<ILogin | null> - User payload or null if invalid
   */
  async validateToken(token: string): Promise<ILogin | null> {
    if (!token) {
      this.logger.warn('WebSocket auth failed: No token provided');
      return null;
    }

    // Remove 'Bearer ' prefix if present
    const cleanToken = token.replace(/^Bearer\s+/i, '');

    try {
      const decoded = await new Promise<JwtPayload>((resolve, reject) => {
        jwt.verify(
          cleanToken,
          (header: JwtHeader, callback: SigningKeyCallback) =>
            this.getKey(header, callback),
          {
            algorithms: ['RS256'],
            issuer: this.issuer,
          },
          (err: Error | null, decoded: JwtPayload | string | undefined) => {
            if (err) {
              reject(err);
            } else {
              resolve(decoded as JwtPayload);
            }
          },
        );
      });

      // Extract user info from Supabase JWT payload
      const user: ILogin = {
        id: decoded['sub'] as string,
        email: decoded['email'] as string,
        roles: (decoded['app_metadata']?.roles as string[]) || [],
        department: (decoded['user_metadata']?.department as string) || '',
        clearance: (decoded['user_metadata']?.clearance as string) || '',
      };

      this.logger.debug(`WebSocket authenticated user: ${user.email}`);
      return user;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`WebSocket auth failed: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Validate connection params and extract user
   * Used in GraphQL WebSocket onConnect handler
   *
   * @param connectionParams - WebSocket connection parameters
   * @returns Promise<ILogin> - Authenticated user
   * @throws Error if authentication fails
   */
  async authenticateConnection(
    connectionParams: Record<string, unknown>,
  ): Promise<ILogin> {
    // Try different common auth header patterns
    const token =
      (connectionParams?.authorization as string) ||
      (connectionParams?.Authorization as string) ||
      (connectionParams?.authToken as string) ||
      (connectionParams?.accessToken as string);

    if (!token) {
      this.logger.warn(
        'WebSocket connection rejected: Missing authentication token',
      );
      throw new Error('Missing authentication token');
    }

    const user = await this.validateToken(token);

    if (!user) {
      this.logger.warn(
        'WebSocket connection rejected: Invalid authentication token',
      );
      throw new Error('Invalid authentication token');
    }

    this.logger.log(`WebSocket connection authenticated for user: ${user.id}`);
    return user;
  }
}
