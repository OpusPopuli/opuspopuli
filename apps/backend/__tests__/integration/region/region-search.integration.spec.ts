/**
 * Lexical search integration tests (#1153, spec
 * docs/plans/SPEC-bills-propositions-search.md).
 *
 * Against a real `postgres_test`: the ranking, snippet generation and
 * filter composition are raw SQL over GENERATED tsvector columns — a
 * mocked Prisma would prove the mapping code runs, not that weighting,
 * websearch parsing, or the deletedAt exclusion behave.
 */

import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import type { ICache } from '@opuspopuli/common';
import {
  MAX_SEARCH_WINDOW,
  RegionSearchService,
  SNIPPET_END,
  SNIPPET_START,
  normalizeMeasureNumberQuery,
  sanitizeSearchQuery,
  SEARCH_QUERY_MAX_LENGTH,
} from '../../../src/apps/region/src/domains/region-search.service';
import { PropositionStatusGQL } from '../../../src/apps/region/src/domains/models/proposition.model';
import { RegionQueryService } from '../../../src/apps/region/src/domains/region-query.service';
import { RegionCacheService } from '../../../src/apps/region/src/domains/region-cache.service';
import { BillLifecycle } from '../../../src/apps/region/src/domains/models/bill.model';
import {
  SearchResultType,
  SearchSuggestionKind,
} from '../../../src/apps/region/src/domains/models/region-search.model';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

/** In-memory ICache<string> so RegionQueryService needs no Redis. */
function memoryCache(): ICache<string> {
  const store = new Map<string, string>();
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: string) => {
      store.set(k, v);
    },
    has: (k: string) => store.has(k),
    delete: (k: string) => store.delete(k),
    keys: () => [...store.keys()],
    clear: () => {
      store.clear();
    },
    get size() {
      return store.size;
    },
    destroy: () => {
      store.clear();
    },
  };
}

type BillFixtureOverrides = Partial<Prisma.BillCreateManyInput> &
  Pick<
    Prisma.BillCreateManyInput,
    'externalId' | 'billNumber' | 'measureTypeCode' | 'title'
  >;

function billFixture(
  overrides: BillFixtureOverrides,
): Prisma.BillCreateManyInput {
  return {
    regionId: 'california',
    sessionYear: '2025-2026',
    sourceUrl: 'https://leginfo.legislature.ca.gov/test',
    isActive: true,
    isDead: false,
    ...overrides,
  };
}

describe('Region search (#1153, real DB)', () => {
  let db: DbService;
  let search: RegionSearchService;
  let query: RegionQueryService;

  beforeAll(async () => {
    db = await getDbService();
    search = new RegionSearchService(db);
    query = new RegionQueryService(
      db,
      new RegionCacheService(memoryCache()),
      undefined,
      undefined,
      undefined,
      undefined,
      search,
    );
  });

  beforeEach(async () => {
    await cleanDatabase();

    await db.bill.createMany({
      data: [
        billFixture({
          externalId: '20252026AB1236',
          billNumber: 'AB 1236',
          measureTypeCode: 'AB',
          title: 'Residential property insurance: wildfire risk mitigation',
          subject: 'Wildfire insurance discounts',
          status: 'Active Bill - In Senate',
          lastAction: 'Read second time. Ordered to third reading.',
          lastActionDate: new Date('2026-08-28'),
        }),
        billFixture({
          externalId: '20252026SB505',
          billNumber: 'SB 505',
          measureTypeCode: 'SB',
          title: 'FAIR Plan sustainability fund',
          subject: null,
          status: 'Chaptered',
          isActive: false,
          // Only the AI summary mentions wildfire — weight C territory.
          aiSummary: {
            plainEnglishSummary:
              'Creates a reinsurance backstop for catastrophic wildfire losses.',
          },
          lastActionDate: new Date('2026-07-14'),
        }),
        billFixture({
          externalId: '20252026AB2044',
          billNumber: 'AB 2044',
          measureTypeCode: 'AB',
          title: 'Community college enrollment fees',
          status: 'Active Bill - In Assembly',
          lastActionDate: new Date('2026-08-19'),
        }),
      ],
    });

    await db.proposition.createMany({
      data: [
        {
          externalId: 'prop-12-2026',
          title: 'Wildfire Response Bond Act',
          summary: 'Authorizes bonds for wildfire prevention and response.',
          status: 'pending',
          electionDate: new Date('2026-11-03'),
        },
        {
          externalId: 'prop-old-deleted',
          title: 'Deleted wildfire measure',
          summary: 'A soft-deleted wildfire proposition.',
          status: 'withdrawn',
          deletedAt: new Date('2026-01-01'),
        },
      ],
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  // ── pure helpers ──────────────────────────────────────────────────────

  it('caps query length and normalizes measure-number queries', () => {
    expect(sanitizeSearchQuery(`  ${'x'.repeat(300)}  `)).toHaveLength(
      SEARCH_QUERY_MAX_LENGTH,
    );
    expect(normalizeMeasureNumberQuery('ab 12')).toBe('AB 12');
    expect(normalizeMeasureNumberQuery('AB-1236')).toBe('AB 1236');
    expect(normalizeMeasureNumberQuery('sb505')).toBe('SB 505');
    expect(normalizeMeasureNumberQuery('wildfire insurance')).toBeNull();
    expect(normalizeMeasureNumberQuery('12345678')).toBeNull();
  });

  // ── ranking ───────────────────────────────────────────────────────────

  it('ranks title+subject matches (weights A/B) above AI-summary-only matches (weight C)', async () => {
    const { ids, total } = await search.searchBillIds(
      'wildfire',
      { lifecycle: BillLifecycle.ALL },
      0,
      10,
    );
    expect(total).toBe(2);
    const bills = await db.bill.findMany({ where: { id: { in: ids } } });
    const ordered = ids.map((id) => bills.find((b) => b.id === id)?.billNumber);
    expect(ordered).toEqual(['AB 1236', 'SB 505']);
  });

  it('composes search with measure type and lifecycle filters', async () => {
    const abOnly = await search.searchBillIds(
      'wildfire',
      { measureTypeCode: 'AB', lifecycle: BillLifecycle.ALL },
      0,
      10,
    );
    expect(abOnly.total).toBe(1);

    // SB 505 is inactive; ACTIVE excludes it even though it matches.
    const activeOnly = await search.searchBillIds(
      'wildfire',
      { lifecycle: BillLifecycle.ACTIVE },
      0,
      10,
    );
    expect(activeOnly.total).toBe(1);
  });

  // ── empty / stopword queries ──────────────────────────────────────────

  it('returns empty (not a scan, not an error) for empty and stopword-only queries', async () => {
    await expect(search.searchBillIds('   ', {}, 0, 10)).resolves.toEqual({
      ids: [],
      total: 0,
    });
    await expect(
      search.searchBillIds('the of and', {}, 0, 10),
    ).resolves.toEqual({ ids: [], total: 0 });
  });

  // ── unified search ────────────────────────────────────────────────────

  it('merges bills and propositions with per-kind counts and excludes soft-deleted rows', async () => {
    const page = await search.searchUnified('wildfire', undefined, 0, 10);
    expect(page.billCount).toBe(2);
    // Two wildfire propositions exist; the soft-deleted one must not count.
    expect(page.propositionCount).toBe(1);
    expect(page.rows).toHaveLength(3);
    expect(page.rows.map((r) => r.kind).sort()).toEqual([
      'BILL',
      'BILL',
      'PROPOSITION',
    ]);
  });

  it('filters rows by type but keeps facet counts corpus-wide', async () => {
    const propsOnly = await search.searchUnified(
      'wildfire',
      SearchResultType.PROPOSITION,
      0,
      10,
    );
    // Rows and `matched` (what pagination is over) respect the filter…
    expect(propsOnly.rows.every((r) => r.kind === 'PROPOSITION')).toBe(true);
    expect(propsOnly.matched).toBe(1);
    // …but the facet counts must NOT, or the UI renders "Bills · 0" while
    // two bills match and the user can never switch back (#1154 review).
    expect(propsOnly.billCount).toBe(2);
    expect(propsOnly.propositionCount).toBe(1);

    const billsOnly = await search.searchUnified(
      'wildfire',
      SearchResultType.BILL,
      0,
      10,
    );
    expect(billsOnly.rows.every((r) => r.kind === 'BILL')).toBe(true);
    expect(billsOnly.matched).toBe(2);
    expect(billsOnly.billCount).toBe(2);
    expect(billsOnly.propositionCount).toBe(1);
  });

  it('searchRegion reports the FILTERED total while keeping corpus-wide facets', async () => {
    // The assertion that fails if `total` is ever computed as
    // billCount + propositionCount again: filtered to propositions there
    // is 1 result, but the facets must still advertise 2 bills. A
    // total of 3 here would render "Showing 1-1 of 3" with Next enabled
    // onto an empty page.
    const props = await query.searchRegion(
      'wildfire',
      SearchResultType.PROPOSITION,
      0,
      10,
    );
    expect(props.total).toBe(1);
    expect(props.items).toHaveLength(1);
    expect(props.hasMore).toBe(false);
    expect(props.billCount).toBe(2);
    expect(props.propositionCount).toBe(1);

    const bills = await query.searchRegion(
      'wildfire',
      SearchResultType.BILL,
      0,
      10,
    );
    expect(bills.total).toBe(2);
    expect(bills.items).toHaveLength(2);
    expect(bills.billCount).toBe(2);
    expect(bills.propositionCount).toBe(1);

    const all = await query.searchRegion('wildfire', undefined, 0, 10);
    expect(all.total).toBe(3);
    expect(all.hasMore).toBe(false);
  });

  it('produces plain-text snippets with the fixed markers and no HTML', async () => {
    const page = await search.searchUnified('wildfire', undefined, 0, 10);
    const withSnippet = page.rows.filter((r) => !!r.snippet);
    expect(withSnippet.length).toBeGreaterThan(0);
    for (const row of withSnippet) {
      expect(row.snippet).toContain(SNIPPET_START);
      expect(row.snippet).toContain(SNIPPET_END);
      expect(row.snippet).not.toMatch(/<\/?[a-z]+>/i);
    }
  });

  it('hydrates the unified page into full entities preserving rank order', async () => {
    const result = await query.searchRegion('wildfire', undefined, 0, 10);
    expect(result.total).toBe(3);
    expect(result.billCount).toBe(2);
    expect(result.propositionCount).toBe(1);
    expect(result.items).toHaveLength(3);
    // Ranks are non-increasing in page order.
    const ranks = result.items.map((i) => i.rank);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  // ── typeahead ─────────────────────────────────────────────────────────

  it('returns DIRECT jump rows first for measure-number queries', async () => {
    const rows = await search.suggest('ab 12', 8);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].kind).toBe(SearchSuggestionKind.DIRECT);
    expect(rows[0].sublabel).toContain('AB 1236');
  });

  it('returns ranked full-text suggestions for word queries', async () => {
    const rows = await search.suggest('wildfire', 8);
    expect(rows.some((r) => r.kind === SearchSuggestionKind.BILL)).toBe(true);
    expect(rows.some((r) => r.kind === SearchSuggestionKind.PROPOSITION)).toBe(
      true,
    );
    expect(rows.every((r) => r.kind !== SearchSuggestionKind.DIRECT)).toBe(
      true,
    );
  });

  // ── list-path regressions ─────────────────────────────────────────────

  it('getPropositions excludes soft-deleted rows and filters by status/electionYear', async () => {
    const all = await query.getPropositions(0, 10);
    expect(all.total).toBe(1); // deletedAt fix — was 2 before #1153
    expect(all.items[0].externalId).toBe('prop-12-2026');

    const y2026 = await query.getPropositions(
      0,
      10,
      undefined,
      undefined,
      2026,
    );
    expect(y2026.total).toBe(1);
    const y2024 = await query.getPropositions(
      0,
      10,
      undefined,
      undefined,
      2024,
    );
    expect(y2024.total).toBe(0);
  });

  it('proposition SEARCH path composes status + electionYear and excludes soft-deleted', async () => {
    // Both live and deleted propositions match "wildfire"; only the live,
    // pending, 2026 one may come back through the search branch.
    const hit = await query.getPropositions(
      0,
      10,
      'wildfire',
      PropositionStatusGQL.PENDING,
      2026,
    );
    expect(hit.total).toBe(1);
    expect(hit.items[0].externalId).toBe('prop-12-2026');

    const wrongStatus = await query.getPropositions(
      0,
      10,
      'wildfire',
      PropositionStatusGQL.PASSED,
      2026,
    );
    expect(wrongStatus.total).toBe(0);

    // The withdrawn match is soft-deleted: status alone must not revive it.
    const withdrawn = await query.getPropositions(
      0,
      10,
      'wildfire',
      PropositionStatusGQL.WITHDRAWN,
    );
    expect(withdrawn.total).toBe(0);

    const wrongYear = await query.getPropositions(
      0,
      10,
      'wildfire',
      undefined,
      2024,
    );
    expect(wrongYear.total).toBe(0);
  });

  it('bill search composes sessionYear and authorless filters, and pages with OFFSET', async () => {
    const bySession = await search.searchBillIds(
      'wildfire',
      { sessionYear: '2025-2026', lifecycle: BillLifecycle.ALL },
      0,
      10,
    );
    expect(bySession.total).toBe(2);
    const wrongSession = await search.searchBillIds(
      'wildfire',
      { sessionYear: '2023-2024', lifecycle: BillLifecycle.ALL },
      0,
      10,
    );
    expect(wrongSession.total).toBe(0);

    // OFFSET paging: page 2 of size 1 is the lower-ranked match, and the
    // two pages never overlap.
    const page1 = await search.searchBillIds(
      'wildfire',
      { lifecycle: BillLifecycle.ALL },
      0,
      1,
    );
    const page2 = await search.searchBillIds(
      'wildfire',
      { lifecycle: BillLifecycle.ALL },
      1,
      1,
    );
    expect(page1.ids).toHaveLength(1);
    expect(page2.ids).toHaveLength(1);
    expect(page1.ids[0]).not.toBe(page2.ids[0]);
  });

  it('undefined lifecycle defaults to ACTIVE on the bill search path', async () => {
    // SB 505 (inactive) matches "wildfire"; without an explicit lifecycle
    // the search must mirror the list default and exclude it.
    const result = await search.searchBillIds('wildfire', {}, 0, 10);
    expect(result.total).toBe(1);
  });

  it('caps deep paging at MAX_SEARCH_WINDOW with totals intact', async () => {
    const beyond = await search.searchBillIds(
      'wildfire',
      { lifecycle: BillLifecycle.ALL },
      MAX_SEARCH_WINDOW,
      10,
    );
    expect(beyond.ids).toEqual([]);
    expect(beyond.total).toBe(2);

    const unified = await search.searchUnified(
      'wildfire',
      undefined,
      MAX_SEARCH_WINDOW,
      10,
    );
    expect(unified.rows).toEqual([]);
    expect(unified.billCount).toBe(2);
    expect(unified.propositionCount).toBe(1);
  });

  it('reserves proposition slots in the typeahead when bills alone could fill it', async () => {
    // Flood the corpus with enough matching bills to consume the whole
    // suggestion budget — the regression this guards is propositions
    // becoming permanently invisible for any common term.
    await db.bill.createMany({
      data: Array.from({ length: 12 }, (_, i) =>
        billFixture({
          externalId: `20252026AB9${String(i).padStart(2, '0')}`,
          billNumber: `AB 9${String(i).padStart(2, '0')}`,
          measureTypeCode: 'AB',
          title: `Wildfire prevention measure ${i}`,
          lastActionDate: new Date('2026-06-01'),
        }),
      ),
    });

    const rows = await search.suggest('wildfire', 8);
    expect(rows).toHaveLength(8);
    expect(rows.some((r) => r.kind === SearchSuggestionKind.PROPOSITION)).toBe(
      true,
    );
  });

  it('getBills with search returns ranked, hydrated results with hasMore math', async () => {
    const result = await query.getBills(
      0,
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      BillLifecycle.ALL,
      'wildfire',
    );
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].billNumber).toBe('AB 1236');
    expect(result.hasMore).toBe(true);
  });
});
