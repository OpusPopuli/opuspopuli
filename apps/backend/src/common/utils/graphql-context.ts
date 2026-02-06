import { UserInputError } from '@nestjs/apollo';
import { Response } from 'express';
import { ILogin } from 'src/interfaces/login.interface';

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
