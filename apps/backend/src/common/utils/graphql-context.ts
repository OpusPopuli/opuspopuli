import { UserInputError } from '@nestjs/apollo';
import { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ILogin } from 'src/interfaces/login.interface';
import { IAuditContext } from '../interfaces/audit.interface';

/**
 * User information extracted from the authenticated context
 * @deprecated Use ILogin instead for full user information
 */
export interface UserInfo {
  id: string;
  email: string;
}

/**
 * GraphQL context interface representing the request context
 */
export interface GqlContext {
  req: {
    ip?: string;
    user?: ILogin;
    headers: {
      'user-agent'?: string;
      authorization?: string;
    };
    cookies?: Record<string, string>;
  };
  res?: Response;
}

/**
 * Extracts authenticated user information from GraphQL context.
 *
 * SECURITY: The user is set on req.user by the AuthMiddleware after JWT validation
 * via Passport.js. This function ONLY trusts req.user, never req.headers.user
 * which can be spoofed by clients.
 *
 * @param context - The GraphQL context containing the request
 * @returns The authenticated user's ILogin information
 * @throws UserInputError if user is not authenticated
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/183
 *
 * @example
 * ```typescript
 * @Query(() => UserProfile)
 * async getMyProfile(@Context() context: GqlContext): Promise<UserProfile> {
 *   const user = getUserFromContext(context);
 *   return this.profileService.getProfile(user.id);
 * }
 * ```
 */
export function getUserFromContext(context: GqlContext): ILogin {
  // SECURITY: Only trust request.user which is set by AuthMiddleware
  // after JWT validation via Passport.js. Never trust request.headers.user
  // as it can be spoofed by clients.
  const user = context.req.user;
  if (!user) {
    throw new UserInputError('User not authenticated');
  }
  return user;
}

/**
 * Extracts the session token from the Authorization header.
 *
 * @param context - The GraphQL context containing the request
 * @returns The JWT token without the "Bearer " prefix, or undefined if not present
 */
export function getSessionTokenFromContext(
  context: GqlContext,
): string | undefined {
  const auth = context.req.headers.authorization;
  if (!auth) {
    return undefined;
  }
  // Extract token from "Bearer <token>"
  return auth.replace(/^Bearer\s+/i, '');
}

/**
 * Creates an audit context from the GraphQL request context.
 *
 * @param context - The GraphQL context containing the request
 * @param serviceName - The name of the service creating the audit entry
 * @param userEmail - Optional email override (for unauthenticated flows like registration/login)
 * @returns An IAuditContext with request metadata for audit logging
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/191
 */
export function createAuditContext(
  context: GqlContext,
  serviceName: string,
  userEmail?: string,
): IAuditContext {
  const user = context.req?.user;
  return {
    requestId: randomUUID(),
    userId: user?.id,
    userEmail: userEmail || user?.email,
    ipAddress:
      context.req?.ip ||
      (context.req?.headers as Record<string, string>)?.['x-forwarded-for'],
    userAgent: context.req?.headers?.['user-agent'],
    serviceName,
  };
}
