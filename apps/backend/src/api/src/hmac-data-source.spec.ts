import { HmacRemoteGraphQLDataSource } from './hmac-data-source';
import { HmacSignerService } from 'src/common/services/hmac-signer.service';
import * as otelApi from '@opentelemetry/api';

describe('HmacRemoteGraphQLDataSource', () => {
  let dataSource: HmacRemoteGraphQLDataSource;
  let mockHmacSigner: jest.Mocked<HmacSignerService>;

  beforeEach(() => {
    mockHmacSigner = {
      isEnabled: jest.fn().mockReturnValue(false),
      signGraphQLRequest: jest.fn(),
    } as unknown as jest.Mocked<HmacSignerService>;

    dataSource = new HmacRemoteGraphQLDataSource(
      { url: 'http://localhost:4001/graphql' },
      mockHmacSigner,
    );
  });

  describe('willSendRequest', () => {
    it('should propagate W3C trace context headers to subgraph requests', () => {
      const mockHeaders = new Map<string, string>();
      const mockRequest = {
        http: {
          url: 'http://localhost:4001/graphql',
          headers: {
            set: (key: string, value: string) => mockHeaders.set(key, value),
          },
        },
      };

      // Mock OTel propagation to inject a traceparent header
      jest
        .spyOn(otelApi.propagation, 'inject')
        .mockImplementation((_context, carrier: Record<string, string>) => {
          carrier['traceparent'] =
            '00-abcdef1234567890abcdef1234567890-1234567890abcdef-01';
        });

      dataSource.willSendRequest({
        request: mockRequest,
        context: {},
      } as unknown as Parameters<typeof dataSource.willSendRequest>[0]);

      expect(otelApi.propagation.inject).toHaveBeenCalled();
      expect(mockHeaders.get('traceparent')).toBe(
        '00-abcdef1234567890abcdef1234567890-1234567890abcdef-01',
      );

      jest.restoreAllMocks();
    });

    it('should forward client IP and user agent from gateway context', () => {
      const mockHeaders = new Map<string, string>();
      const mockRequest = {
        http: {
          url: 'http://localhost:4001/graphql',
          headers: {
            set: (key: string, value: string) => mockHeaders.set(key, value),
          },
        },
      };

      jest.spyOn(otelApi.propagation, 'inject').mockImplementation(() => {});

      dataSource.willSendRequest({
        request: mockRequest,
        context: {
          clientIp: '192.168.1.100',
          clientUserAgent: 'Mozilla/5.0 Chrome/120',
        },
      } as unknown as Parameters<typeof dataSource.willSendRequest>[0]);

      expect(mockHeaders.get('x-forwarded-for')).toBe('192.168.1.100');
      expect(mockHeaders.get('x-original-user-agent')).toBe(
        'Mozilla/5.0 Chrome/120',
      );

      jest.restoreAllMocks();
    });

    it('should not set forwarding headers when context lacks client info', () => {
      const mockHeaders = new Map<string, string>();
      const mockRequest = {
        http: {
          url: 'http://localhost:4001/graphql',
          headers: {
            set: (key: string, value: string) => mockHeaders.set(key, value),
          },
        },
      };

      jest.spyOn(otelApi.propagation, 'inject').mockImplementation(() => {});

      dataSource.willSendRequest({
        request: mockRequest,
        context: {},
      } as unknown as Parameters<typeof dataSource.willSendRequest>[0]);

      expect(mockHeaders.has('x-forwarded-for')).toBe(false);
      expect(mockHeaders.has('x-original-user-agent')).toBe(false);

      jest.restoreAllMocks();
    });
  });
  describe('Set-Cookie survival through Apollo (issue #1020)', () => {
    /*
     * setAuthCookies emits TWO Set-Cookie headers — access-token, then
     * refresh-token. Apollo stores subgraph response headers in HeaderMap,
     * which `extends Map`, so it keeps ONE value per key and silently dropped
     * the second cookie.
     *
     * The browser therefore never received refresh-token, renewal could never
     * run, and every session died at the 15-minute access-token expiry. That
     * is the bug #977 was opened for, and it outlived the entire refresh
     * implementation because none of it could work without this cookie.
     *
     * These test the wrapped fetcher directly, since that is where the
     * collapse has to happen — anything downstream is already too late.
     */
    const ACCESS =
      'access-token=aaa; Max-Age=900; Domain=.opuspopuli.org; Path=/; Expires=Sun, 16 Aug 2026 18:15:00 GMT; HttpOnly; Secure; SameSite=Strict';
    const REFRESH =
      'refresh-token=bbb; Max-Age=604800; Domain=.opuspopuli.org; Path=/api/auth/refresh; Expires=Sun, 23 Aug 2026 18:00:00 GMT; HttpOnly; Secure; SameSite=Strict';

    const respondWith = (cookies: string[]) => {
      const headers = new Headers({ 'content-type': 'application/json' });
      for (const c of cookies) headers.append('set-cookie', c);
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers,
      });
    };

    let realFetch: typeof fetch;
    beforeEach(() => {
      realFetch = globalThis.fetch;
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    // The fetcher the data source was constructed with.
    const fetcherOf = (ds: HmacRemoteGraphQLDataSource) =>
      (ds as unknown as { fetcher: typeof fetch }).fetcher;

    /*
     * The CLEAR shape, which no existing test covered — and #1019 was a
     * production security bug precisely here: users stayed authenticated
     * after logout, and one landed in a previous account's data.
     *
     * `res.clearCookie` emits an EMPTY value and an epoch `Expires`, so the
     * bytes differ from the set shape in two ways at once. The existing
     * coverage passed throughout the bug.
     */
    const CLEAR_ACCESS =
      'access-token=; Domain=.opuspopuli.org; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict';
    const CLEAR_REFRESH =
      'refresh-token=; Domain=.opuspopuli.org; Path=/api/auth/refresh; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict';

    it('forwards BOTH cleared cookies to the browser (#1019 regression)', async () => {
      // Exercises didReceiveResponse itself, not the parser in isolation.
      // Apollo hands it a HeaderMap (extends Map), so `get` returns the single
      // collapsed value the fetcher produced.
      const appended: [string, string][] = [];
      const requestContext = {
        request: undefined,
        context: {
          res: {
            append: (name: string, value: string) =>
              appended.push([name, value]),
          },
        },
        response: {
          http: {
            headers: new Map([
              ['set-cookie', `${CLEAR_ACCESS}, ${CLEAR_REFRESH}`],
            ]),
          },
        },
      };

      dataSource.didReceiveResponse(requestContext);

      expect(appended).toHaveLength(2);
      expect(appended[0][0]).toBe('Set-Cookie');
      expect(appended[0][1]).toContain('access-token=;');
      expect(appended[1][1]).toContain('refresh-token=;');

      // The epoch expiry is what makes a clear a clear. If comma-splitting
      // truncated it, the browser would receive a session cookie with an
      // empty value instead of a deletion — which reads as "still logged in"
      // to nothing and as "logged out" to no one.
      for (const [, value] of appended) {
        expect(value).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      }

      // Paths must survive: a clear aimed at the wrong path deletes nothing.
      expect(appended[0][1]).toContain('Path=/;');
      expect(appended[1][1]).toContain('Path=/api/auth/refresh;');
    });

    it('keeps BOTH cookies when a subgraph sets two', async () => {
      globalThis.fetch = jest
        .fn()
        .mockResolvedValue(
          respondWith([ACCESS, REFRESH]),
        ) as unknown as typeof fetch;

      const res = await fetcherOf(dataSource)('http://users/graphql');
      const combined = res.headers.get('set-cookie') ?? '';

      // A single header value now, so Apollo's Map has nothing to discard.
      expect(combined).toContain('access-token=aaa');
      expect(combined).toContain('refresh-token=bbb');
    });

    it('round-trips through the parser back into two cookies', async () => {
      globalThis.fetch = jest
        .fn()
        .mockResolvedValue(
          respondWith([ACCESS, REFRESH]),
        ) as unknown as typeof fetch;

      const res = await fetcherOf(dataSource)('http://users/graphql');
      const combined = res.headers.get('set-cookie') ?? '';

      // The parser that didReceiveResponse uses to split them again. Both
      // cookies carry an `Expires` date containing a comma, which is exactly
      // what naive splitting gets wrong.
      const split = (
        dataSource as unknown as {
          parseSetCookieHeaders: (v: string) => string[];
        }
      ).parseSetCookieHeaders(combined);

      expect(split).toHaveLength(2);
      expect(split[0]).toContain('access-token=aaa');
      expect(split[1]).toContain('refresh-token=bbb');
      // Attributes must survive intact — a clear aimed at the wrong path
      // silently does nothing.
      expect(split[1]).toContain('Path=/api/auth/refresh');
    });

    it('leaves a single-cookie response untouched', async () => {
      const single = respondWith([ACCESS]);
      globalThis.fetch = jest
        .fn()
        .mockResolvedValue(single) as unknown as typeof fetch;

      const res = await fetcherOf(dataSource)('http://users/graphql');

      // Same object back: one cookie cannot be lost by a Map, so there is no
      // reason to rebuild the response on every subgraph call.
      expect(res).toBe(single);
    });

    it('preserves the response body and status', async () => {
      globalThis.fetch = jest
        .fn()
        .mockResolvedValue(
          respondWith([ACCESS, REFRESH]),
        ) as unknown as typeof fetch;

      const res = await fetcherOf(dataSource)('http://users/graphql');

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ data: {} });
    });
  });
});
