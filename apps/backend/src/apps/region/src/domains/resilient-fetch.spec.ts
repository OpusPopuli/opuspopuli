import {
  HostThrottle,
  withRetry,
  isFetchRetryable,
  fetchTextWithRetry,
  RetryableHttpError,
} from './resilient-fetch';

describe('HostThrottle', () => {
  it('does not wait on the first fetch to a host', async () => {
    const t = new HostThrottle(50);
    const start = Date.now();
    await t.acquire('https://example.com/a');
    expect(Date.now() - start).toBeLessThan(20);
  });

  it('enforces the gap between consecutive fetches to the same host', async () => {
    const t = new HostThrottle(80);
    await t.acquire('https://example.com/a');
    const start = Date.now();
    await t.acquire('https://example.com/b');
    expect(Date.now() - start).toBeGreaterThanOrEqual(70);
  });

  it('tracks hosts independently', async () => {
    const t = new HostThrottle(100);
    await t.acquire('https://a.example/x');
    const start = Date.now();
    await t.acquire('https://b.example/y');
    expect(Date.now() - start).toBeLessThan(20);
  });

  it('honors per-host setGap override', async () => {
    const t = new HostThrottle(10);
    t.setGap('slow.example', 60);
    await t.acquire('https://slow.example/a');
    const start = Date.now();
    await t.acquire('https://slow.example/b');
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });

  it('setRequestsPerSecond converts rps → gap correctly', async () => {
    const t = new HostThrottle(1000);
    // 10 req/sec ⇒ 100ms gap
    t.setRequestsPerSecond('fast.example', 10);
    await t.acquire('https://fast.example/a');
    const start = Date.now();
    await t.acquire('https://fast.example/b');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(200);
  });

  it('silently no-ops on malformed URLs (does not throw)', async () => {
    const t = new HostThrottle(100);
    await expect(t.acquire('not a url')).resolves.toBeUndefined();
  });

  it('fans out N concurrent acquires at N × gap (race-safe)', async () => {
    const t = new HostThrottle(80);
    const start = Date.now();
    const completions: number[] = [];

    // Fire 3 concurrent acquires. Without the race fix, all three would
    // read the same lastFetchByHost value (undefined), all skip the sleep,
    // and all complete at ~start. With the fix, each reserves its own
    // slot atomically: +0, +80, +160.
    await Promise.all(
      [0, 1, 2].map(async () => {
        await t.acquire('https://racy.example/p');
        completions.push(Date.now() - start);
      }),
    );

    completions.sort((a, b) => a - b);
    expect(completions[0]).toBeLessThan(30);
    expect(completions[1]).toBeGreaterThanOrEqual(70);
    expect(completions[2]).toBeGreaterThanOrEqual(150);
  });
});

describe('RetryableHttpError', () => {
  it('carries the status code and message', () => {
    const err = new RetryableHttpError(503, 'Service Unavailable');
    expect(err.status).toBe(503);
    expect(err.message).toBe('Service Unavailable');
    expect(err.retryable).toBe(true);
    expect(err.name).toBe('RetryableHttpError');
  });

  it('is recognized by isFetchRetryable via instanceof', () => {
    expect(isFetchRetryable(new RetryableHttpError(503, 'x'))).toBe(true);
    expect(isFetchRetryable(new RetryableHttpError(429, 'y'))).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns the result on first-attempt success without delay', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success with exponential backoff', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValue('ok');
    const delays: number[] = [];
    const result = await withRetry(fn, {
      baseDelayMs: 10,
      jitterRatio: 0, // disable jitter for deterministic assertion
      onRetry: (_e, _a, d) => delays.push(d),
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([10, 20]); // 10ms then 20ms (2^0, 2^1)
  });

  it('applies jitter (±jitterRatio) to backoff delays', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockResolvedValue('ok');
    const delays: number[] = [];
    await withRetry(fn, {
      baseDelayMs: 100,
      jitterRatio: 0.2, // ±20%
      onRetry: (_e, _a, d) => delays.push(d),
    });
    expect(delays[0]).toBeGreaterThanOrEqual(80);
    expect(delays[0]).toBeLessThanOrEqual(120);
  });

  it('gives up after maxAttempts and throws the last error', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when isRetryable returns false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fatal'));
    await expect(
      withRetry(fn, { maxAttempts: 5, isRetryable: () => false }),
    ).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('caps backoff at maxDelayMs', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'))
      .mockResolvedValue('ok');
    const delays: number[] = [];
    await withRetry(fn, {
      maxAttempts: 4,
      baseDelayMs: 100,
      maxDelayMs: 150,
      jitterRatio: 0,
      onRetry: (_e, _a, d) => delays.push(d),
    });
    expect(delays).toEqual([100, 150, 150]); // capped at 150
  });
});

describe('isFetchRetryable', () => {
  it('returns true for RetryableHttpError instances', () => {
    expect(isFetchRetryable(new RetryableHttpError(503, 'svc unavail'))).toBe(
      true,
    );
  });

  it('returns true for timeout/abort errors', () => {
    expect(isFetchRetryable({ name: 'TimeoutError', message: '' })).toBe(true);
    expect(isFetchRetryable({ name: 'AbortError', message: '' })).toBe(true);
    expect(isFetchRetryable(new Error('operation timeout exceeded'))).toBe(
      true,
    );
  });

  it('returns true for transport-level errors', () => {
    expect(isFetchRetryable(new Error('fetch failed'))).toBe(true);
    expect(isFetchRetryable(new Error('connect ECONNRESET'))).toBe(true);
    expect(isFetchRetryable(new Error('connect ECONNREFUSED'))).toBe(true);
    expect(isFetchRetryable(new Error('getaddrinfo EAI_AGAIN'))).toBe(true);
  });

  it('returns true for response-body stream errors', () => {
    // Errors thrown by response.text() when the body stream is interrupted
    // mid-read — node-fetch / undici typically surface these messages.
    expect(isFetchRetryable(new Error('socket hang up'))).toBe(true);
    expect(isFetchRetryable(new Error('terminated'))).toBe(true);
  });

  it('returns false for ordinary application errors', () => {
    expect(isFetchRetryable(new Error('bad payload'))).toBe(false);
    expect(isFetchRetryable(new Error('not found'))).toBe(false);
  });
});

describe('fetchTextWithRetry', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const makeResponse = (
    status: number,
    body: string = '<html></html>',
    contentType: string = 'text/html',
  ): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: {
        get: (k: string) =>
          k.toLowerCase() === 'content-type' ? contentType : null,
      },
      text: async () => body,
    }) as unknown as Response;

  it('returns body on 200 with text/html', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(200, '<p>ok</p>'));
    const result = await fetchTextWithRetry('https://x.test/page', {
      baseDelayMs: 1,
    });
    expect(result).toBe('<p>ok</p>');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then succeeds', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200, '<p>finally</p>'));
    const result = await fetchTextWithRetry('https://x.test/page', {
      maxAttempts: 3,
      baseDelayMs: 1,
    });
    expect(result).toBe('<p>finally</p>');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('retries on 429', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(200));
    await fetchTextWithRetry('https://x.test/page', {
      maxAttempts: 3,
      baseDelayMs: 1,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 404 (non-retryable 4xx)', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(404));
    await expect(
      fetchTextWithRetry('https://x.test/page', { baseDelayMs: 1 }),
    ).rejects.toThrow(/HTTP 404/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws on non-HTML content-type without retrying', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(makeResponse(200, 'PDF data', 'application/pdf'));
    await expect(
      fetchTextWithRetry('https://x.test/file', { baseDelayMs: 1 }),
    ).rejects.toThrow(/Non-HTML content-type/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and throws the last 503 error', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(503));
    await expect(
      fetchTextWithRetry('https://x.test/page', {
        maxAttempts: 3,
        baseDelayMs: 1,
      }),
    ).rejects.toThrow(/HTTP 503/);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('applies throttle.acquire before each attempt', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200));
    const throttle = new HostThrottle(0); // no-op gap for the test
    const acquireSpy = jest.spyOn(throttle, 'acquire');
    await fetchTextWithRetry('https://x.test/p', {
      throttle,
      maxAttempts: 2,
      baseDelayMs: 1,
    });
    expect(acquireSpy).toHaveBeenCalledTimes(2);
  });

  it('calls logger.warn on each retry', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200));
    const warn = jest.fn();
    await fetchTextWithRetry('https://x.test/p', {
      maxAttempts: 2,
      baseDelayMs: 1,
      logger: { warn },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/retry 1 for https:\/\/x\.test/);
  });
});
