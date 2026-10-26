/**
 * Extraction Provider
 *
 * Main infrastructure provider for web content extraction.
 * Provides URL fetching with caching, rate limiting, circuit breaker,
 * and retry logic, plus PDF text extraction and HTML element selection.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/198
 */

import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  installedVersion,
  METRICS_OBSERVER,
  PdfParseMetric,
  PdfParseSource,
  type MetricsObserver,
  PipelineStage,
  withStage,
} from "@opuspopuli/common";
import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import {
  PDF_EXTRACTOR_VERSION,
  PdfExtractor,
  type IOcrProviderForPdf,
  type PdfExtraction,
} from "./utils/pdf-extractor.js";

/**
 * DI token for the optional OCR fallback used by `extractPdfText`. Wire
 * up `{ provide: OCR_SERVICE, useExisting: OcrService }` in a parent
 * module to enable image-based PDF support; leave unwired to skip OCR.
 */
export const OCR_SERVICE = "OCR_SERVICE";

import {
  type ICache,
  type IHostRateLimiter,
  type CircuitBreakerHealth,
  CircuitBreakerManager,
  createCircuitBreaker,
  DEFAULT_CIRCUIT_CONFIGS,
  withRetry,
  RetryPredicates,
} from "@opuspopuli/common";
import { HOST_RATE_LIMITER_KEY } from "./utils/redis-host-rate-limiter.js";
import { CacheFactory } from "./cache/cache-factory.js";
import {
  ExtractionConfig,
  DEFAULT_EXTRACTION_CONFIG,
  EXTRACTION_CONFIG,
  FetchOptions,
  RetryOptions,
  CachedFetchResult,
  FetchProvenance,
  FetchedArtifact,
  BytesFetchResult,
  PdfFetchResult,
  ISourceArchive,
  SOURCE_ARCHIVE,
  type IPdfParseLane,
  PDF_PARSE_LANE,
  ArchiveContext,
  FetchError,
  FetchFunction,
} from "./types.js";
import { normalizeUrl } from "./utils/url-normalize.js";
import { decodeUtf8, hashContentBytes } from "./utils/content-bytes.js";

/**
 * The parser key for a process OCRing as `ocrInfo` describes
 * (`OcrService.getProviderInfo()`, or null without OCR): the cascade's
 * version plus a short hash of the installed pdf-parse and mupdf and the OCR
 * description. Exported so a parse consumer (the S6 CPU lane, possibly on
 * another host) keys its parses by what ITS threads run, not by what the
 * requester assumed. Fits `source_versions.parser_version` (40 chars).
 */
export function pdfParserKeyFor(ocrInfo: unknown): string {
  return `${PDF_EXTRACTOR_VERSION}+${createHash("sha256")
    .update(
      JSON.stringify({
        pdfParse: installedVersion("pdf-parse", __filename) ?? "unknown",
        mupdf: installedVersion("mupdf", __filename) ?? "unknown",
        ocr: ocrInfo ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 12)}`;
}

/**
 * Remove NUL bytes (0x00) from extracted text. Postgres `text`/`utf8` columns
 * reject 0x00 ("invalid byte sequence for encoding UTF8"), so any downstream DB
 * write of PDF text would crash. Scanned / mixed-encoding PDFs emit these. See
 * #912. Exported for unit testing.
 */
export function stripNulBytes(text: string): string {
  return text.replace(/\u0000/g, "");
}

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
  /**
   * One bucket per target host (S1). It was one bucket for every host, so
   * each site waited behind every other and fetch concurrency could not help.
   */
  private readonly hostRateLimiter: IHostRateLimiter;
  private readonly circuitBreaker: CircuitBreakerManager;
  private readonly fetchFn: FetchFunction;
  private readonly cacheProvider: string;

  constructor(
    @Optional()
    @Inject(EXTRACTION_CONFIG)
    config?: Partial<ExtractionConfig>,
    /**
     * Optional. When present, PDF extraction falls back to OCR for
     * image-based PDFs (where pdf-parse and mupdf both produce no
     * meaningful text). When absent, those PDFs return empty text and
     * the consumer is responsible for handling no-content gracefully.
     *
     * Resolved via the OCR_SERVICE token + structural typing so this
     * package stays runtime-decoupled from `@opuspopuli/ocr-provider`'s
     * dep tree.
     */
    @Optional()
    @Inject(OCR_SERVICE)
    private readonly ocrService?: IOcrProviderForPdf,
    /**
     * Optional. When bound, fetches made with `options.archive` are recorded
     * in the content-addressed source store (#1276). When absent, that option
     * is inert — nothing is archived and nothing fails.
     *
     * Bound via ExtractionModule.forRoot's `extraProviders`, like OCR_SERVICE:
     * providers declared at an outer module's scope are not visible inside
     * ExtractionModule's own DI scope.
     */
    @Optional()
    @Inject(SOURCE_ARCHIVE)
    private readonly sourceArchive?: ISourceArchive,
    /**
     * Optional. Where PDF-parse timings go (M1,
     * `docs/plans/ingestion-resource-lanes.md` §2, row 8). When absent,
     * extraction is unmeasured and otherwise unchanged.
     */
    @Optional()
    @Inject(METRICS_OBSERVER)
    private readonly metrics?: MetricsObserver,
    /**
     * Optional (S6). When bound, an archived PDF with no recorded parse is
     * parsed on the `pdf-parse` lane instead of on this process's event loop;
     * anything the lane cannot deliver is parsed here, as before. Last, so
     * positional construction in specs keeps its meaning.
     */
    @Optional()
    @Inject(PDF_PARSE_LANE)
    private readonly pdfParseLane?: IPdfParseLane,
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
      // Versioned prefix. Cached entries are JSON and survive a deploy in
      // Redis, so widening CachedFetchResult silently changes the shape of
      // what a hit returns: entries written before #1276 carry no
      // contentHash/fetchedAt, and would deserialise into an object whose
      // type claims both are present. Bump this whenever the cached shape
      // changes — old keys are then simply never read and expire on TTL.
      keyPrefix: "extraction:cache:v2:",
      rateLimiterKey: HOST_RATE_LIMITER_KEY,
    });

    this.cache = CacheFactory.createCache<CachedFetchResult>(cacheConfig);
    this.hostRateLimiter = CacheFactory.createHostRateLimiter(cacheConfig);
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
   * Record a fetched artifact in the source archive, if one is bound.
   *
   * Never throws. Archiving is evidence capture running alongside the fetch;
   * a sync must not fail because the archive was unavailable, and the caller
   * asked for content, not for a durable copy. Gaps are visible as a
   * shortfall in the store's own metrics rather than as a dead pipeline.
   */
  private async archiveFetch(
    bytes: Buffer,
    url: string,
    contentType: string,
    provenance: FetchProvenance,
    context: ArchiveContext,
  ): Promise<string | undefined> {
    if (!this.sourceArchive) return undefined;

    try {
      const outcome = await this.sourceArchive.archive({
        ...provenance,
        ...context,
        content: bytes,
        sourceUrl: url,
        contentType,
      });
      return outcome.sourceVersionId;
    } catch (error) {
      this.logger.warn(`Failed to archive ${url}: ${(error as Error).message}`);
      return undefined;
    }
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
    url = normalizeUrl(url);
    const cacheKey = this.getCacheKey(url, options);

    // Check cache first (unless bypassed). A fetch that must be archived
    // always goes to the network: a cache hit carries decoded text only, so
    // reading from cache would silently leave a cited source unarchived
    // depending on whether something else fetched it in the last few minutes.
    if (!options.bypassCache && !options.archive) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for ${url}`);
        return { ...cached, fromCache: true };
      }
    }

    await this.hostRateLimiter.acquire(url);
    this.logger.debug(`Fetching ${url}`);

    const fetched = await this.fetchAndDecode(url, options, decodeUtf8);
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
    // Measured HERE, around the whole retry sequence, and not on `fetchUrl`
    // below: backoff sleeps are time the pipeline spent fetching, and the
    // scraping pipeline reaches the network almost exclusively through this
    // method. Instrumenting only region's own `fetchTextWithRetry` left the
    // `fetch` stage reading ZERO across a representatives sync that crawled
    // 120 members and failed ~80 Assembly biography pages — a clean-looking
    // run that had lost most of its secondary detail.
    return withStage(
      PipelineStage.Fetch,
      {},
      () => this.retryStandard(url, options, () => this.fetchUrl(url, options)),
      { observer: this.metrics },
    );
  }

  /**
   * Extract text from a PDF buffer using a tiered cascade:
   * pdf-parse → mupdf text → mupdf rasterize + OCR. See
   * {@link PdfExtractor} for the rationale and quality-threshold logic.
   *
   * If `OcrService` was not injected, the third tier is skipped and the
   * best-effort text from the earlier tiers is returned (which may be
   * empty for image-based PDFs).
   */
  async extractPdfText(buffer: Buffer): Promise<string> {
    return (await this.parsePdf(buffer)).text;
  }

  /** {@link extractPdfText}, saying whether the parse is complete. */
  private async parsePdf(buffer: Buffer): Promise<PdfExtraction> {
    this.logger.debug("Extracting text from PDF");
    // The whole cascade, as one `pdf_parse` stage. Tier 3 rasterises and
    // hands off to OCR, which measures itself as the `ocr` stage — so a
    // scanned PDF shows up in both, and the difference between them is what
    // the parse tiers cost before OCR was reached. Row 8 compares the two.
    const parsed = await withStage(
      PipelineStage.PdfParse,
      {},
      () => PdfExtractor.extractWithOutcome(buffer, this.ocrService),
      { observer: this.metrics },
    );
    // Strip NUL bytes (0x00) that scanned / mixed-encoding PDFs can emit.
    // Postgres text columns reject 0x00 ("invalid byte sequence for encoding
    // UTF8"), which would crash any downstream DB write of the extracted text
    // (minutes.rawText, bill/meeting fields). Single choke point for every PDF
    // path — see #912.
    return { ...parsed, text: stripNulBytes(parsed.text) };
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
  ): Promise<BytesFetchResult> {
    url = normalizeUrl(url);
    await this.hostRateLimiter.acquire(url);
    this.logger.debug(`Fetching bytes from ${url}`);

    return this.fetchAndDecode(url, options, (bytes) => bytes);
  }

  /**
   * Fetch a URL as bytes with exponential-backoff retry. Same retry
   * shape as fetchWithRetry, but the body is preserved binary-safe
   * for PDF/image/zip downloads.
   */
  async fetchBytesWithRetry(
    url: string,
    options: RetryOptions = {},
  ): Promise<BytesFetchResult> {
    return withStage(
      PipelineStage.Fetch,
      {},
      () =>
        this.retryStandard(url, options, () => this.fetchBytes(url, options)),
      { observer: this.metrics },
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
  async fetchPdfText(
    url: string,
    options: RetryOptions = {},
  ): Promise<PdfFetchResult> {
    const result = await this.fetchBytesWithRetry(url, options);
    const text = await this.parseArchivedPdf(result);
    return {
      text,
      ...(result.sourceVersionId && {
        sourceVersionId: result.sourceVersionId,
      }),
    };
  }

  /**
   * Parse a fetched PDF — or, when its bytes are archived and were already
   * parsed completely by this parser version, return that parse instead
   * (propositions Phase B, K-P1). On 2026-10-24 a propositions sync spent 78%
   * of its run re-parsing, 74% re-OCRing, PDFs whose bytes had not changed.
   *
   * The bytes are still fetched: their content address is what proves them
   * unchanged. Only a complete parse is recorded, so a PDF parsed while OCR
   * was down is parsed again next time rather than pinned to its fallback.
   */
  private async parseArchivedPdf(result: BytesFetchResult): Promise<string> {
    const id = result.sourceVersionId;
    const archive = this.sourceArchive;
    const key = this.pdfParserKey();
    if (id && archive?.findParsedText) {
      const reused = await archive.findParsedText(id, key);
      if (reused !== undefined) {
        this.logger.debug(`Reused the ${key} parse of ${id}`);
        this.countParse(PdfParseSource.Reused, true);
        return reused;
      }
    }
    if (id && this.pdfParseLane) {
      const laned = await this.pdfParseLane.parse(id, key);
      if (laned !== undefined) {
        this.countParse(PdfParseSource.Lane, true);
        return laned;
      }
    }
    const parsed = await this.parsePdf(result.content);
    this.countParse(PdfParseSource.InProcess, parsed.complete);
    if (id && parsed.complete && archive?.recordParsedText) {
      await archive.recordParsedText(id, key, parsed.text);
    }
    return parsed.text;
  }

  private countParse(
    source: (typeof PdfParseSource)[keyof typeof PdfParseSource],
    complete: boolean,
  ): void {
    this.metrics?.increment(PdfParseMetric.Total, 1, {
      source,
      complete: String(complete),
    });
  }

  private cachedParserKey?: string;

  /**
   * What a recorded parse must have been made with to be reused (K-P1): the
   * cascade's version, plus a short hash of what it runs with in THIS
   * process — the installed pdf-parse and mupdf, and the OCR engine's
   * description. Two processes OCRing differently (another language pack, a
   * preprocessing preset) never serve each other's parses, and a dependency
   * bump re-parses without anyone remembering to bump a constant. Fits
   * `source_versions.parser_version` (40 chars).
   */
  pdfParserKey(): string {
    this.cachedParserKey ??= pdfParserKeyFor(
      this.ocrService?.getProviderInfo?.() ?? null,
    );
    return this.cachedParserKey;
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
   * Wait for this URL's host under the shared per-host rate limit (S1).
   *
   * For a fetch that does not go through this provider — the API and bulk
   * download handlers stream with their own `fetch` — so it still waits in
   * the same bucket, under the same policy, as everything else hitting that
   * host. Without this the FEC API, whose config asks 0.25 rps against its
   * quota, was paced only by a fixed 250ms gap between pages.
   */
  async acquireHostSlot(url: string): Promise<void> {
    await this.hostRateLimiter.acquire(url);
  }

  /**
   * Cleanup resources (call on module destroy)
   */
  async onModuleDestroy(): Promise<void> {
    await this.cache.destroy();
    // Its Redis client, left open, can hold a graceful shutdown until SIGKILL.
    await this.hostRateLimiter.destroy?.();
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
    decodeBody: (bytes: Buffer) => T,
  ): Promise<FetchedArtifact<T>> {
    const fetched = await this.circuitBreaker.execute(async () => {
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

      // Read the body once as bytes and hash it *before* decoding. Both the
      // text and binary paths come through here, so this is the single point
      // where a fetched artifact can be content-addressed against what the
      // server actually sent (#1276). Decoding first and hashing the result
      // would attest to our interpretation of the bytes, not to the bytes.
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentHash = hashContentBytes(bytes);
      const fetchedAt = new Date().toISOString();
      const content = decodeBody(bytes);
      const contentType = response.headers.get("content-type") || "unknown";
      const etag = response.headers.get("etag") ?? undefined;
      const lastModified = response.headers.get("last-modified") ?? undefined;
      const finalUrl = response.url;
      const wasRedirected =
        !!finalUrl && normalizeUrl(finalUrl) !== normalizeUrl(url);

      if (wasRedirected) {
        if (options.fromConfig) {
          this.logger.warn(
            `URL redirect detected: ${url} → ${finalUrl}. Consider updating the data source config.`,
          );
        } else {
          this.logger.debug(
            `URL redirect detected (harvested URL): ${url} → ${finalUrl}`,
          );
        }
      }

      return {
        content,
        bytes,
        statusCode: response.status,
        contentType,
        contentHash,
        fetchedAt,
        ...(etag && { etag }),
        ...(lastModified && { lastModified }),
        ...(wasRedirected && { redirectedFrom: url, finalUrl }),
      };
    });

    // Archive outside the circuit breaker. The breaker exists to stop
    // hammering a failing remote host; archiving talks to our own database,
    // and letting its latency or an outage count as the host failing would
    // trip the breaker and halt fetching altogether (#1276).
    const sourceVersionId = options.archive
      ? await this.archiveFetch(
          fetched.bytes,
          url,
          fetched.contentType,
          fetched,
          options.archive,
        )
      : undefined;

    // `bytes` never leaves this method. Callers want decoded content, and the
    // raw buffer would otherwise ride along into the cache — JSON-serialised
    // into Redis on every fetch, for a value nothing downstream reads.
    const { bytes: _rawBytes, ...result } = fetched;
    return { ...result, ...(sourceVersionId && { sourceVersionId }) };
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
