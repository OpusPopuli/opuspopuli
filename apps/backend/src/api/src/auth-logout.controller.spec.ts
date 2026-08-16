import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthLogoutController } from './auth-logout.controller';
import { HmacSignerService } from 'src/common/services/hmac-signer.service';

/**
 * The behaviour under test is not "logout calls the subgraph" — it is
 * "the browser stops being signed in, whatever else happens". Every case here
 * asserts the cookies were cleared, including the ones where the upstream call
 * fails, because that is precisely where the previous implementation broke.
 */
describe('AuthLogoutController', () => {
  const USERS_URL = 'http://users:3001/graphql';

  let controller: AuthLogoutController;
  let res: Response & { clearCookie: jest.Mock };
  let fetchMock: jest.Mock;

  const configService = {
    get: (key: string) => {
      if (key === 'MICROSERVICES') {
        return JSON.stringify([{ name: 'users', url: USERS_URL }]);
      }
      if (key === 'cookie.accessTokenName') return 'access-token';
      if (key === 'cookie.refreshTokenName') return 'refresh-token';
      if (key === 'cookie.domain') return '.opuspopuli.org';
      if (key === 'cookie.sameSite') return 'strict';
      if (key === 'cookie.secure') return true;
      return undefined;
    },
  } as unknown as ConfigService;

  const hmacSigner = {
    isEnabled: () => true,
    signGraphQLRequest: () => 'signed',
  } as unknown as HmacSignerService;

  const requestWith = (cookies: Record<string, string>) =>
    ({ cookies }) as unknown as Request;

  const clearedCookieNames = () =>
    res.clearCookie.mock.calls.map((call) => call[0] as string);

  beforeEach(() => {
    controller = new AuthLogoutController(configService, hmacSigner);
    res = { clearCookie: jest.fn() } as unknown as Response & {
      clearCookie: jest.Mock;
    };
    fetchMock = jest.fn().mockResolvedValue({ json: async () => ({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it('clears both auth cookies on a normal logout', async () => {
    await controller.logout(requestWith({ 'access-token': 'tok' }), res);

    expect(clearedCookieNames()).toEqual(
      expect.arrayContaining(['access-token', 'refresh-token']),
    );
  });

  it('clears the refresh cookie at the path it was set on', async () => {
    await controller.logout(requestWith({ 'access-token': 'tok' }), res);

    const refreshCall = res.clearCookie.mock.calls.find(
      (call) => call[0] === 'refresh-token',
    );
    // A clear aimed at the wrong path silently does nothing, leaving a 7-day
    // credential alive on a session the user believes they ended.
    expect(refreshCall?.[1]).toMatchObject({ path: '/api/auth/refresh' });
  });

  it('asks the users subgraph to revoke the session, HMAC-signed', async () => {
    await controller.logout(requestWith({ 'access-token': 'tok' }), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(USERS_URL);
    expect((init as RequestInit).headers).toMatchObject({
      'X-HMAC-Auth': 'signed',
    });
    expect((init as RequestInit).body).toContain('RevokeSession');
  });

  it('still clears cookies when the subgraph is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      controller.logout(requestWith({ 'access-token': 'tok' }), res),
    ).resolves.toBeUndefined();

    // The whole point. An outage must not be able to leave someone signed in.
    expect(clearedCookieNames()).toEqual(
      expect.arrayContaining(['access-token', 'refresh-token']),
    );
  });

  it('still clears cookies when the subgraph returns a GraphQL error', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ errors: [{ message: 'token already revoked' }] }),
    });

    await controller.logout(requestWith({ 'access-token': 'tok' }), res);

    expect(clearedCookieNames()).toEqual(
      expect.arrayContaining(['access-token', 'refresh-token']),
    );
  });

  it('clears cookies even with no access token to revoke', async () => {
    // The expired-session path: the access cookie has already been dropped by
    // the browser, but the 7-day refresh cookie has not. The old auth-guarded
    // mutation rejected this case outright and cleared nothing.
    await controller.logout(requestWith({}), res);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(clearedCookieNames()).toEqual(
      expect.arrayContaining(['access-token', 'refresh-token']),
    );
  });
});
