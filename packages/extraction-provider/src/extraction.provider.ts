/**
 * Extraction Provider
 *
 * Main infrastructure provider for web content extraction.
 * Provides URL fetching with caching, rate limiting, circuit breaker,
 * and retry logic, plus PDF text extraction and HTML element selection.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/198
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import { PDFParse } from "pdf-parse";
import {
  type ICache,
  type IRateLimiter,
  type CircuitBreakerHealth,
  CircuitBreakerManager,
  createCircuitBreaker,
  DEFAULT_CIRCUIT_CONFIGS,
  withRetry,
  RetryPredicates,
} from "@opuspopuli/common";
import { CacheFactory } from "./cache/cache-factory.js";
import {
  ExtractionConfig,
  DEFAULT_EXTRACTION_CONFIG,
  EXTRACTION_CONFIG,
  FetchOptions,
  RetryOptions,
  CachedFetchResult,
  FetchError,
  FetchFunction,
} from "./types.js";

/**
 * Selected element from HTML parsing
 */
export interface SelectedElement {
  /** The HTML content of the element */
  html: string;
  /** The text content of the element */
  text: string;
  /** Element attributes */
  attributes: Record<string, string>;
  /** Get attribute value */
  attr(name: string): string | undefined;
  /** Find child elements matching selector */
  find(selector: string): SelectedElement[];
  /** Check if element has a class */
  hasClass(className: string): boolean;
}

/**
 * Main extraction provider for fetching and parsing web content
 */
@Injectable()
export class ExtractionProvider {
  private readonly logger = new Logger(ExtractionProvider.name);
  private readonly config: ExtractionConfig;
  private readonly cache: ICache<CachedFetchResult>;
  private readonly rateLimiter: IRateLimiter;
  private readonly circuitBreaker: CircuitBreakerManager;
  private readonly fetchFn: FetchFunction;
  private readonly cacheProvider: string;

  constructor(
    @Optional()
    @Inject(EXTRACTION_CONFIG)
    config?: Partial<ExtractionConfig>,
  ) {
    this.config = {
      ...DEFAULT_EXTRACTION_CONFIG,
      ...config,
      cache: { ...DEFAULT_EXTRACTION_CONFIG.cache, ...config?.cache },
      rateLimit: {
        ...DEFAULT_EXTRACTION_CONFIG.rateLimit,
        ...config?.rateLimit,
      },
      retry: { ...DEFAULT_EXTRACTION_CONFIG.retry, ...config?.retry },
    };

    // Use custom fetch function if provided, otherwise use native fetch
    // Native fetch respects global dispatcher set via setGlobalHttpPool()
    this.fetchFn = config?.fetchFn ?? fetch;

    // Create cache and rate limiter using factory
    // Supports Redis for distributed deployments, falls back to memory
    const cacheConfig = CacheFactory.createConfigFromEnv({
      provider: config?.cacheProvider,
      redisUrl: config?.redisUrl,
      cacheOptions: this.config.cache,
      rateLimitOptions: this.config.rateLimit,
      keyPrefix: "extraction:cache:",
      rateLimiterKey: "extraction:ratelimit",
    });

    this.cache = CacheFactory.createCache<CachedFetchResult>(cacheConfig);
    this.rateLimiter = CacheFactory.createRateLimiter(cacheConfig);
    this.cacheProvider = cacheConfig.provider;

    // Initialize circuit breaker for external URL fetching
    this.circuitBreaker = createCircuitBreaker(
      DEFAULT_CIRCUIT_CONFIGS.extraction,
    );

    // Log circuit state changes
    this.circuitBreaker.addListener((event) => {
      switch (event) {
        case "break":
          this.logger.warn(
            `Circuit breaker OPENED for Extraction - external URLs unavailable`,
          );
          break;
        case "reset":
          this.logger.log(
            `Circuit breaker RESET for Extraction - external URLs recovered`,
          );
          break;
        case "half_open":
          this.logger.log(
            `Circuit breaker HALF-OPEN for Extraction - testing recovery`,
          );
          break;
      }
    });

    this.logger.log("ExtractionProvider initialized", {
      cacheProvider: this.cacheProvider,
      cache: this.config.cache,
      rateLimit: this.config.rateLimit,
      retry: this.config.retry,
    });
  }

  /**
   * Fetch URL content with caching and rate limiting
   *
   * @param url - URL to fetch
   * @param options - Fetch options
   * @returns Cached fetch result with content and metadata
   */
  async fetchUrl(
    url: string,
    options: FetchOptions = {},
  ): Promise<CachedFetchResult> {
    const cacheKey = this.getCacheKey(url, options);

    // Check cache first (unless bypassed)
    if (!options.bypassCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for ${url}`);
        return { ...cached, fromCache: true };
      }
    }

    await this.rateLimiter.acquire();
    this.logger.debug(`Fetching ${url}`);

    const fetched = await this.fetchAndDecode(url, options, (r) => r.text());
    const result: CachedFetchResult = { ...fetched, fromCache: false };

    await this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Fetch URL with exponential backoff retry
   *
   * @param url - URL to fetch
   * @param options - Retry options including fetch options
   * @returns Cached fetch result
   */
  async fetchWithRetry(
    url: string,
    options: RetryOptions = {},
  ): Promise<CachedFetchResult> {
    return this.retryStandard(url, options, () => this.fetchUrl(url, options));
  }

  /**
   * Extract text from PDF buffer
   *
   * @param buffer - PDF file buffer
   * @returns Extracted text content
   */
  async extractPdfText(buffer: Buffer): Promise<string> {
    this.logger.debug("Extracting text from PDF");

    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }

  /**
   * Fetch a URL and return its body as a Buffer (binary-safe).
   *
   * Use this for PDFs and other binary content. The text-mode
   * fetchUrl/fetchWithRetry decode the body as UTF-8 via
   * `response.text()`, which mangles non-UTF-8 bytes (every byte > 0x7F
   * gets replaced with U+FFFD) and cannot be reversed via
   * `Buffer.from(string, 'binary')`. PDFs round-tripped through that
   * path arrive at PDFParse with a corrupted cross-reference table and
   * fail with "Invalid Root reference".
   *
   * Bypasses the text cache (binary content shouldn't share a cache
   * key with text fetches of the same URL) but still goes through the
   * rate limiter and circuit breaker.
   */
  async fetchBytes(
    url: string,
    options: FetchOptions = {},
  ): Promise<{
    content: Buffer;
    statusCode: number;
    contentType: string;
    finalUrl?: string;
    redirectedFrom?: string;
  }> {
    await this.rateLimiter.acquire();
    this.logger.debug(`Fetching bytes from ${url}`);

    return this.fetchAndDecode(url, options, async (r) =>
      Buffer.from(await r.arrayBuffer()),
    );
  }

  /**
   * Fetch a URL as bytes with exponential-backoff retry. Same retry
   * shape as fetchWithRetry, but the body is preserved binary-safe
   * for PDF/image/zip downloads.
   */
  async fetchBytesWithRetry(
    url: string,
    options: RetryOptions = {},
  ): Promise<{
    content: Buffer;
    statusCode: number;
    contentType: string;
    finalUrl?: string;
    redirectedFrom?: string;
  }> {
    return this.retryStandard(url, options, () =>
      this.fetchBytes(url, options),
    );
  }

  /**
   * Convenience: fetch a PDF URL as bytes (binary-safe) and extract
   * its text in one call. The previous pattern
   * `fetchWithRetry(url) → Buffer.from(content, "binary") → extractPdfText`
   * was broken for any PDF whose bytes weren't pure ASCII — which is
   * essentially every real PDF — because fetchWithRetry's
   * `response.text()` UTF-8-decodes the body and cannot be reversed.
   */
  async fetchPdfText(url: string, options: RetryOptions = {}): Promise<string> {
    const result = await this.fetchBytesWithRetry(url, options);
    return this.extractPdfText(result.content);
  }

  /**
   * Parse HTML and select elements via CSS selector
   *
   * @param html - HTML content to parse
   * @param selector - CSS selector
   * @returns Array of selected elements
   */
  selectElements(html: string, selector: string): SelectedElement[] {
    const $ = cheerio.load(html);
    const elements = $(selector);

    return elements
      .toArray()
      .map((el) => this.wrapCheerioElement($, $(el as Element)));
  }

  /**
   * Parse HTML and return cheerio instance for advanced querying
   *
   * @param html - HTML content to parse
   * @returns Cheerio API instance
   */
  parseHtml(html: string): CheerioAPI {
    return cheerio.load(html);
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{ size: number; keys: string[] }> {
    const [size, keys] = await Promise.all([
      this.cache.size,
      this.cache.keys(),
    ]);
    return { size, keys };
  }

  /**
   * Clear the cache
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
    this.logger.debug("Cache cleared");
  }

  /**
   * Reset rate limiter
   */
  async resetRateLimiter(): Promise<void> {
    await this.rateLimiter.reset();
    this.logger.debug("Rate limiter reset");
  }

  /**
   * Cleanup resources (call on module destroy)
   */
  async onModuleDestroy(): Promise<void> {
    await this.cache.destroy();
    this.logger.debug("ExtractionProvider destroyed");
  }

  /**
   * Get the cache provider type being used
   */
  getCacheProvider(): string {
    return this.cacheProvider;
  }

  /**
   * Shared HTTP path: rate-limited callers go through circuit breaker,
   * we throw FetchError on non-2xx, decode the body via the caller's
   * `decodeBody` (text vs bytes), and detect/log permanent redirects.
   * Returning a `content` of generic type `T` lets fetchUrl produce
   * `string` and fetchBytes produce `Buffer` from the same scaffolding.
   */
  private async fetchAndDecode<T>(
    url: string,
    options: FetchOptions,
    decodeBody: (response: Response) => Promise<T>,
  ): Promise<{
    content: T;
    statusCode: number;
    contentType: string;
    finalUrl?: string;
    redirectedFrom?: string;
  }> {
    return this.circuitBreaker.execute(async () => {
      const timeout = options.timeout ?? this.config.defaultTimeout;
      const response = await this.fetchFn(url, {
        headers: options.headers,
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        throw new FetchError(
          url,
          response.status,
          `HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const content = await decodeBody(response);
      const contentType = response.headers.get("content-type") || "unknown";
      const finalUrl = response.url;
      const wasRedirected = finalUrl && finalUrl !== url;

      if (wasRedirected) {
        this.logger.warn(
          `URL redirect detected: ${url} → ${finalUrl}. Consider updating the data source config.`,
        );
      }

      return {
        content,
        statusCode: response.status,
        contentType,
        ...(wasRedirected && { redirectedFrom: url, finalUrl }),
      };
    });
  }

  /** Standard retry wrapper used by fetchWithRetry and fetchBytesWithRetry. */
  private retryStandard<T>(
    url: string,
    options: RetryOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    return withRetry(fn, {
      maxAttempts: options.maxRetries ?? this.config.retry.maxAttempts,
      baseDelayMs: options.baseDelayMs ?? this.config.retry.baseDelayMs,
      maxDelayMs: options.maxDelayMs ?? this.config.retry.maxDelayMs,
      isRetryable: RetryPredicates.any(
        RetryPredicates.isNetworkError,
        RetryPredicates.isServerError,
        RetryPredicates.isRateLimitError,
      ),
      onRetry: (error, attempt, delayMs) => {
        this.logger.warn(
          `Retry attempt ${attempt} for ${url} after ${delayMs}ms: ${error.message}`,
        );
      },
    });
  }

  /**
   * Generate cache key for URL + options
   */
  private getCacheKey(url: string, options: FetchOptions): string {
    const headerHash = options.headers
      ? JSON.stringify(options.headers)
      : "default";
    return `${url}:${headerHash}`;
  }

  /**
   * Wrap cheerio element in SelectedElement interface
   */
  private wrapCheerioElement(
    $: CheerioAPI,
    element: Cheerio<Element>,
  ): SelectedElement {
    return {
      html: element.html() || "",
      text: element.text().trim(),
      attributes: this.getAttributes(element),
      attr: (name: string) => element.attr(name),
      find: (selector: string) =>
        element
          .find(selector)
          .toArray()
          .map((el) => this.wrapCheerioElement($, $(el as Element))),
      hasClass: (className: string) => element.hasClass(className),
    };
  }

  /**
   * Extract all attributes from element
   */
  private getAttributes(element: Cheerio<Element>): Record<string, string> {
    const attrs: Record<string, string> = {};
    const el = element.get(0);
    if (el && "attribs" in el) {
      Object.assign(attrs, el.attribs);
    }
    return attrs;
  }

  /**
   * Get circuit breaker health status
   */
  getCircuitBreakerHealth(): CircuitBreakerHealth {
    return this.circuitBreaker.getHealth();
  }
}
