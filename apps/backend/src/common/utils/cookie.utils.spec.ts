import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import {
  setAuthCookies,
  clearAuthCookies,
  REFRESH_COOKIE_PATH,
} from './cookie.utils';

const createConfigService = (overrides: Record<string, unknown> = {}) =>
  ({
    get: jest.fn((key: string) =>
      key in overrides ? overrides[key] : undefined,
    ),
  }) as unknown as ConfigService;

const createResponse = () =>
  ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  }) as unknown as Response;

describe('cookie.utils', () => {
  const pathOf = (call: unknown[]) =>
    (call[call.length - 1] as { path?: string }).path;

  describe('refresh cookie scoping', () => {
    it('sets the refresh cookie at the renewal path, not site-wide', () => {
      const res = createResponse();

      setAuthCookies(res, createConfigService(), 'access', 'refresh');

      const calls = (res.cookie as jest.Mock).mock.calls;
      const accessCall = calls[0];
      const refreshCall = calls[1];

      // The access token is needed on every request; the refresh token is a
      // 7-day credential and must not ride along with them.
      expect(pathOf(accessCall)).toBe('/');
      expect(pathOf(refreshCall)).toBe(REFRESH_COOKIE_PATH);
    });

    // A clear at the wrong path silently does nothing: the browser keeps
    // presenting the old refresh cookie after logout.
    it('clears the refresh cookie at the SAME path it was set at', () => {
      const setRes = createResponse();
      setAuthCookies(setRes, createConfigService(), 'access', 'refresh');
      const setPath = pathOf((setRes.cookie as jest.Mock).mock.calls[1]);

      const clearRes = createResponse();
      clearAuthCookies(clearRes, createConfigService());
      const clearCalls = (clearRes.clearCookie as jest.Mock).mock.calls;
      const clearPath = pathOf(clearCalls[1]);

      expect(clearPath).toBe(setPath);
    });

    it('clears the access cookie site-wide', () => {
      const res = createResponse();

      clearAuthCookies(res, createConfigService());

      expect(pathOf((res.clearCookie as jest.Mock).mock.calls[0])).toBe('/');
    });

    it('omits the refresh cookie entirely when no refresh token is issued', () => {
      const res = createResponse();

      setAuthCookies(res, createConfigService(), 'access-only');

      expect((res.cookie as jest.Mock).mock.calls).toHaveLength(1);
    });
  });

  describe('configured names are honoured on both set and clear', () => {
    // Renaming the cookie must not orphan the old one at logout.
    it('uses the configured cookie names symmetrically', () => {
      const config = createConfigService({
        'cookie.accessTokenName': 'custom-access',
        'cookie.refreshTokenName': 'custom-refresh',
      });

      const setRes = createResponse();
      setAuthCookies(setRes, config, 'a', 'r');
      const clearRes = createResponse();
      clearAuthCookies(clearRes, config);

      const setNames = (setRes.cookie as jest.Mock).mock.calls.map((c) => c[0]);
      const clearNames = (clearRes.clearCookie as jest.Mock).mock.calls.map(
        (c) => c[0],
      );

      expect(setNames).toEqual(['custom-access', 'custom-refresh']);
      expect(clearNames).toEqual(['custom-access', 'custom-refresh']);
    });
  });
});
