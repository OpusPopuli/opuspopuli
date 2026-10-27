import type { Logger } from '@nestjs/common';
import { mapWithConcurrency } from '@opuspopuli/common';
import { decodeFetchedText, type FetchedBytes } from './resilient-fetch';

/** What a crawl found: the pages in discovery order, and the ones it fetched. */
export interface CivicsCrawl {
  /** Seed first, then breadth-first, capped at `maxPages`. */
  urls: string[];
  /**
   * The bytes of every page the crawl fetched for its links — every page
   * above the depth limit. The civics page pass takes them instead of
   * fetching the same URL a second time.
   */
  fetched: Map<string, FetchedBytes>;
}

export interface CrawlOptions {
  seed: string;
  /** Link levels to follow; 0 = the seed alone, never fetched. */
  depth: number;
  maxPages: number;
  /** Hosts a seed may be on (the region's registered data-source hosts). */
  registeredHosts: Set<string>;
  /** Fetches in flight at once — the network lane's concurrency. */
  concurrency: number;
  fetch: (url: string) => Promise<FetchedBytes>;
  logger: Pick<Logger, 'warn' | 'error'>;
}

/**
 * BFS-crawl URLs reachable from a seed, staying within its host and path
 * prefix (`/legislative-process/` will not escape into `/contact/`),
 * hard-capped by `depth` and `maxPages`.
 *
 * On the network lane: each level is fetched up to `concurrency` pages at a
 * time, and links are merged in the SAME parent order as a one-at-a-time BFS,
 * so the list — which `maxPages` truncates — is identical to the serial
 * crawl's. Fetching stops once the cap is met, after at most one window more
 * than the serial loop would have fetched. Each host's rate is still the
 * per-host token bucket's.
 */
export async function crawlInScope(opts: CrawlOptions): Promise<CivicsCrawl> {
  const seed = canonicalizeUrl(opts.seed);
  const fetched = new Map<string, FetchedBytes>();
  const seedUrl = new URL(seed);
  if (
    seedUrl.protocol !== 'https:' ||
    !opts.registeredHosts.has(seedUrl.hostname)
  ) {
    opts.logger.error(
      `Civics crawl rejected: ${seedUrl.hostname} is not a registered data source host or is non-HTTPS`,
    );
    return { urls: [], fetched };
  }

  const state: CrawlState = {
    inScope: scopeOf(seedUrl),
    visited: new Set<string>([seed]),
    order: [seed],
    fetched,
    maxPages: opts.maxPages,
  };
  let level = [seed];
  for (let d = 0; d < opts.depth && level.length > 0; d++) {
    level = await crawlLevel(level, opts, state);
  }
  return { urls: state.order, fetched };
}

/** What a crawl has found so far, shared by its levels. */
interface CrawlState {
  inScope: (url: string) => boolean;
  visited: Set<string>;
  order: string[];
  fetched: Map<string, FetchedBytes>;
  maxPages: number;
}

const isFull = (state: CrawlState) => state.order.length >= state.maxPages;

/**
 * Fetch one BFS level a window at a time, merging each window's links in
 * parent order; stops starting windows once the cap is met. Returns the next
 * level — the pages this one discovered.
 */
async function crawlLevel(
  level: string[],
  opts: CrawlOptions,
  state: CrawlState,
): Promise<string[]> {
  const next: string[] = [];
  // `concurrency` is a positive integer (`networkLaneConcurrency()`);
  // mapWithConcurrency throws on anything else before this could spin.
  for (let i = 0; i < level.length && !isFull(state); i += opts.concurrency) {
    const window = level.slice(i, i + opts.concurrency);
    const pages = await mapWithConcurrency(window, opts.concurrency, (url) =>
      fetchPage(url, opts),
    );
    for (const [k, page] of pages.entries()) {
      if (!page) continue;
      state.fetched.set(window[k], page.bytes);
      next.push(...mergeLinks(page.links, state));
    }
  }
  return next;
}

/** Add a page's new in-scope links to the crawl, in order, up to the cap. */
function mergeLinks(links: string[], state: CrawlState): string[] {
  const added: string[] = [];
  for (const link of links) {
    if (isFull(state)) break;
    const canonical = canonicalizeUrl(link);
    if (state.visited.has(canonical) || !state.inScope(canonical)) continue;
    state.visited.add(canonical);
    state.order.push(canonical);
    added.push(canonical);
  }
  return added;
}

/** One page's bytes and links; undefined (logged) when it could not be fetched. */
async function fetchPage(
  url: string,
  opts: Pick<CrawlOptions, 'fetch' | 'logger'>,
): Promise<{ bytes: FetchedBytes; links: string[] } | undefined> {
  try {
    const bytes = await opts.fetch(url);
    return { bytes, links: extractLinks(url, decodeFetchedText(bytes.body)) };
  } catch (e) {
    opts.logger.warn(
      `Civics crawl: fetch failed for ${url}: ${(e as Error).message}`,
    );
    return undefined;
  }
}

function scopeOf(seedUrl: URL): (url: string) => boolean {
  const pathPrefix = seedUrl.pathname.replace(/[^/]*$/, '');
  return (u) => {
    try {
      const parsed = new URL(u);
      return (
        parsed.host === seedUrl.host && parsed.pathname.startsWith(pathPrefix)
      );
    } catch {
      return false;
    }
  };
}

/** Strip the fragment and a trailing slash, so one page has one URL. */
export function canonicalizeUrl(url: string): string {
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

/** Every `<a href>` on a page, resolved against it; script/mail/tel/fragments skipped. */
export function extractLinks(baseUrl: string, html: string): string[] {
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
