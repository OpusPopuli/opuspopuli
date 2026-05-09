/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for the civics-ingest methods on RegionDomainService.
 * Tests are scoped to the pure/low-dep helpers:
 *   - canonicalizeUrl   — URL fragment stripping + trailing-slash normalisation
 *   - extractLinks      — anchor href extraction + scheme filtering
 *   - crawlCivicsUrls   — BFS scope check, depth limit, maxPages cap
 *   - syncCivics        — graceful skip when promptClient/llm not injected
 *
 * Heavy dependencies (db, scraping pipeline, etc.) are not needed — we
 * construct a prototype-level instance and spy on the I/O boundary
 * (fetchUrlText) directly.
 */

import { RegionDomainService } from './region.service';

function buildSvc(overrides: Record<string, any> = {}): any {
  const svc = Object.create(RegionDomainService.prototype);
  Object.assign(svc, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    pluginRegistry: { getLocal: jest.fn().mockReturnValue(null) },
    promptClient: undefined,
    llm: undefined,
    ...overrides,
  });
  return svc;
}

// ── canonicalizeUrl ──────────────────────────────────────────────────────────

describe('canonicalizeUrl', () => {
  const svc = buildSvc();

  it('strips URL fragment', () => {
    expect(svc.canonicalizeUrl('https://example.com/page#section')).toBe(
      'https://example.com/page',
    );
  });

  it('normalises trailing slash on non-root path', () => {
    expect(svc.canonicalizeUrl('https://example.com/resources/page/')).toBe(
      'https://example.com/resources/page',
    );
  });

  it('preserves root slash', () => {
    expect(svc.canonicalizeUrl('https://example.com/')).toBe(
      'https://example.com/',
    );
  });

  it('preserves query string', () => {
    expect(svc.canonicalizeUrl('https://example.com/page?foo=bar')).toBe(
      'https://example.com/page?foo=bar',
    );
  });

  it('returns the input unchanged for malformed URLs', () => {
    expect(svc.canonicalizeUrl('not-a-url')).toBe('not-a-url');
  });
});

// ── extractLinks ─────────────────────────────────────────────────────────────

describe('extractLinks', () => {
  const svc = buildSvc();
  const base = 'https://www.assembly.ca.gov/resources/legislative-process';

  it('extracts absolute hrefs', () => {
    const html = `<a href="https://other.example.com/page">link</a>`;
    expect(svc.extractLinks(base, html)).toEqual([
      'https://other.example.com/page',
    ]);
  });

  it('resolves relative hrefs against baseUrl', () => {
    const html = `<a href="/resources/glossary">Glossary</a>`;
    expect(svc.extractLinks(base, html)).toEqual([
      'https://www.assembly.ca.gov/resources/glossary',
    ]);
  });

  it('skips javascript: hrefs', () => {
    const html = `<a href="javascript:void(0)">Click</a>`;
    expect(svc.extractLinks(base, html)).toEqual([]);
  });

  it('skips mailto: hrefs', () => {
    const html = `<a href="mailto:info@example.com">Email</a>`;
    expect(svc.extractLinks(base, html)).toEqual([]);
  });

  it('skips tel: hrefs', () => {
    const html = `<a href="tel:+15555555555">Call</a>`;
    expect(svc.extractLinks(base, html)).toEqual([]);
  });

  it('skips fragment-only hrefs', () => {
    const html = `<a href="#section">Jump</a>`;
    expect(svc.extractLinks(base, html)).toEqual([]);
  });

  it('extracts multiple links from one page', () => {
    const html = `
      <a href="/resources/glossary">Glossary</a>
      <a href="/resources/visit">Visit</a>
      <a href="javascript:void(0)">Skip</a>
    `;
    const links = svc.extractLinks(base, html);
    expect(links).toHaveLength(2);
    expect(links).toContain('https://www.assembly.ca.gov/resources/glossary');
    expect(links).toContain('https://www.assembly.ca.gov/resources/visit');
  });

  it('handles empty HTML', () => {
    expect(svc.extractLinks(base, '')).toEqual([]);
  });
});

// ── crawlCivicsUrls ──────────────────────────────────────────────────────────

describe('crawlCivicsUrls', () => {
  const SEED = 'https://www.assembly.ca.gov/resources/legislative-process';

  function makeSvc(fetchImpl: (url: string) => Promise<string>) {
    const svc = buildSvc();
    jest.spyOn(svc, 'fetchUrlText').mockImplementation(fetchImpl);
    return svc;
  }

  it('returns only the seed when crawlDepth is 0 (default)', async () => {
    const svc = makeSvc(jest.fn());
    const ds = { url: SEED };
    const urls = await svc.crawlCivicsUrls(ds);
    expect(urls).toEqual([SEED]);
    expect(svc.fetchUrlText).not.toHaveBeenCalled();
  });

  it('follows links at depth 1 that are in scope', async () => {
    const glossaryUrl = 'https://www.assembly.ca.gov/resources/glossary';
    const svc = makeSvc(async () => `<a href="${glossaryUrl}">Glossary</a>`);
    const urls = await svc.crawlCivicsUrls({ url: SEED, crawlDepth: 1 });
    expect(urls).toContain(SEED);
    expect(urls).toContain(glossaryUrl);
  });

  it('excludes out-of-scope links (different host)', async () => {
    const svc = makeSvc(
      async () => `<a href="https://senate.ca.gov/page">Senate</a>`,
    );
    const urls = await svc.crawlCivicsUrls({ url: SEED, crawlDepth: 1 });
    expect(urls).toEqual([SEED]);
  });

  it('excludes out-of-scope links (same host but different path prefix)', async () => {
    const svc = makeSvc(
      async () =>
        `<a href="https://www.assembly.ca.gov/members/list">Members</a>`,
    );
    const urls = await svc.crawlCivicsUrls({ url: SEED, crawlDepth: 1 });
    expect(urls).toEqual([SEED]);
  });

  it('deduplicates visited URLs', async () => {
    const dup = 'https://www.assembly.ca.gov/resources/glossary';
    const svc = makeSvc(
      async () =>
        `<a href="${dup}">A</a><a href="${dup}/">B</a><a href="${dup}#frag">C</a>`,
    );
    const urls = await svc.crawlCivicsUrls({ url: SEED, crawlDepth: 1 });
    expect(urls.filter((u: string) => u.includes('glossary'))).toHaveLength(1);
  });

  it('respects crawlMaxPages cap', async () => {
    const svc = makeSvc(async (url: string) => {
      const n = parseInt(url.split('/').pop() ?? '0', 10);
      return Array.from(
        { length: 5 },
        (_, i) =>
          `<a href="https://www.assembly.ca.gov/resources/${n + i + 1}">L</a>`,
      ).join('');
    });
    const urls = await svc.crawlCivicsUrls({
      url: 'https://www.assembly.ca.gov/resources/0',
      crawlDepth: 10,
      crawlMaxPages: 4,
    });
    expect(urls.length).toBeLessThanOrEqual(4);
  });

  it('continues past a fetch failure instead of aborting', async () => {
    // With crawlDepth: 2 the bad link is at depth 1 (d < 2) so it IS fetched.
    // The good link is also at depth 1 and fetched successfully.
    const ok = 'https://www.assembly.ca.gov/resources/glossary';
    const fail = 'https://www.assembly.ca.gov/resources/bad';
    const svc = makeSvc(async (url: string) => {
      if (url.includes('bad')) throw new Error('Network error');
      if (url === SEED)
        return `<a href="${fail}">Bad</a><a href="${ok}">OK</a>`;
      return '';
    });
    const urls = await svc.crawlCivicsUrls({ url: SEED, crawlDepth: 2 });
    // Both links are discovered and recorded even though one failed to fetch
    expect(urls).toContain(ok);
    expect(urls).toContain(fail);
    expect(svc.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('fetch failed'),
    );
  });
});

// ── syncCivics — guard paths ──────────────────────────────────────────────────

describe('syncCivics — guard paths', () => {
  it('returns zero counts and warns when promptClient is not injected', async () => {
    const svc = buildSvc({ promptClient: undefined, llm: {} });
    const result = await svc.syncCivics();
    expect(result).toEqual({ processed: 0, created: 0, updated: 0 });
    expect(svc.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('PromptClient'),
    );
  });

  it('returns zero counts and warns when llm is not injected', async () => {
    const svc = buildSvc({ promptClient: {}, llm: undefined });
    const result = await svc.syncCivics();
    expect(result).toEqual({ processed: 0, created: 0, updated: 0 });
    expect(svc.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('PromptClient'),
    );
  });

  it('returns zero counts when plugin has no getDataSources', async () => {
    const svc = buildSvc({
      promptClient: {},
      llm: {},
      pluginRegistry: { getLocal: jest.fn().mockReturnValue({}) },
    });
    const result = await svc.syncCivics();
    expect(result).toEqual({ processed: 0, created: 0, updated: 0 });
    expect(svc.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('getDataSources'),
    );
  });

  it('returns zero counts when no civics data sources configured', async () => {
    const svc = buildSvc({
      promptClient: {},
      llm: {},
      pluginRegistry: {
        getLocal: jest.fn().mockReturnValue({
          getDataSources: jest.fn().mockReturnValue([]),
          getName: jest.fn().mockReturnValue('california'),
        }),
      },
    });
    const result = await svc.syncCivics();
    expect(result).toEqual({ processed: 0, created: 0, updated: 0 });
  });
});
