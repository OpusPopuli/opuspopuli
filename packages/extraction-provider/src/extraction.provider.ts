/**
 * Extraction Provider
 *
 * Main infrastructure provider for web content extraction.
 * Provides URL fetching with caching, rate limiting, circuit breaker,
 * and retry logic, plus PDF text extraction and HTML element selection.
 *
 * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/198
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import { PDFParse } from "pdf-parse";
import {
  CircuitBreakerManager,
  createCircuitBreaker,
  DEFAULT_CIRCUIT_CONFIGS,
  CircuitBreakerHealth,
} from "@qckstrt/common";

import { MemoryCache } from "./cache/memory-cache.js";
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
import { RateLimiter } from "./utils/rate-limiter.js";
import { withRetry, RetryPredicates } from "./utils/retry.js";

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
  private readonly cache: MemoryCache<CachedFetchResult>;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreakerManager;
  private readonly fetchFn: FetchFunction;

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

    this.cache = new MemoryCache<CachedFetchResult>(this.config.cache);
    this.rateLimiter = new RateLimiter(this.config.rateLimit);

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
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for ${url}`);
        return { ...cached, fromCache: true };
      }
    }

    // Wait for rate limiter
    await this.rateLimiter.acquire();

    this.logger.debug(`Fetching ${url}`);

    // Wrap the fetch call with circuit breaker protection
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

      const content = await response.text();
      const contentType = response.headers.get("content-type") || "unknown";

      const result: CachedFetchResult = {
        content,
        fromCache: false,
        statusCode: response.status,
        contentType,
      };

      // Cache the result
      this.cache.set(cacheKey, result);

      return result;
    });
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
    return withRetry(() => this.fetchUrl(url, options), {
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
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: this.cache.keys(),
    };
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug("Cache cleared");
  }

  /**
   * Reset rate limiter
   */
  resetRateLimiter(): void {
    this.rateLimiter.reset();
    this.logger.debug("Rate limiter reset");
  }

  /**
   * Cleanup resources (call on module destroy)
   */
  onModuleDestroy(): void {
    this.cache.destroy();
    this.logger.debug("ExtractionProvider destroyed");
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
