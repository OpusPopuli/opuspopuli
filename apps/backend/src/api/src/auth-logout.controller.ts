import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// `import type`, not a value import. NestJS emits decorator metadata for
// `@Req() req: Request`, which turns the type into a RUNTIME reference that
// webpack then tries to resolve — and express is not a declared dependency
// of this package, so the bundle build reports it as unresolvable. Erasing
// the import at compile time removes the reference and the error with it.
import type { Request, Response } from 'express';
import { HmacSignerService } from 'src/common/services/hmac-signer.service';
import { SecureLogger } from 'src/common/services/secure-logger.service';
import { clearAuthCookies } from 'src/common/utils/cookie.utils';
import { callUsersSubgraph } from './users-subgraph.client';

/**
 * `@inaccessible` on the users subgraph, so it is absent from the composed
 * public schema and reachable only by a direct HMAC-signed call from here.
 * The access token travels as a variable to a service-to-service endpoint, not
 * from a browser through `/api`.
 */
const REVOKE_MUTATION = `
  mutation RevokeSession($accessToken: String!) {
    revokeSession(accessToken: $accessToken)
  }
`;

/**
 * Sign-out endpoint — `POST /api/auth/logout`.
 *
 * Replaces the federated `logout` mutation, which failed to sign anyone out in
 * production. Two independent defects, both confirmed against the live system:
 *
 * 1. **The clear never reached the browser.** `logout` runs on the users
 *    subgraph and clears cookies on the SUBGRAPH's response, relying on the
 *    gateway's `didReceiveResponse` to forward `Set-Cookie` onward. Whatever
 *    the mechanism, it does not survive that hop for the clear: after a
 *    successful logout the browser still held a valid access token, and was
 *    still authenticated as the previous user seven minutes later — long
 *    enough to register a NEW account and land in the OLD account's briefing.
 *    Clearing from the gateway, where the response to the browser is actually
 *    written, is verifiable with a single curl and needs no forwarding at all.
 *
 * 2. **Logout required a valid access token.** The mutation sits behind the
 *    auth guard, so once the 15-minute token lapsed, clicking "log out"
 *    returned `Forbidden resource` and cleared nothing — leaving the 7-day
 *    refresh cookie intact on exactly the sessions most likely to want out.
 *    This route is reachable without a live access token by design.
 *
 * The ordering rule this is built around: **cookies are cleared no matter what
 * happens upstream.** Provider down, subgraph unreachable, token already
 * expired — the browser still stops being signed in. A logout that reports
 * failure and leaves the user authenticated is the worst of both worlds, and
 * is what the old path did.
 *
 * SECURITY NOTES
 * - Responds 204 with no body; nothing here is readable by JavaScript.
 * - `CsrfMiddleware` covers this route via `forRoutes({path: '*'})`, so a POST
 *   without `X-CSRF-Token` is rejected before any of this runs.
 * - The refresh cookie is cleared at `REFRESH_COOKIE_PATH`, which is where it
 *   was set. `clearAuthCookies` owns that correspondence.
 */
@Controller('api/auth')
export class AuthLogoutController {
  private readonly logger = new SecureLogger(AuthLogoutController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly hmacSigner: HmacSignerService,
  ) {}

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const accessTokenName =
      this.configService.get<string>('cookie.accessTokenName') ||
      'access-token';
    const accessToken = req.cookies?.[accessTokenName];

    // Revoke upstream FIRST, but never let it decide whether we clear.
    // Wrapped rather than awaited bare so that a throw cannot skip the clear
    // below — that skip is the entire bug being fixed here.
    if (accessToken) {
      await this.revokeUpstream(accessToken);
    }

    clearAuthCookies(res, this.configService);

    // 204, no body. The browser is signed out whether or not the provider
    // agreed, and the response says nothing a caller could act on wrongly.
  }

  /**
   * Tell the users subgraph to revoke the session at the auth provider.
   *
   * Failures are logged and swallowed. The provider's refresh token outliving
   * the session is a real problem, but it is not one the user can do anything
   * about from a sign-out button, and blocking on it would keep them signed
   * in on the device in front of them.
   */
  private async revokeUpstream(accessToken: string): Promise<void> {
    try {
      const payload = await callUsersSubgraph<{ revokeSession?: boolean }>(
        this.configService,
        this.hmacSigner,
        REVOKE_MUTATION,
        { accessToken },
      );

      const error = payload.errors?.[0];
      if (error) {
        this.logger.warn(`Session revocation rejected: ${error.message}`);
      }
    } catch (error) {
      this.logger.warn(
        `Session revocation call failed: ${(error as Error).message}`,
      );
    }
  }
}
