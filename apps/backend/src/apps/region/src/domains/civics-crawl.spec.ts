/**
 * The civics crawl (`civics-crawl.ts`): URL canonicalisation, link
 * extraction, and the in-scope BFS — now on the network lane, which must
 * discover exactly what the one-at-a-time crawl did.
 */
import { canonicalizeUrl, crawlInScope, extractLinks } from './civics-crawl';
import type { FetchedBytes } from './resilient-fetch';

const page = (html: string): FetchedBytes => ({
  body: Buffer.from(html, 'utf8'),
  contentType: 'text/html',
  fetchedAt: new Date(0).toISOString(),
});

// ── canonicalizeUrl ──────────────────────────────────────────────────────────

describe('canonicalizeUrl', () => {
  it('strips URL fragment', () => {
    expect(canonicalizeUrl('https://example.com/page#section')).toBe(
      'https://example.com/page',
    );
  });

  it('normalises trailing slash on non-root path', () => {
    expect(canonicalizeUrl('https://example.com/resources/page/')).toBe(
      'https://example.com/resources/page',
    );
  });

  it('preserves root slash', () => {
    expect(canonicalizeUrl('https://example.com/')).toBe(
      'https://example.com/',
    );
  });

  it('preserves query string', () => {
    expect(canonicalizeUrl('https://example.com/page?foo=bar')).toBe(
      'https://example.com/page?foo=bar',
    );
  });

  it('returns the input unchanged for malformed URLs', () => {
    expect(canonicalizeUrl('not-a-url')).toBe('not-a-url');
  });
});

// ── extractLinks ─────────────────────────────────────────────────────────────

describe('extractLinks', () => {
  const base = 'https://www.assembly.ca.gov/resources/legislative-process';

  it('extracts absolute hrefs', () => {
    const html = `<a href="https://other.example.com/page">link</a>`;
    expect(extractLinks(base, html)).toEqual([
      'https://other.example.com/page',
    ]);
  });

  it('resolves relative hrefs against baseUrl', () => {
    const html = `<a href="/resources/glossary">Glossary</a>`;
    expect(extractLinks(base, html)).toEqual([
      'https://www.assembly.ca.gov/resources/glossary',
    ]);
  });

  it('skips javascript: hrefs', () => {
    const html = `<a href="javascript:void(0)">Click</a>`;
    expect(extractLinks(base, html)).toEqual([]);
  });

  it('skips mailto: hrefs', () => {
    const html = `<a href="mailto:info@example.com">Email</a>`;
    expect(extractLinks(base, html)).toEqual([]);
  });

  it('skips tel: hrefs', () => {
    const html = `<a href="tel:+15555555555">Call</a>`;
    expect(extractLinks(base, html)).toEqual([]);
  });

  it('skips fragment-only hrefs', () => {
    const html = `<a href="#section">Jump</a>`;
    expect(extractLinks(base, html)).toEqual([]);
  });

  it('extracts multiple links from one page', () => {
    const html = `
      <a href="/resources/glossary">Glossary</a>
      <a href="/resources/visit">Visit</a>
      <a href="javascript:void(0)">Skip</a>
    `;
    const links = extractLinks(base, html);
    expect(links).toHaveLength(2);
    expect(links).toContain('https://www.assembly.ca.gov/resources/glossary');
    expect(links).toContain('https://www.assembly.ca.gov/resources/visit');
  });

  it('handles empty HTML', () => {
    expect(extractLinks(base, '')).toEqual([]);
  });
});

// ── crawlInScope ──────────────────────────────────────────────────────────

describe('crawlInScope', () => {
  const SEED = 'https://www.assembly.ca.gov/resources/legislative-process';
  const HOSTS = new Set(['www.assembly.ca.gov']);
  const logger = () => ({ warn: jest.fn(), error: jest.fn() });

  const crawl = (
    html: (url: string) => string | Promise<string>,
    opts: {
      seed?: string;
      depth?: number;
      maxPages?: number;
      concurrency?: number;
    } = {},
  ) => {
    const log = logger();
    const fetch = jest.fn(async (url: string) => page(await html(url)));
    const result = crawlInScope({
      seed: opts.seed ?? SEED,
      depth: opts.depth ?? 1,
      maxPages: opts.maxPages ?? 20,
      registeredHosts: HOSTS,
      concurrency: opts.concurrency ?? 4,
      fetch,
      logger: log,
    });
    return { result, fetch, log };
  };

  it('returns only the seed, unfetched, at depth 0', async () => {
    const { result, fetch } = crawl(() => '', { depth: 0 });
    await expect(result).resolves.toMatchObject({ urls: [SEED] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('follows in-scope links and hands back the bytes it fetched', async () => {
    const glossary = 'https://www.assembly.ca.gov/resources/glossary';
    const { result } = crawl(() => `<a href="${glossary}">Glossary</a>`);
    const { urls, fetched } = await result;
    expect(urls).toEqual([SEED, glossary]);
    // The seed was fetched for its links; the leaf was not (depth 1).
    expect([...fetched.keys()]).toEqual([SEED]);
    expect(fetched.get(SEED)?.body.toString()).toContain('Glossary');
  });

  it('excludes other hosts and other path prefixes', async () => {
    const { result } = crawl(
      () =>
        `<a href="https://senate.ca.gov/page">S</a><a href="https://www.assembly.ca.gov/members/list">M</a>`,
    );
    await expect(result).resolves.toMatchObject({ urls: [SEED] });
  });

  it('deduplicates visited URLs', async () => {
    const dup = 'https://www.assembly.ca.gov/resources/glossary';
    const { result } = crawl(
      () =>
        `<a href="${dup}">A</a><a href="${dup}/">B</a><a href="${dup}#frag">C</a>`,
    );
    const { urls } = await result;
    expect(urls.filter((u) => u.includes('glossary'))).toHaveLength(1);
  });

  it('continues past a fetch failure instead of aborting', async () => {
    const ok = 'https://www.assembly.ca.gov/resources/glossary';
    const fail = 'https://www.assembly.ca.gov/resources/bad';
    const { result, log } = crawl(
      (url) => {
        if (url.includes('bad')) throw new Error('Network error');
        return url === SEED
          ? `<a href="${fail}">Bad</a><a href="${ok}">OK</a>`
          : '';
      },
      { depth: 2 },
    );
    const { urls, fetched } = await result;
    expect(urls).toEqual([SEED, fail, ok]);
    expect(fetched.has(fail)).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('fetch failed'),
    );
  });

  it('rejects a non-HTTPS seed, and one on an unregistered host', async () => {
    const insecure = crawl(() => '', { seed: 'http://www.assembly.ca.gov/x' });
    await expect(insecure.result).resolves.toMatchObject({ urls: [] });
    expect(insecure.log.error).toHaveBeenCalledWith(
      expect.stringContaining('non-HTTPS'),
    );

    const foreign = crawl(() => '', { seed: 'https://internal.corp/metadata' });
    await expect(foreign.result).resolves.toMatchObject({ urls: [] });
    expect(foreign.log.error).toHaveBeenCalledWith(
      expect.stringContaining('not a registered data source host'),
    );
  });

  /**
   * A site tree wide enough that the cap bites mid-level: each page links to
   * five children. The one-at-a-time reference is the crawl as it was before
   * the network lane — kept here, verbatim in shape, as the oracle.
   */
  // Every page also links to one shared page (dedup across siblings) and to
  // an out-of-scope page; page 3 fails to fetch.
  const SHARED = 'https://www.assembly.ca.gov/resources/shared';
  const tree = (url: string) => {
    if (url.endsWith('/3')) throw new Error('HTTP 403');
    const n = Number(url.split('/').pop()) || 0;
    return [
      ...Array.from(
        { length: 5 },
        (_, i) =>
          `<a href="https://www.assembly.ca.gov/resources/${n * 5 + i + 1}">L</a>`,
      ),
      `<a href="${SHARED}">S</a>`,
      `<a href="https://www.assembly.ca.gov/members/elsewhere">X</a>`,
    ].join('');
  };
  const serialReference = async (depth: number, maxPages: number) => {
    const seed = 'https://www.assembly.ca.gov/resources/0';
    const inScope = (u: string) =>
      u.startsWith('https://www.assembly.ca.gov/resources/');
    const order = [seed];
    const visited = new Set(order);
    const queue = [{ url: seed, d: 0 }];
    while (queue.length > 0 && order.length < maxPages) {
      const { url, d } = queue.shift()!;
      if (d >= depth) continue;
      let html: string;
      try {
        html = tree(url);
      } catch {
        continue;
      }
      for (const link of extractLinks(url, html)) {
        const c = canonicalizeUrl(link);
        if (visited.has(c) || !inScope(c)) continue;
        visited.add(c);
        order.push(c);
        queue.push({ url: c, d: d + 1 });
        if (order.length >= maxPages) break;
      }
    }
    return order;
  };

  it.each([
    [1, 20, 1],
    [2, 20, 4],
    [3, 20, 4],
    [3, 13, 3],
    [2, 7, 2],
  ])(
    'discovers exactly what the serial crawl did (depth %i, cap %i, concurrency %i)',
    async (depth, maxPages, concurrency) => {
      const { result } = crawl(tree, {
        seed: 'https://www.assembly.ca.gov/resources/0',
        depth,
        maxPages,
        concurrency,
      });
      expect((await result).urls).toEqual(
        await serialReference(depth, maxPages),
      );
    },
  );

  it('keeps at most `concurrency` fetches in flight', async () => {
    let active = 0;
    let peak = 0;
    const { result } = crawl(
      async (url) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return tree(url);
      },
      {
        seed: 'https://www.assembly.ca.gov/resources/0',
        depth: 2,
        concurrency: 3,
      },
    );
    await result;
    expect(peak).toBe(3);
  });

  it('stops fetching once the page cap is met', async () => {
    const { result, fetch } = crawl(tree, {
      seed: 'https://www.assembly.ca.gov/resources/0',
      depth: 3,
      maxPages: 6,
      concurrency: 2,
    });
    expect((await result).urls).toHaveLength(6);
    // The seed's five children fill the cap; level 2 is never fetched.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
