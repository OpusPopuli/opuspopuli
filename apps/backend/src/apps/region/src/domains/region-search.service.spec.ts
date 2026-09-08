import {
  RegionSearchService,
  SEARCH_QUERY_MAX_LENGTH,
  SNIPPET_END,
  SNIPPET_START,
  normalizeMeasureNumberQuery,
  sanitizeSearchQuery,
} from './region-search.service';
import { SearchSuggestionKind } from './models/region-search.model';
import type { DbService } from '@opuspopuli/relationaldb-provider';

/**
 * Pure-logic and short-circuit tests. The SQL itself (ranking, weights,
 * snippets, filters) is exercised against a real postgres_test in
 * __tests__/integration/region/region-search.integration.spec.ts — a
 * mocked $queryRaw cannot prove any of that.
 */
describe('RegionSearchService', () => {
  describe('sanitizeSearchQuery', () => {
    it('trims and caps at the max length', () => {
      expect(sanitizeSearchQuery('  hi  ')).toBe('hi');
      expect(sanitizeSearchQuery('x'.repeat(500))).toHaveLength(
        SEARCH_QUERY_MAX_LENGTH,
      );
    });
  });

  describe('normalizeMeasureNumberQuery', () => {
    it.each([
      ['ab 12', 'AB 12'],
      ['AB-1236', 'AB 1236'],
      ['sb505', 'SB 505'],
      ['aca 10', 'ACA 10'],
    ])('normalizes %s to %s', (input, expected) => {
      expect(normalizeMeasureNumberQuery(input)).toBe(expected);
    });

    it.each([['wildfire insurance'], ['12345678'], ['abcde 12'], ['']])(
      'rejects non-measure query %s',
      (input) => {
        expect(normalizeMeasureNumberQuery(input)).toBeNull();
      },
    );
  });

  describe('snippet markers', () => {
    it('uses characters that never occur in legislative text', () => {
      expect(SNIPPET_START).toBe('⟪');
      expect(SNIPPET_END).toBe('⟫');
    });
  });

  describe('short-circuits', () => {
    function serviceWithNodes(nodes: number) {
      const queryRaw = jest.fn().mockResolvedValue([{ nodes }]);
      const db = { $queryRaw: queryRaw } as unknown as DbService;
      return { svc: new RegionSearchService(db), queryRaw };
    }

    it('whitespace-only queries never reach the database', async () => {
      const { svc, queryRaw } = serviceWithNodes(0);
      await expect(svc.searchBillIds('   ', {}, 0, 10)).resolves.toEqual({
        ids: [],
        total: 0,
      });
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('stopword-only queries stop after the numnode probe', async () => {
      const { svc, queryRaw } = serviceWithNodes(0);
      await expect(
        svc.searchUnified('the of and', undefined, 0, 10),
      ).resolves.toEqual({
        rows: [],
        billCount: 0,
        propositionCount: 0,
        matched: 0,
      });
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it('suggest returns [] for empty input without touching the database', async () => {
      const { svc, queryRaw } = serviceWithNodes(0);
      await expect(svc.suggest('  ', 8)).resolves.toEqual([]);
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('suggest skips FTS legs when direct matches fill the take', async () => {
      const directRows = [1, 2, 3].map((n) => ({
        id: `id-${n}`,
        bill_number: `AB 123${n}`,
        session_year: '2025-2026',
        title: `Bill ${n}`,
      }));
      const queryRaw = jest.fn().mockResolvedValue(directRows);
      const db = { $queryRaw: queryRaw } as unknown as DbService;
      const svc = new RegionSearchService(db);

      const rows = await svc.suggest('ab 123', 3);

      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.kind === SearchSuggestionKind.DIRECT)).toBe(
        true,
      );
      // One query: the bill_number prefix lookup. No numnode probe, no FTS.
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});
