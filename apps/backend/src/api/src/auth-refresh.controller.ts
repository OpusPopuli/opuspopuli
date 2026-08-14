import {
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { HmacSignerService } from 'src/common/services/hmac-signer.service';
import { SecureLogger } from 'src/common/services/secure-logger.service';
import {
  setAuthCookies,
  clearAuthCookies,
} from 'src/common/utils/cookie.utils';

/**
 * The renewal mutation lives on the users subgraph and is `@inaccessible`, so
 * it is absent from the composed public schema and unreachable through the
 * federated router. This controller calls the subgraph directly instead, which
 * is the entire reason it exists as REST rather than as a client-facing
 * mutation.
 */
const REFRESH_MUTATION = `
  mutation RefreshSession($refreshToken: String!) {
    refreshSession(refreshToken: $refreshToken) {
      accessToken
      idToken
      refreshToken
    }
  }
`;

interface SubgraphConfig {
  name: string;
  url: string;
}

/**
 * Session renewal endpoint — `POST /api/auth/refresh`.
 *
 * The path is not arbitrary. `setAuthCookies` has always scoped the refresh
 * cookie to `path: '/api/auth/refresh'`, so the browser sends that cookie here
 * and to nothing else. Serving renewal anywhere else — including as a plain
 * GraphQL mutation at `/api` — would mean widening that scope and shipping a
 * 7-day credential with every request. The endpoint moved to meet the cookie,
 * not the other way round.
 *
 * SECURITY NOTES
 * - Responds 204 with NO body. The renewed tokens go back as httpOnly cookies
 *   and must never be readable by JavaScript.
 * - `CsrfMiddleware` covers this route via `forRoutes({path: '*'})`, so a POST
 *   without `X-CSRF-Token` is rejected before any of this runs. Callers must
 *   send it.
 * - The global `AuthGuard` defers on non-GraphQL execution contexts, which is
 *   required here: the access token is expired by definition, and the refresh
 *   cookie is the credential.
 */
@Controller('api/auth')
export class AuthRefreshController {
  private readonly logger = new SecureLogger(AuthRefreshController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly hmacSigner: HmacSignerService,
  ) {}

  private getUsersSubgraphUrl(): string {
    const raw = this.configService.get<string>('MICROSERVICES');
    const subgraphs = JSON.parse(raw || '[]') as SubgraphConfig[];
    const users = subgraphs.find((s) => s.name === 'users');
    if (!users?.url) {
      throw new Error('No users subgraph configured in MICROSERVICES');
    }
    return users.url;
  }

  @Post('refresh')
  @HttpCode(204)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieName =
      this.configService.get<string>('cookie.refreshTokenName') ||
      'refresh-token';
    const refreshToken = req.cookies?.[cookieName];

    if (!refreshToken) {
      // Nothing to renew. Clear whatever is left so the browser stops
      // presenting a half-dead session on every subsequent request.
      clearAuthCookies(res, this.configService);
      throw new UnauthorizedException('No refresh token');
    }

    let payload: {
      data?: { refreshSession?: RenewedTokens };
      errors?: { message: string; extensions?: { code?: string } }[];
    };

    try {
      const url = this.getUsersSubgraphUrl();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.hmacSigner.isEnabled()) {
        headers['X-HMAC-Auth'] = this.hmacSigner.signGraphQLRequest(url);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: REFRESH_MUTATION,
          variables: { refreshToken },
        }),
      });

      payload = await response.json();
    } catch (error) {
      // The users service was unreachable, or answered with something that is
      // not JSON. Cookies are deliberately LEFT ALONE — this says nothing
      // about whether the session is still valid, and clearing them here would
      // turn a transient outage into a forced sign-out for every active user.
      this.logger.error(
        `Refresh call to users subgraph failed: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('Session renewal unavailable');
    }

    const error = payload.errors?.[0];
    if (error) {
      // The distinction subtask 2 went to the trouble of preserving. Only a
      // rejected grant means "sign in again"; anything else is "try again".
      if (error.extensions?.code === 'REFRESH_TOKEN_INVALID') {
        clearAuthCookies(res, this.configService);
        throw new UnauthorizedException('Session expired');
      }
      this.logger.error(`Refresh rejected upstream: ${error.message}`);
      throw new ServiceUnavailableException('Session renewal unavailable');
    }

    const auth = payload.data?.refreshSession;
    if (!auth?.accessToken) {
      // No errors and no tokens should not happen. Treated as unavailable
      // rather than expired, because we have no evidence the session is dead
      // and the safe-looking default — clearing cookies — is the destructive
      // one.
      this.logger.error('Refresh returned neither tokens nor an error');
      throw new ServiceUnavailableException('Session renewal unavailable');
    }

    setAuthCookies(
      res,
      this.configService,
      auth.accessToken,
      auth.refreshToken,
    );

    // 204, no body. The tokens are in the cookies and nowhere else.
  }
}

interface RenewedTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}
