import {
  withRetry,
  isFetchRetryable,
  fetchTextWithRetry,
  fetchBytesWithRetry,
  decodeFetchedText,
  RetryableHttpError,
} from './resilient-fetch';

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
    // Any per-host limiter fits (S1); a stub that never waits isolates the
    // ordering claim from timing.
    const throttle = { acquire: jest.fn().mockResolvedValue(undefined) };
    await fetchTextWithRetry('https://x.test/p', {
      throttle,
      maxAttempts: 2,
      baseDelayMs: 1,
    });
    expect(throttle.acquire).toHaveBeenCalledTimes(2);
    expect(throttle.acquire).toHaveBeenCalledWith('https://x.test/p');
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

describe('fetchBytesWithRetry', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the raw bytes and the validators, through the same checks', async () => {
    const body = Buffer.from('<p>caf\u00e9</p>', 'utf8');
    global.fetch = jest.fn().mockResolvedValue(
      new Response(body, {
        headers: {
          'content-type': 'Text/HTML; charset=utf-8',
          etag: '"v1"',
          'last-modified': 'Thu, 22 Oct 2026 10:00:00 GMT',
        },
      }),
    );

    const fetched = await fetchBytesWithRetry('https://x.test/page');

    expect(fetched.body.equals(body)).toBe(true);
    expect(fetched).toMatchObject({
      contentType: 'text/html; charset=utf-8',
      etag: '"v1"',
      lastModified: 'Thu, 22 Oct 2026 10:00:00 GMT',
    });
    expect(Number.isNaN(Date.parse(fetched.fetchedAt))).toBe(false);
  });

  it('refuses a non-HTML content type, as the text fetch does', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('%PDF', {
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    await expect(fetchBytesWithRetry('https://x.test/a.pdf')).rejects.toThrow(
      /Non-HTML content-type/,
    );
  });
});

describe('decodeFetchedText', () => {
  // The K1 skip key is a hash of the text: if decoding the archived bytes
  // differed from what `response.text()` returned before S3, every page would
  // re-extract once on deploy. Compared against the real `Response.text()`.
  it.each([
    ['plain UTF-8', Buffer.from('<p>Assembly — Senate</p>', 'utf8'), 'utf-8'],
    [
      'a UTF-8 BOM',
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('<p>x</p>', 'utf8'),
      ]),
      'utf-8',
    ],
    [
      'a declared latin-1 charset',
      Buffer.from([0x63, 0x61, 0x66, 0xe9]),
      'iso-8859-1',
    ],
    ['invalid UTF-8', Buffer.from([0xff, 0xfe, 0x41]), 'utf-8'],
  ])('matches Response.text() for %s', async (_case, bytes, charset) => {
    const expected = await new Response(bytes, {
      headers: { 'content-type': `text/html; charset=${charset}` },
    }).text();
    expect(decodeFetchedText(bytes)).toBe(expected);
  });
});
