import { FixedWindowThrottlerStorage } from '../rate-limit/fixed-window-storage';
import type { NextFunction, Request, Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import {
  EDGE_READ_THROTTLER_CONFIG,
  GATEWAY_THROTTLER_CONFIG,
} from '../config/shared-app.config';
import {
  EDGE_READ_HEADER,
  signEdgeRead,
} from '../rate-limit/edge-read-signature';
import { GraphqlRateLimitMiddleware } from './graphql-rate-limit.middleware';

const SHORT_LIMIT = GATEWAY_THROTTLER_CONFIG.find(
  (tier) => tier.name === 'short',
)!.limit;

function request(headers: Record<string, string>, ip = '172.18.0.5') {
  return { headers, ip } as unknown as Request;
}

function response() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe('GraphqlRateLimitMiddleware (#1456)', () => {
  let storage: FixedWindowThrottlerStorage;
  let middleware: GraphqlRateLimitMiddleware;

  beforeEach(() => {
    storage = new FixedWindowThrottlerStorage();
    middleware = new GraphqlRateLimitMiddleware(storage);
  });

  /** Send `count` requests; return how many were let through. */
  async function send(
    count: number,
    headersFor: (i: number) => Record<string, string>,
  ) {
    let passed = 0;
    let last = response();
    for (let i = 0; i < count; i++) {
      last = response();
      const next = jest.fn() as NextFunction;
      await middleware.use(
        request(headersFor(i)),
        last as unknown as Response,
        next,
      );
      if ((next as jest.Mock).mock.calls.length === 1) passed++;
    }
    return { passed, last };
  }

  it('lets a client through up to the limit, then refuses with a 429', async () => {
    const { passed, last } = await send(SHORT_LIMIT + 1, () => ({
      'cf-connecting-ip': '198.51.100.20',
    }));
    expect(passed).toBe(SHORT_LIMIT);
    expect(last.statusCode).toBe(429);
    expect(Number(last.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(last.body).toEqual({
      errors: [
        {
          message: 'Too many requests. Please try again later.',
          extensions: { code: 'TOO_MANY_REQUESTS' },
        },
      ],
    });
  });

  it('cannot be reset by sending a new x-forwarded-for first hop', async () => {
    // Behind Cloudflare the real address is the last hop; the client
    // invents a new first hop on every request.
    const { passed } = await send(SHORT_LIMIT + 5, (i) => ({
      'x-forwarded-for': `203.0.113.${i % 250}, 198.51.100.20`,
    }));
    expect(passed).toBe(SHORT_LIMIT);
  });

  it('counts a whole IPv6 /64 as one client', async () => {
    const { passed } = await send(SHORT_LIMIT + 5, (i) => ({
      'cf-connecting-ip': `2001:db8:1:2::${(i + 1).toString(16)}`,
    }));
    expect(passed).toBe(SHORT_LIMIT);
  });

  it('gives each real client its own budget', async () => {
    await send(SHORT_LIMIT, () => ({ 'cf-connecting-ip': '198.51.100.20' }));
    const other = await send(1, () => ({
      'cf-connecting-ip': '198.51.100.21',
    }));
    expect(other.passed).toBe(1);
  });
});

describe('GraphqlRateLimitMiddleware logging (#1456)', () => {
  it('warns once per client per window, not once per refusal', async () => {
    const storage = new FixedWindowThrottlerStorage();
    const middleware = new GraphqlRateLimitMiddleware(storage);
    const warn = jest
      .spyOn(
        (middleware as unknown as { logger: { warn: (m: string) => void } })
          .logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    for (let i = 0; i < SHORT_LIMIT + 40; i++) {
      await middleware.use(
        request({ 'cf-connecting-ip': '198.51.100.30' }),
        response() as unknown as Response,
        jest.fn(),
      );
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).not.toContain('198.51.100.30');
  });
});

describe('GraphqlRateLimitMiddleware: reads the frontend Worker signs (#1456)', () => {
  const SECRET = 'opuspopuli-edge-read-test-secret-0001';
  // Every Cloudflare Worker reaches us from this one address, through the
  // tunnel container (a private peer), so it arrives as cf-connecting-ip.
  const WORKER_IP = '2a06:98c0:3600::103';
  const PATH = '/api?query=%7B+regionInfo+%7B+name+%7D+%7D';
  const EDGE_SHORT = EDGE_READ_THROTTLER_CONFIG.find(
    (tier) => tier.name === 'edge-short',
  )!.limit;

  function config(secret: string | undefined) {
    return { get: () => secret } as unknown as ConfigService;
  }

  function workerRead(method: string, signature?: string, url = PATH) {
    return {
      method,
      originalUrl: url,
      url,
      ip: '172.18.0.5',
      headers: {
        'cf-connecting-ip': WORKER_IP,
        ...(signature ? { [EDGE_READ_HEADER]: signature } : {}),
      },
    } as unknown as Request;
  }

  async function passes(
    middleware: GraphqlRateLimitMiddleware,
    count: number,
    req: () => Request,
  ) {
    let passed = 0;
    for (let i = 0; i < count; i++) {
      const next = jest.fn() as NextFunction;
      await middleware.use(req(), response() as unknown as Response, next);
      if ((next as jest.Mock).mock.calls.length === 1) passed++;
    }
    return passed;
  }

  it('gives signed reads their own budget, beyond one visitor’s', async () => {
    const middleware = new GraphqlRateLimitMiddleware(
      new FixedWindowThrottlerStorage(),
      config(SECRET),
    );
    const passed = await passes(middleware, SHORT_LIMIT + 10, () =>
      workerRead('GET', signEdgeRead(SECRET, PATH)),
    );
    expect(passed).toBe(SHORT_LIMIT + 10);
  });

  it('still caps signed reads', async () => {
    const middleware = new GraphqlRateLimitMiddleware(
      new FixedWindowThrottlerStorage(),
      config(SECRET),
    );
    const passed = await passes(middleware, EDGE_SHORT + 5, () =>
      workerRead('GET', signEdgeRead(SECRET, PATH)),
    );
    expect(passed).toBe(EDGE_SHORT);
  });

  it('never extends the budget to a mutation, signed or not', async () => {
    const middleware = new GraphqlRateLimitMiddleware(
      new FixedWindowThrottlerStorage(),
      config(SECRET),
    );
    const passed = await passes(middleware, SHORT_LIMIT + 5, () =>
      workerRead('POST', signEdgeRead(SECRET, PATH)),
    );
    expect(passed).toBe(SHORT_LIMIT);
  });

  it('treats a signature for another read, or a forged one, as an ordinary client', async () => {
    const middleware = new GraphqlRateLimitMiddleware(
      new FixedWindowThrottlerStorage(),
      config(SECRET),
    );
    const other = signEdgeRead(SECRET, '/api?query=%7B+bills+%7D');
    expect(
      await passes(middleware, SHORT_LIMIT + 5, () => workerRead('GET', other)),
    ).toBe(SHORT_LIMIT);

    const forged = new GraphqlRateLimitMiddleware(
      new FixedWindowThrottlerStorage(),
      config(SECRET),
    );
    expect(
      await passes(forged, SHORT_LIMIT + 5, () =>
        workerRead(
          'GET',
          signEdgeRead('someone-elses-secret-of-32-chars!!', PATH),
        ),
      ),
    ).toBe(SHORT_LIMIT);
  });

  it('exempts nothing when no secret is configured', async () => {
    const middleware = new GraphqlRateLimitMiddleware(
      new FixedWindowThrottlerStorage(),
      config(undefined),
    );
    const passed = await passes(middleware, SHORT_LIMIT + 5, () =>
      workerRead('GET', signEdgeRead(SECRET, PATH)),
    );
    expect(passed).toBe(SHORT_LIMIT);
  });

  it('keeps unsigned Worker reads on the shared address budget', async () => {
    const middleware = new GraphqlRateLimitMiddleware(
      new FixedWindowThrottlerStorage(),
      config(SECRET),
    );
    expect(
      await passes(middleware, SHORT_LIMIT + 5, () => workerRead('GET')),
    ).toBe(SHORT_LIMIT);
  });
});
