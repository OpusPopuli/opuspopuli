import { Injectable, Logger } from '@nestjs/common';
import { type DataSourceConfig } from '@opuspopuli/common';
import { HostThrottle, fetchTextWithRetry } from './resilient-fetch';

/**
 * Shared HTTP / HTML helpers extracted from RegionSyncService as part of
 * #828 Step 7 (bills extraction). Owned by Nest DI so all bounded-context
 * sync services (bills, civics, anything else that scrapes a third-party
 * page) inject the same instance and therefore share the per-host
 * throttle — the alternative would be per-service throttles that defeat
 * the politeness gate when multiple syncs run in parallel.
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

  /** Per-host fetch throttle shared across all syncs in this process. */
  private readonly hostThrottle = new HostThrottle(1000);

  /**
   * Apply per-source `rateLimitOverride` values to the relevant hostname
   * before a sync's inner loop starts. Bills sync calls this from its
   * own setup; civics never overrides today.
   */
  applyHostThrottleOverrides(dataSources: DataSourceConfig[]): void {
    for (const ds of dataSources) {
      const override = ds.rateLimitOverride;
      if (!override) continue;
      try {
        const hostname = new URL(ds.url).hostname;
        this.hostThrottle.setRequestsPerSecond(hostname, override);
      } catch {
        this.logger.warn(
          `Could not apply rateLimitOverride for malformed URL: ${ds.url}`,
        );
      }
    }
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
      throttle: this.hostThrottle,
      logger: this.logger,
    });
  }

  htmlToReadableText(html: string): string {
    let s = html;
    s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '');
    s = s.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '');
    s = s.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '');
    s = s.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<[^>]+>/g, ' ');
    s = s
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    s = s
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
    return s;
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
