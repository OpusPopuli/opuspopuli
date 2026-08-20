import { Request } from 'express';
import { ILogin } from 'src/interfaces/login.interface';
import { isLoggedIn } from 'src/common/auth/jwt.strategy';

/**
 * Resolve the authenticated user for a request, from either source of truth.
 *
 * Two legitimate origins:
 *  - `request.user`, set by AuthMiddleware after Passport validates a JWT
 *    (the gateway's own routes), and
 *  - the gateway-forwarded `user` header on HMAC-authenticated subgraph
 *    requests. The HMAC signature — verified by HMACMiddleware before any
 *    guard runs — proves the request came from our gateway, which already
 *    validated the user's JWT before forwarding. A spoofed header without a
 *    valid signature never reaches this code.
 *
 * THE BUG THIS EXTRACTS ITS WAY OUT OF. AuthGuard and RolesGuard each carried
 * this fallback as private copies; PoliciesGuard did not, and read only
 * `request.user`. PoliciesGuard is a GLOBAL guard, so it runs before the
 * route-level AuthGuard that would have populated `request.user` — meaning
 * every resolver carrying `@Permissions` denied every caller, always. The
 * documents service is the only one using `@Permissions` on user-facing
 * resolvers, so its entire petition surface returned `Forbidden resource` to
 * fully-authenticated users — which the frontend then classified as an
 * expired session and answered by logging the user out. Clicking "Petition"
 * in the nav kicked you out of the app.
 *
 * Attaches the parsed user to `request.user` so later guards and resolvers
 * see the same identity without re-parsing.
 */
export function resolveRequestUser(
  request:
    | (Request & { user?: ILogin; headers: Record<string, unknown> })
    | undefined,
): ILogin | undefined {
  if (!request) return undefined;
  if (request.user && isLoggedIn(request.user)) return request.user;

  const hasHmacAuth = request.headers?.['x-hmac-auth'];
  const forwarded = request.headers?.['user'];
  if (hasHmacAuth && typeof forwarded === 'string') {
    try {
      const user = JSON.parse(forwarded) as ILogin;
      if (isLoggedIn(user)) {
        request.user = user;
        return user;
      }
    } catch {
      // Invalid user header — fall through to undefined (denial).
    }
  }

  return undefined;
}
