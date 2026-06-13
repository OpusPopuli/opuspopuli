import { UserInputError } from '@nestjs/apollo';
import { Response } from 'express';
import { IncomingHttpHeaders } from 'node:http';
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
 * Try to read the authenticated user's id from a federation request
 * context WITHOUT throwing on misses. Use this in field resolvers whose
 * **parent** queries are `@Public()` — the gateway forwards public
 * queries without invoking AuthGuard on the subgraph side, so
 * `req.user` never gets populated from the gateway-forwarded `user`
 * header. This helper mirrors AuthGuard's same trust model:
 *
 *   1. Prefer `req.user` (set by AuthMiddleware via JWT/Passport when
 *      the request actually authenticated against this subgraph).
 *   2. Fall back to the gateway-forwarded `user` HTTP header, but ONLY
 *      when the request also carries an HMAC signature — the same
 *      "HMAC-presence proves it came from our gateway" trust the
 *      AuthGuard uses at common/guards/auth.guard.ts lines 85-94.
 *   3. Return `undefined` on any miss/parse failure — never throw, so
 *      the parent query keeps serving unauthenticated callers.
 *
 * SECURITY: HMAC verification itself happens upstream (in the HMAC
 * guard/middleware that fronts the GraphQL endpoint). This helper just
 * gates on header presence — same as AuthGuard. If a request reaches
 * a field resolver, the HMAC has already been verified.
 *
 * @see common/guards/auth.guard.ts for the canonical guard behavior
 *      this safe variant mirrors.
 */
export function tryReadFederatedUserId(
  context: GqlContext,
): string | undefined {
  const req = context.req;
  if (req?.user?.id) return req.user.id;
  const headers = req?.headers as IncomingHttpHeaders | undefined;
  const hmacAuthHeader = headers?.['x-hmac-auth'];
  const userHeader = headers?.['user'];
  const hmacAuth = Array.isArray(hmacAuthHeader)
    ? hmacAuthHeader[0]
    : hmacAuthHeader;
  const userJson = Array.isArray(userHeader) ? userHeader[0] : userHeader;
  if (!hmacAuth || !userJson) return undefined;
  try {
    const parsed = JSON.parse(userJson) as { id?: unknown };
    return typeof parsed?.id === 'string' ? parsed.id : undefined;
  } catch {
    return undefined;
  }
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
      (context.req?.headers as Record<string, string>)?.['x-forwarded-for'] ||
      context.req?.ip,
    userAgent:
      (context.req?.headers as Record<string, string>)?.[
        'x-original-user-agent'
      ] || context.req?.headers?.['user-agent'],
    serviceName,
  };
}
