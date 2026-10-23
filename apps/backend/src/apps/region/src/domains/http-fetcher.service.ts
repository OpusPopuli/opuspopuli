import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type DataSourceConfig } from '@opuspopuli/common';
import { METRICS_OBSERVER, type MetricsObserver } from '@opuspopuli/common';
import { htmlToReadableText } from '@opuspopuli/common';
import {
  type IHostRateLimiter,
  MemoryHostRateLimiter,
} from '@opuspopuli/common';
import { fetchTextWithRetry } from './resilient-fetch';
import { DEFAULT_HOST_RATE, HOST_RATE_LIMITER } from './region.tokens';

/**
 * Shared HTTP / HTML helpers extracted from RegionSyncService as part of
 * #828 Step 7 (bills extraction). Owned by Nest DI so all bounded-context
 * sync services (bills, civics, anything else that scrapes a third-party
 * page) inject the same instance. The per-host rate limit itself is the
 * shared `HOST_RATE_LIMITER` (S1), held in Redis, so it is one budget per
 * site across services AND processes — a per-process throttle multiplied the
 * rate a site saw by the number of processes.
 *
 * Methods kept here are the ones civics and bills both depend on:
 *   - `fetchUrlText` — throttled + retried HTML fetch
 *   - `htmlToReadableText` — strip scripts/styles/nav/etc. into a body of
 *     readable text suitable for LLM input
 *   - `crawlCivicsUrls` — BFS within the seed's path prefix, used by both
 *     civics ingestion and the bills bill-text discovery fallback
 *   - `canonicalizeUrl` / `extractLinks` — helpers crawlCivicsUrls uses
 */
@Injectable()
export class HttpFetcherService {
  private readonly logger = new Logger(HttpFetcherService.name, {
    timestamp: true,
  });

  private readonly hostRateLimiter: IHostRateLimiter;

  constructor(
    /**
     * Where fetch timings go (M1). Optional: this service is constructed in
     * test modules that register no metrics, and a fetch must not depend on
     * being measured.
     */
    @Optional()
    @Inject(METRICS_OBSERVER)
    private readonly metrics?: MetricsObserver,
    /** Optional for the same reason as `metrics`; see RegionSyncService. */
    @Optional()
    @Inject(HOST_RATE_LIMITER)
    hostRateLimiter?: IHostRateLimiter,
  ) {
    this.hostRateLimiter =
      hostRateLimiter ?? new MemoryHostRateLimiter(DEFAULT_HOST_RATE);
  }

  /**
   * Throttled + retried HTML fetch. Wraps `fetchTextWithRetry` from
   * `./resilient-fetch` so all per-bill / per-page fetches honor the
   * shared per-host gap and back off on 5xx / 429 / timeouts before
   * giving up. See opuspopuli#730.
   */
  async fetchUrlText(url: string): Promise<string> {
    return fetchTextWithRetry(url, {
      timeoutMs: 20_000,
      throttle: this.hostRateLimiter,
      logger: this.logger,
      metrics: this.metrics,
      // No `dataType`: this service is shared between the bills and civics
      // syncs and cannot tell which one is calling. Absent beats guessed.
    });
  }

  /** Delegates to @opuspopuli/common — see the note in region-sync (#1324). */
  htmlToReadableText(html: string): string {
    return htmlToReadableText(html);
  }

  /**
   * BFS-crawl URLs reachable from a civics data source, staying within
   * the seed's path prefix (e.g. `/legislative-process/` won't escape
   * into `/contact/`). Hard-capped by `crawlMaxPages` and `crawlDepth`.
   */
  async crawlCivicsUrls(
    ds: DataSourceConfig,
    registeredHosts: Set<string>,
  ): Promise<string[]> {
    const depth = ds.crawlDepth ?? 0;
    const maxPages = ds.crawlMaxPages ?? 20;

    const seed = this.canonicalizeUrl(ds.url);
    const seedUrl = new URL(seed);

    if (
      seedUrl.protocol !== 'https:' ||
      !registeredHosts.has(seedUrl.hostname)
    ) {
      this.logger.error(
        `Civics crawl rejected: ${seedUrl.hostname} is not a registered data source host or is non-HTTPS`,
      );
      return [];
    }

    const pathPrefix = seedUrl.pathname.replace(/[^/]*$/, '');
    const inScope = (u: string): boolean => {
      try {
        const parsed = new URL(u);
        return (
          parsed.host === seedUrl.host && parsed.pathname.startsWith(pathPrefix)
        );
      } catch {
        return false;
      }
    };

    const visited = new Set<string>([seed]);
    const order: string[] = [seed];
    const queue: { url: string; depth: number }[] = [{ url: seed, depth: 0 }];

    while (queue.length > 0 && order.length < maxPages) {
      const { url, depth: d } = queue.shift()!;
      if (d >= depth) continue;
      let html: string;
      try {
        html = await this.fetchUrlText(url);
      } catch (e) {
        this.logger.warn(
          `Civics crawl: fetch failed for ${url}: ${(e as Error).message}`,
        );
        continue;
      }
      for (const link of this.extractLinks(url, html)) {
        const canonical = this.canonicalizeUrl(link);
        if (visited.has(canonical) || !inScope(canonical)) continue;
        visited.add(canonical);
        order.push(canonical);
        queue.push({ url: canonical, depth: d + 1 });
        if (order.length >= maxPages) break;
      }
    }
    return order;
  }

  canonicalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      u.hash = '';
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  extractLinks(baseUrl: string, html: string): string[] {
    const out: string[] = [];
    const re = /<a\b[^>]*\bhref\s*=\s*['"]([^'"]+)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const href = m[1].trim().replace(/&amp;/g, '&');
      if (
        !href ||
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('#')
      ) {
        continue;
      }
      try {
        out.push(new URL(href, baseUrl).toString());
      } catch {
        // skip malformed
      }
    }
    return out;
  }
}
