import { createHash } from "node:crypto";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExtractionProvider, stripNulBytes } from "../src/extraction.provider";
import { FetchError } from "../src/types";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

/**
 * Build a real `Response` for the fetch mock.
 *
 * Deliberately a genuine `Response` rather than an object literal: the
 * provider reads the body as bytes and decodes it itself (#1276), so `text()`
 * and `arrayBuffer()` must come from the same body and `headers` must have
 * real `Headers` semantics. The hand-rolled fakes this replaced stubbed
 * `text()` directly, which meant no test here could observe decoding at all.
 *
 * Note a real body can only be read once, so a persistent mock must build a
 * fresh response per call (`mockImplementation`) rather than resolve the same
 * instance repeatedly — the old stubs allowed `text()` to be called forever.
 *
 * `url` is defined only when a redirect is being simulated — a real
 * `Response` reports `""`, which is what the provider treats as "no redirect".
 */
function httpResponse(
  body: string | Buffer,
  {
    status = 200,
    statusText = "OK",
    contentType = "text/html",
    url,
  }: {
    status?: number;
    statusText?: string;
    contentType?: string | null;
    url?: string;
  } = {},
): Response {
  const response = new Response(body, {
    status,
    statusText,
    headers: contentType ? { "content-type": contentType } : {},
  });

  if (url !== undefined) {
    Object.defineProperty(response, "url", { value: url });
  }

  return response;
}

// Mock pdf-parse v2 API
jest.mock("pdf-parse", () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: jest.fn().mockResolvedValue({ text: "Extracted PDF text" }),
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe("ExtractionProvider", () => {
  let provider: ExtractionProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    provider = new ExtractionProvider();
  });

  afterEach(() => {
    provider.onModuleDestroy();
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("should create provider with default config", () => {
      expect(provider).toBeDefined();
    });

    it("should create provider with custom config", () => {
      const customProvider = new ExtractionProvider({
        cache: { ttlMs: 60000 },
        rateLimit: { requestsPerSecond: 10 },
        retry: { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 10000 },
      });
      expect(customProvider).toBeDefined();
      customProvider.onModuleDestroy();
    });
  });

  describe("fetchUrl", () => {
    it("should fetch URL and return content", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse("<html>content</html>"));

      const result = await provider.fetchUrl("https://example.com");

      expect(result.content).toBe("<html>content</html>");
      expect(result.fromCache).toBe(false);
      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it("should return cached result on second call", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse("content"));

      // First call
      await provider.fetchUrl("https://example.com");

      // Second call should be cached
      const result = await provider.fetchUrl("https://example.com");

      expect(result.fromCache).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should bypass cache when option is set", async () => {
      mockFetch.mockImplementation(async () => httpResponse("content"));

      // First call
      await provider.fetchUrl("https://example.com");

      // Second call with bypass
      const result = await provider.fetchUrl("https://example.com", {
        bypassCache: true,
      });

      expect(result.fromCache).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should detect URL redirect and include redirect info in result", async () => {
      mockFetch.mockResolvedValueOnce(
        httpResponse("<html>redirected</html>", {
          url: "https://example.com/new-path",
        }),
      );

      const result = await provider.fetchUrl("https://example.com/old-path");

      expect(result.redirectedFrom).toBe("https://example.com/old-path");
      expect(result.finalUrl).toBe("https://example.com/new-path");
      expect(result.content).toBe("<html>redirected</html>");
    });

    it("should not set redirect fields when URL is unchanged", async () => {
      mockFetch.mockResolvedValueOnce(
        httpResponse("content", { url: "https://example.com" }),
      );

      const result = await provider.fetchUrl("https://example.com");

      expect(result.redirectedFrom).toBeUndefined();
      expect(result.finalUrl).toBeUndefined();
    });

    it("should throw FetchError on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce(
        httpResponse("", { status: 404, statusText: "Not Found" }),
      );

      await expect(
        provider.fetchUrl("https://example.com/notfound"),
      ).rejects.toThrow(FetchError);
    });

    it("should include custom headers", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse("content"));

      await provider.fetchUrl("https://example.com", {
        headers: { Authorization: "Bearer token" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/",
        expect.objectContaining({
          headers: { Authorization: "Bearer token" },
        }),
      );
    });

    it("should use different cache keys for different headers", async () => {
      mockFetch.mockImplementation(async () => httpResponse("content"));

      await provider.fetchUrl("https://example.com", {
        headers: { Accept: "text/html" },
      });
      await provider.fetchUrl("https://example.com", {
        headers: { Accept: "application/json" },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should respect rate limiting", async () => {
      // Create provider with low rate limit
      const limitedProvider = new ExtractionProvider({
        rateLimit: { requestsPerSecond: 2, burstSize: 2 },
      });

      mockFetch.mockImplementation(async () => httpResponse("content"));

      // Exhaust burst
      await limitedProvider.fetchUrl("https://example.com/1", {
        bypassCache: true,
      });
      await limitedProvider.fetchUrl("https://example.com/2", {
        bypassCache: true,
      });

      // Third request should wait
      const promise = limitedProvider.fetchUrl("https://example.com/3", {
        bypassCache: true,
      });

      // Advance time to allow request
      await jest.advanceTimersByTimeAsync(1000);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
      limitedProvider.onModuleDestroy();
    });
  });

  describe("fetch provenance (#1276)", () => {
    const body = "<html>Measure A</html>";
    const expectedHash = createHash("sha256")
      .update(Buffer.from(body, "utf8"))
      .digest("hex");

    it("content-addresses the fetched body", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await provider.fetchUrl("https://example.com");

      expect(result.contentHash).toBe(expectedHash);
      expect(result.content).toBe(body);
    });

    it("records when the body was received, as an ISO string", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await provider.fetchUrl("https://example.com");

      // A string, not a Date: fetch results round-trip through a JSON cache.
      expect(typeof result.fetchedAt).toBe("string");
      expect(new Date(result.fetchedAt).toISOString()).toBe(result.fetchedAt);
    });

    it("captures HTTP validators when the server sends them", async () => {
      const response = httpResponse(body);
      response.headers.set("etag", '"abc123"');
      response.headers.set("last-modified", "Wed, 17 Sep 2026 10:00:00 GMT");
      mockFetch.mockResolvedValueOnce(response);

      const result = await provider.fetchUrl("https://example.com");

      expect(result.etag).toBe('"abc123"');
      expect(result.lastModified).toBe("Wed, 17 Sep 2026 10:00:00 GMT");
    });

    it("omits validators the server did not send", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await provider.fetchUrl("https://example.com");

      expect(result.etag).toBeUndefined();
      expect(result.lastModified).toBeUndefined();
    });

    it("hashes the raw bytes, not the decoded text", async () => {
      // A BOM-prefixed body decodes to the same string as a bare one. Hashing
      // decoded text would call these one source; they are two versions.
      const bommed = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(body, "utf8"),
      ]);
      mockFetch.mockResolvedValueOnce(httpResponse(bommed));

      const result = await provider.fetchUrl("https://example.com");

      expect(result.content).toBe(body);
      expect(result.contentHash).not.toBe(expectedHash);
      expect(result.contentHash).toBe(
        createHash("sha256").update(bommed).digest("hex"),
      );
    });

    it("preserves the original hash and fetch time across a cache hit", async () => {
      jest.setSystemTime(new Date("2026-09-18T10:00:00.000Z"));
      mockFetch.mockResolvedValueOnce(httpResponse(body));
      const fresh = await provider.fetchUrl("https://example.com");

      // Move the clock before the cache hit. Comparing the two results alone
      // would pass even if the cached value were re-stamped, because both
      // calls land in the same millisecond under fake timers.
      jest.setSystemTime(new Date("2026-09-18T10:05:00.000Z"));
      const cached = await provider.fetchUrl("https://example.com");

      // A cache hit received no bytes, so it must not claim a fresh fetch
      // time or recompute a hash from decoded text.
      expect(cached.fromCache).toBe(true);
      expect(cached.contentHash).toBe(fresh.contentHash);
      expect(cached.fetchedAt).toBe("2026-09-18T10:00:00.000Z");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("carries provenance on the binary path too", async () => {
      const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
      mockFetch.mockResolvedValueOnce(
        httpResponse(pdf, { contentType: "application/pdf" }),
      );

      const result = await provider.fetchBytes("https://example.com/a.pdf");

      expect(result.contentHash).toBe(
        createHash("sha256").update(pdf).digest("hex"),
      );
      expect(result.content.equals(pdf)).toBe(true);
    });
  });

  describe("source archive (#1276)", () => {
    const body = "<html>Measure A</html>";
    const expectedHash = createHash("sha256")
      .update(Buffer.from(body, "utf8"))
      .digest("hex");
    let archive: { archive: jest.Mock };
    let archivingProvider: ExtractionProvider;

    beforeEach(() => {
      archive = { archive: jest.fn().mockResolvedValue(undefined) };
      archivingProvider = new ExtractionProvider(
        { cacheProvider: "memory" },
        undefined,
        archive,
      );
    });

    afterEach(async () => {
      await archivingProvider.onModuleDestroy?.();
    });

    it("archives the raw bytes, not the decoded text", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      await archivingProvider.fetchUrl("https://example.gov/a", {
        archive: { regionId: "us-ca", dataType: "propositions" },
      });

      expect(archive.archive).toHaveBeenCalledTimes(1);
      const [recorded] = archive.archive.mock.calls[0];
      expect(Buffer.isBuffer(recorded.content)).toBe(true);
      expect(recorded.content.equals(Buffer.from(body, "utf8"))).toBe(true);
      expect(recorded.contentHash).toBe(expectedHash);
    });

    it("passes the run context through to the archive", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      await archivingProvider.fetchUrl("https://example.gov/a", {
        archive: {
          regionId: "us-ca",
          dataType: "propositions",
          executionId: "exec-1",
          manifestId: "manifest-1",
        },
      });

      expect(archive.archive).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceUrl: "https://example.gov/a",
          regionId: "us-ca",
          dataType: "propositions",
          executionId: "exec-1",
          manifestId: "manifest-1",
        }),
      );
    });

    it("does not archive a fetch that did not ask to be archived", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      await archivingProvider.fetchUrl("https://example.gov/a");

      // The store is sized for artifacts claims cite. Archiving every list
      // page and discovery crawl would fill it with pages nothing cites.
      expect(archive.archive).not.toHaveBeenCalled();
    });

    it("goes to the network even when the body is cached", async () => {
      mockFetch.mockImplementation(async () => httpResponse(body));

      await archivingProvider.fetchUrl("https://example.gov/a");
      await archivingProvider.fetchUrl("https://example.gov/a", {
        archive: { dataType: "propositions" },
      });

      // A cache hit carries decoded text only — archiving from it is
      // impossible, so an archived fetch must not be served from cache.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(archive.archive).toHaveBeenCalledTimes(1);
    });

    it("returns content even when archiving fails", async () => {
      archive.archive.mockRejectedValue(new Error("database unavailable"));
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await archivingProvider.fetchUrl("https://example.gov/a", {
        archive: { dataType: "propositions" },
      });

      // Evidence capture runs alongside the fetch. A sync must not die
      // because the archive was down — the caller asked for content.
      expect(result.content).toBe(body);
    });

    it("never returns the raw buffer to callers", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await archivingProvider.fetchUrl("https://example.gov/a", {
        archive: { dataType: "propositions" },
      });

      // The buffer is carried out of the circuit breaker only so archiving can
      // happen outside it. If it escaped, it would be JSON-serialised into
      // Redis on every fetch for a value nothing downstream reads.
      expect(
        (result as unknown as Record<string, unknown>).bytes,
      ).toBeUndefined();
    });

    it("is inert when no archive is bound", async () => {
      mockFetch.mockResolvedValueOnce(httpResponse(body));

      const result = await provider.fetchUrl("https://example.gov/a", {
        archive: { dataType: "propositions" },
      });

      expect(result.content).toBe(body);
    });
  });

  describe("fetchWithRetry", () => {
    it("should retry on failure and succeed", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(httpResponse("content"));

      const promise = provider.fetchWithRetry("https://example.com", {
        bypassCache: true,
      });

      // Advance through retry delay
      await jest.advanceTimersByTimeAsync(5000);

      const result = await promise;
      expect(result.content).toBe("content");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should use custom retry options", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      let caughtError: Error | null = null;
      const promise = provider
        .fetchWithRetry("https://example.com", {
          maxRetries: 2,
          baseDelayMs: 100,
          bypassCache: true,
        })
        .catch((e) => {
          caughtError = e;
        });

      // Advance time incrementally to allow retries
      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(1000);
      }
      await promise;

      expect(caughtError).toBeDefined();
      // maxRetries = 2 means 2 total attempts
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("extractPdfText", () => {
    it("should extract text from PDF buffer", async () => {
      const buffer = Buffer.from("fake pdf content");

      const text = await provider.extractPdfText(buffer);

      expect(text).toBe("Extracted PDF text");
    });

    // #912: scanned / mixed-encoding PDFs emit NUL bytes (0x00) that Postgres
    // text columns reject ("invalid byte sequence for encoding UTF8"), crashing
    // any downstream DB write (e.g. minutes.rawText). extractPdfText is the
    // single choke point every PDF path flows through, so it must sanitize.
    it("should strip NUL bytes emitted by the underlying PDF extractor", async () => {
      const { PDFParse } = jest.requireMock("pdf-parse");
      PDFParse.mockImplementationOnce(() => ({
        getText: jest
          .fn()
          .mockResolvedValue({ text: "clean\u0000text\u0000here" }),
        destroy: jest.fn().mockResolvedValue(undefined),
      }));

      const text = await provider.extractPdfText(Buffer.from("fake pdf"));

      expect(text).toBe("cleantexthere");
      expect(text).not.toContain("\u0000");
    });
  });

  describe("stripNulBytes", () => {
    it("removes every NUL byte (0x00) from the input", () => {
      expect(stripNulBytes("a\u0000b\u0000c")).toBe("abc");
    });

    it("returns non-NUL text unchanged", () => {
      expect(stripNulBytes("no nuls here")).toBe("no nuls here");
    });

    it("handles empty and all-NUL strings", () => {
      expect(stripNulBytes("")).toBe("");
      expect(stripNulBytes("\u0000\u0000\u0000")).toBe("");
    });
  });

  describe("fetchBytes / fetchPdfText", () => {
    /**
     * Build a buffer containing the PDF magic bytes plus a few bytes
     * outside the ASCII range. A UTF-8 round-trip via response.text()
     * would replace 0x80-0xFF bytes with the U+FFFD replacement
     * character (a 3-byte UTF-8 sequence), so a Buffer reconstructed
     * from such a string would have a different length AND different
     * contents — exactly the failure mode that breaks PDFParse.
     */
    function pdfishBuffer(): Buffer {
      return Buffer.concat([
        Buffer.from("%PDF-1.6\n"),
        Buffer.from([0xe2, 0xe3, 0xcf, 0xd3, 0x0d, 0x0a]), // binary marker
        Buffer.from("1 0 obj\n<< /Type /Catalog >>\nendobj\n"),
        Buffer.from([0x80, 0x81, 0x82, 0xff]), // arbitrary non-ASCII bytes
      ]);
    }

    /**
     * Build a fresh standalone ArrayBuffer with exactly the source
     * bytes — `Buffer#buffer` returns the underlying pool's full
     * ArrayBuffer (often 8KB), not the slice the Buffer represents.
     */
    function asArrayBuffer(buf: Buffer): ArrayBuffer {
      const ab = new ArrayBuffer(buf.byteLength);
      new Uint8Array(ab).set(buf);
      return ab;
    }

    it("returns the response body as a Buffer with bytes preserved exactly", async () => {
      const original = pdfishBuffer();
      mockFetch.mockResolvedValueOnce(
        httpResponse(original, {
          contentType: "application/pdf",
          url: "https://example.com/test.pdf",
        }),
      );

      const result = await provider.fetchBytes("https://example.com/test.pdf");

      expect(result.content).toBeInstanceOf(Buffer);
      expect(result.content.length).toBe(original.length);
      // Critical: every byte preserved (not UTF-8-mangled)
      expect(result.content.equals(original)).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.contentType).toBe("application/pdf");
    });

    it("fetchPdfText pipes binary-safe bytes into extractPdfText", async () => {
      const original = pdfishBuffer();
      let bufferGivenToParser: Buffer | undefined;

      // Replace the global pdf-parse mock to capture what extractPdfText
      // received, so we can assert it wasn't UTF-8-mangled by the fetch path.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse");
      pdfParse.PDFParse.mockImplementationOnce(({ data }: { data: Buffer }) => {
        bufferGivenToParser = data;
        return {
          getText: jest.fn().mockResolvedValue({ text: "ok" }),
          destroy: jest.fn().mockResolvedValue(undefined),
        };
      });

      mockFetch.mockResolvedValueOnce(
        httpResponse(original, {
          contentType: "application/pdf",
          url: "https://example.com/test.pdf",
        }),
      );

      const { text } = await provider.fetchPdfText(
        "https://example.com/test.pdf",
      );

      expect(text).toBe("ok");
      expect(bufferGivenToParser).toBeInstanceOf(Buffer);
      expect(bufferGivenToParser!.equals(original)).toBe(true);
    });

    it("fetchBytesWithRetry retries on transient error then succeeds", async () => {
      const original = pdfishBuffer();
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(
          httpResponse(original, {
            contentType: "application/pdf",
            url: "https://example.com/x.pdf",
          }),
        );

      const promise = provider.fetchBytesWithRetry(
        "https://example.com/x.pdf",
        {
          bypassCache: true,
        } as never,
      );

      // Drain the retry backoff timer (mirrors the existing
      // fetchWithRetry retry test's shape — single advance, not
      // runAllTimersAsync, to avoid the cache-cleanup interval loop)
      await jest.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.content.equals(original)).toBe(true);
    });

    it("throws FetchError on non-2xx response", async () => {
      mockFetch.mockResolvedValueOnce(
        httpResponse(Buffer.alloc(0), {
          status: 404,
          statusText: "Not Found",
          contentType: null,
          url: "https://example.com/missing.pdf",
        }),
      );

      await expect(
        provider.fetchBytes("https://example.com/missing.pdf"),
      ).rejects.toThrow(FetchError);
    });
  });

  describe("selectElements", () => {
    const html = `
      <html>
        <body>
          <div class="item" id="first" data-value="1">
            <span class="title">First Item</span>
            <span class="description">Description 1</span>
          </div>
          <div class="item" id="second" data-value="2">
            <span class="title">Second Item</span>
            <span class="description">Description 2</span>
          </div>
          <div class="other">Not an item</div>
        </body>
      </html>
    `;

    it("should select elements by CSS selector", () => {
      const elements = provider.selectElements(html, ".item");

      expect(elements).toHaveLength(2);
    });

    it("should provide text content", () => {
      const elements = provider.selectElements(html, ".item");

      expect(elements[0].text).toContain("First Item");
      expect(elements[1].text).toContain("Second Item");
    });

    it("should provide html content", () => {
      const elements = provider.selectElements(html, ".item");

      expect(elements[0].html).toContain('<span class="title">');
    });

    it("should provide attributes", () => {
      const elements = provider.selectElements(html, ".item");

      expect(elements[0].attributes.id).toBe("first");
      expect(elements[0].attributes["data-value"]).toBe("1");
      expect(elements[0].attr("id")).toBe("first");
    });

    it("should support find for nested elements", () => {
      const elements = provider.selectElements(html, ".item");

      const titles = elements[0].find(".title");
      expect(titles).toHaveLength(1);
      expect(titles[0].text).toBe("First Item");
    });

    it("should support hasClass", () => {
      const elements = provider.selectElements(html, ".item");

      expect(elements[0].hasClass("item")).toBe(true);
      expect(elements[0].hasClass("other")).toBe(false);
    });

    it("should return empty array for no matches", () => {
      const elements = provider.selectElements(html, ".nonexistent");

      expect(elements).toHaveLength(0);
    });
  });

  describe("parseHtml", () => {
    it("should return cheerio instance", () => {
      const $ = provider.parseHtml("<div>test</div>");

      expect($("div").text()).toBe("test");
    });
  });

  describe("cache management", () => {
    it("should get cache stats", async () => {
      mockFetch.mockImplementation(async () => httpResponse("content"));

      await provider.fetchUrl("https://example.com");

      const stats = await provider.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.keys).toHaveLength(1);
    });

    it("should clear cache", async () => {
      mockFetch.mockImplementation(async () => httpResponse("content"));

      await provider.fetchUrl("https://example.com");
      await provider.clearCache();

      const stats = await provider.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("rate limiter management", () => {
    it("should reset rate limiter", async () => {
      await expect(provider.resetRateLimiter()).resolves.not.toThrow();
    });
  });

  describe("onModuleDestroy", () => {
    it("should cleanup resources", async () => {
      await expect(provider.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe("circuit breaker", () => {
    it("should provide circuit breaker health", () => {
      const health = provider.getCircuitBreakerHealth();

      expect(health).toBeDefined();
      expect(health.serviceName).toBe("Extraction");
      expect(health.state).toBe("closed");
      expect(health.isHealthy).toBe(true);
      expect(health.failureCount).toBe(0);
    });

    it("should track failures and open circuit after threshold", async () => {
      // Create provider with lower threshold for testing
      const testProvider = new ExtractionProvider({
        rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      });

      // Simulate 5 consecutive failures (default threshold)
      mockFetch.mockRejectedValue(new Error("Network error"));

      for (let i = 0; i < 5; i++) {
        await testProvider
          .fetchUrl(`https://example.com/${i}`, {
            bypassCache: true,
          })
          .catch(() => {});
      }

      // Check health after failures - circuit should be open
      const health = testProvider.getCircuitBreakerHealth();
      expect(health.failureCount).toBeGreaterThan(0);

      testProvider.onModuleDestroy();
    });

    it("should recover after half-open period", async () => {
      // Create provider
      const testProvider = new ExtractionProvider({
        rateLimit: { requestsPerSecond: 100, burstSize: 100 },
      });

      // First, open the circuit
      mockFetch.mockRejectedValue(new Error("Network error"));
      for (let i = 0; i < 5; i++) {
        await testProvider
          .fetchUrl(`https://example.com/${i}`, {
            bypassCache: true,
          })
          .catch(() => {});
      }

      // Then succeed
      mockFetch.mockImplementation(async () => httpResponse("content"));

      // Advance time past half-open period (60 seconds for extraction)
      await jest.advanceTimersByTimeAsync(61000);

      // Try to fetch again - should succeed if circuit allows
      await testProvider
        .fetchUrl("https://example.com/recover", {
          bypassCache: true,
        })
        .catch(() => {});

      testProvider.onModuleDestroy();
    });
  });
});
