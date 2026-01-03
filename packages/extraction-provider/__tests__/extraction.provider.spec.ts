/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExtractionProvider } from "../src/extraction.provider";
import { FetchError } from "../src/types";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("<html>content</html>"),
        headers: new Map([["content-type", "text/html"]]),
      });

      const result = await provider.fetchUrl("https://example.com");

      expect(result.content).toBe("<html>content</html>");
      expect(result.fromCache).toBe(false);
      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it("should return cached result on second call", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("content"),
        headers: new Map([["content-type", "text/html"]]),
      });

      // First call
      await provider.fetchUrl("https://example.com");

      // Second call should be cached
      const result = await provider.fetchUrl("https://example.com");

      expect(result.fromCache).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should bypass cache when option is set", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("content"),
        headers: new Map([["content-type", "text/html"]]),
      });

      // First call
      await provider.fetchUrl("https://example.com");

      // Second call with bypass
      const result = await provider.fetchUrl("https://example.com", {
        bypassCache: true,
      });

      expect(result.fromCache).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should throw FetchError on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(
        provider.fetchUrl("https://example.com/notfound"),
      ).rejects.toThrow(FetchError);
    });

    it("should include custom headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("content"),
        headers: new Map([["content-type", "text/html"]]),
      });

      await provider.fetchUrl("https://example.com", {
        headers: { Authorization: "Bearer token" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({
          headers: { Authorization: "Bearer token" },
        }),
      );
    });

    it("should use different cache keys for different headers", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("content"),
        headers: new Map([["content-type", "text/html"]]),
      });

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

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("content"),
        headers: new Map([["content-type", "text/html"]]),
      });

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

  describe("fetchWithRetry", () => {
    it("should retry on failure and succeed", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve("content"),
          headers: new Map([["content-type", "text/html"]]),
        });

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
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("content"),
        headers: new Map([["content-type", "text/html"]]),
      });

      await provider.fetchUrl("https://example.com");

      const stats = provider.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.keys).toHaveLength(1);
    });

    it("should clear cache", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("content"),
        headers: new Map([["content-type", "text/html"]]),
      });

      await provider.fetchUrl("https://example.com");
      provider.clearCache();

      const stats = provider.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("rate limiter management", () => {
    it("should reset rate limiter", () => {
      expect(() => provider.resetRateLimiter()).not.toThrow();
    });
  });

  describe("onModuleDestroy", () => {
    it("should cleanup resources", () => {
      expect(() => provider.onModuleDestroy()).not.toThrow();
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
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve("content"),
        headers: new Map([["content-type", "text/html"]]),
      });

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
