import { Injectable } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import { BillLifecycle } from './models/bill.model';
import { PropositionStatusGQL } from './models/proposition.model';
import {
  SearchResultType,
  SearchSuggestionKind,
  SearchSuggestionModel,
  STATE_JURISDICTION,
} from './models/region-search.model';

/**
 * Lexical search over bills and propositions (#1153, spec
 * docs/plans/SPEC-bills-propositions-search.md).
 *
 * This service is the SQL ranking engine only: it returns ranked ids,
 * ranks, snippets and counts. Hydration into GraphQL models stays in
 * RegionQueryService, which owns the record mappers.
 *
 * All queries go through parameterized `$queryRaw` — user input never
 * reaches SQL as text. `websearch_to_tsquery` is used (never
 * `to_tsquery`) because it accepts arbitrary user syntax without
 * throwing. Errors are deliberately NOT caught here: a failed search
 * must surface as an error, not render as "no results" (the
 * knowledge-service swallow-to-empty mistake, gap analysis §4.5).
 *
 * Search results deliberately bypass RegionCacheService — its cache has
 * no TTL and purges by prefix, so an unbounded per-query keyspace would
 * never evict.
 */

/**
 * Hard cap on query length. The GraphQL edge REJECTS longer input
 * (dto/region-search.args.ts @MaxLength — that must run before the audit
 * interceptor captures args); this service-side truncation is
 * belt-and-suspenders for non-resolver callers.
 */
export const SEARCH_QUERY_MAX_LENGTH = 200;

/**
 * Deepest reachable result (skip + take). Rank ordering cannot be served
 * by a GIN index — every match is scored, then top-N sorted — so an
 * unbounded OFFSET would force a full re-sort to return nothing. Beyond
 * the window the page comes back empty (totals stay real); search engines
 * cap deep paging the same way.
 */
export const MAX_SEARCH_WINDOW = 1000;

/**
 * Fixed ts_headline markers. Plain text sentinels the frontend maps to
 * <mark> — HTML never passes through. U+27EA/U+27EB are chosen as
 * characters that do not occur in legislative text.
 */
export const SNIPPET_START = '⟪';
export const SNIPPET_END = '⟫';

const HEADLINE_OPTIONS = `StartSel=${SNIPPET_START},StopSel=${SNIPPET_END},MaxWords=35,MinWords=15`;

/** "ab 12", "AB-1236", "sb505" → a normalized bill_number prefix. */
const MEASURE_NUMBER_PATTERN = /^([a-z]{1,4})\s*-?\s*(\d{1,5})$/i;

export function sanitizeSearchQuery(raw: string): string {
  return raw.trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
}

/**
 * Detect a measure-number-shaped query and normalize it to the
 * "<PREFIX> <number>" form `bills.bill_number` uses. Returns null for
 * anything else. Prefixes are validated by the lookup itself (the
 * bill_number prefix match either finds rows or it doesn't) rather than
 * against a hardcoded list — region-config measure types stay the only
 * source of truth for what codes exist.
 */
export function normalizeMeasureNumberQuery(raw: string): string | null {
  const m = MEASURE_NUMBER_PATTERN.exec(raw.trim());
  if (!m) return null;
  return `${m[1].toUpperCase()} ${m[2]}`;
}

export interface BillSearchFilters {
  measureTypeCode?: string;
  sessionYear?: string;
  authorId?: string;
  committeeId?: string;
  coAuthorId?: string;
  lifecycle?: BillLifecycle;
}

export interface PropositionSearchFilters {
  status?: PropositionStatusGQL;
  electionYear?: number;
}

export interface RankedIdPage {
  ids: string[];
  total: number;
}

export interface UnifiedSearchRow {
  id: string;
  kind: 'BILL' | 'PROPOSITION';
  rank: number;
  snippet: string | null;
}

export interface UnifiedSearchPage {
  rows: UnifiedSearchRow[];
  /** Corpus-wide bill matches — unaffected by the type filter (facet label). */
  billCount: number;
  /** Corpus-wide proposition matches — unaffected by the type filter. */
  propositionCount: number;
  /** Matches after the type filter — what pagination is over. */
  matched: number;
}

@Injectable()
export class RegionSearchService {
  constructor(private readonly db: DbService) {}

  /** Fragment: the parsed query, reused across every leg. */
  private tsquery(query: string): Prisma.Sql {
    return Prisma.sql`websearch_to_tsquery('english', ${query})`;
  }

  /**
   * A stopword-only or empty query parses to zero tsquery nodes; a scan
   * with it would match nothing anyway, so short-circuit before touching
   * the corpus tables.
   */
  private async isEmptyQuery(query: string): Promise<boolean> {
    if (query.length === 0) return true;
    const rows = await this.db.$queryRaw<{ nodes: number }[]>`
      SELECT numnode(websearch_to_tsquery('english', ${query}))::int AS nodes
    `;
    return (rows[0]?.nodes ?? 0) === 0;
  }

  private billFilterConditions(filters: BillSearchFilters): Prisma.Sql[] {
    const conds: Prisma.Sql[] = [];
    if (filters.measureTypeCode) {
      conds.push(Prisma.sql`b.measure_type_code = ${filters.measureTypeCode}`);
    }
    if (filters.sessionYear) {
      conds.push(Prisma.sql`b.session_year = ${filters.sessionYear}`);
    }
    if (filters.authorId) {
      conds.push(Prisma.sql`b.author_id = ${filters.authorId}`);
    }
    if (filters.committeeId) {
      conds.push(Prisma.sql`EXISTS (
        SELECT 1 FROM bill_committee_assignments bca
        WHERE bca.bill_id = b.id
          AND bca.legislative_committee_id = ${filters.committeeId}
      )`);
    }
    if (filters.coAuthorId) {
      conds.push(Prisma.sql`EXISTS (
        SELECT 1 FROM bill_co_authors bco
        WHERE bco.bill_id = b.id
          AND bco.representative_id = ${filters.coAuthorId}
      )`);
    }
    // Undefined defaults to ACTIVE, mirroring the non-search list path
    // (lifecycleClause + the resolver default) — a future direct caller
    // must opt in to ALL explicitly, never fall into it.
    const lifecycle = filters.lifecycle ?? BillLifecycle.ACTIVE;
    if (lifecycle === BillLifecycle.ACTIVE) {
      conds.push(Prisma.sql`b.is_active = TRUE`);
    } else if (lifecycle === BillLifecycle.INACTIVE) {
      conds.push(Prisma.sql`b.is_active = FALSE`);
    }
    return conds;
  }

  /**
   * Clamp a page to MAX_SEARCH_WINDOW. Returns null when skip is already
   * past the window (callers return an empty page with real totals).
   */
  private clampToWindow(
    skip: number,
    take: number,
  ): { skip: number; take: number } | null {
    if (skip >= MAX_SEARCH_WINDOW) return null;
    return { skip, take: Math.min(take, MAX_SEARCH_WINDOW - skip) };
  }

  /**
   * Rank-ordered page of bill ids for the bills-list search path.
   * RegionQueryService hydrates the ids with its usual includes so the
   * list keeps its exact card shape.
   */
  async searchBillIds(
    rawQuery: string,
    filters: BillSearchFilters,
    skip: number,
    take: number,
  ): Promise<RankedIdPage> {
    const query = sanitizeSearchQuery(rawQuery);
    if (await this.isEmptyQuery(query)) return { ids: [], total: 0 };

    const where = Prisma.join(
      [
        Prisma.sql`b.search_vector @@ ${this.tsquery(query)}`,
        ...this.billFilterConditions(filters),
      ],
      ' AND ',
    );

    const window = this.clampToWindow(skip, take);
    const [idRows, countRows] = await Promise.all([
      window
        ? this.db.$queryRaw<{ id: string }[]>`
            SELECT b.id
            FROM bills b
            WHERE ${where}
            ORDER BY ts_rank_cd(b.search_vector, ${this.tsquery(query)}) DESC,
                     b.last_action_date DESC NULLS LAST,
                     b.bill_number ASC
            LIMIT ${window.take} OFFSET ${window.skip}
          `
        : Promise.resolve([]),
      this.db.$queryRaw<{ total: bigint }[]>`
        SELECT count(*)::bigint AS total FROM bills b WHERE ${where}
      `,
    ]);

    return {
      ids: idRows.map((r) => r.id),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  /**
   * Rank-ordered page of proposition ids for the propositions-list search
   * path. Soft-deleted rows are always excluded.
   */
  async searchPropositionIds(
    rawQuery: string,
    filters: PropositionSearchFilters,
    skip: number,
    take: number,
  ): Promise<RankedIdPage> {
    const query = sanitizeSearchQuery(rawQuery);
    if (await this.isEmptyQuery(query)) return { ids: [], total: 0 };

    const conds: Prisma.Sql[] = [
      Prisma.sql`p.search_vector @@ ${this.tsquery(query)}`,
      Prisma.sql`p.deleted_at IS NULL`,
    ];
    if (filters.status) {
      conds.push(Prisma.sql`p.status = ${filters.status}`);
    }
    if (filters.electionYear) {
      conds.push(Prisma.sql`p.election_date >= make_date(${filters.electionYear}::int, 1, 1)
        AND p.election_date < make_date(${filters.electionYear}::int + 1, 1, 1)`);
    }
    const where = Prisma.join(conds, ' AND ');

    const window = this.clampToWindow(skip, take);
    const [idRows, countRows] = await Promise.all([
      window
        ? this.db.$queryRaw<{ id: string }[]>`
            SELECT p.id
            FROM propositions p
            WHERE ${where}
            ORDER BY ts_rank_cd(p.search_vector, ${this.tsquery(query)}) DESC,
                     p.election_date DESC NULLS LAST,
                     p.id ASC
            LIMIT ${window.take} OFFSET ${window.skip}
          `
        : Promise.resolve([]),
      this.db.$queryRaw<{ total: bigint }[]>`
        SELECT count(*)::bigint AS total FROM propositions p WHERE ${where}
      `,
    ]);

    return {
      ids: idRows.map((r) => r.id),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  /**
   * Unified rank-merged page across bills + propositions, with per-kind
   * counts for the facet labels and a ts_headline snippet computed only
   * for the returned page.
   */
  async searchUnified(
    rawQuery: string,
    type: SearchResultType | undefined,
    skip: number,
    take: number,
  ): Promise<UnifiedSearchPage> {
    const query = sanitizeSearchQuery(rawQuery);
    if (await this.isEmptyQuery(query)) {
      return { rows: [], billCount: 0, propositionCount: 0, matched: 0 };
    }

    const includeBills = type !== SearchResultType.PROPOSITION;
    const includeProps = type !== SearchResultType.BILL;

    // Facet counts are ALWAYS unfiltered: they exist so the UI can label
    // the type chips ("Bills · 40") and let the user switch to a facet
    // they can't currently see. Counting only the included arm made
    // "Bills · 0" render while 40 bills matched (#1154 review).
    const { billCount, propositionCount } = await this.unifiedCounts(query);
    const matched =
      (includeBills ? billCount : 0) + (includeProps ? propositionCount : 0);
    const window = this.clampToWindow(skip, take);
    if (matched === 0 || !window) {
      return { rows: [], billCount, propositionCount, matched };
    }

    const rows = await this.unifiedPage(
      query,
      includeBills,
      includeProps,
      window.skip,
      window.take,
    );
    return { rows, billCount, propositionCount, matched };
  }

  /** Both facet counts in one round trip, always across the full corpus. */
  private async unifiedCounts(
    query: string,
  ): Promise<{ billCount: number; propositionCount: number }> {
    const rows = await this.db.$queryRaw<
      { bill_count: bigint; proposition_count: bigint }[]
    >`
      SELECT
        (SELECT count(*) FROM bills b
          WHERE b.search_vector @@ ${this.tsquery(query)})::bigint AS bill_count,
        (SELECT count(*) FROM propositions p
          WHERE p.search_vector @@ ${this.tsquery(query)}
            AND p.deleted_at IS NULL)::bigint AS proposition_count
    `;
    return {
      billCount: Number(rows[0]?.bill_count ?? 0),
      propositionCount: Number(rows[0]?.proposition_count ?? 0),
    };
  }

  private async unifiedPage(
    query: string,
    includeBills: boolean,
    includeProps: boolean,
    skip: number,
    take: number,
  ): Promise<UnifiedSearchRow[]> {
    // `WHERE FALSE` arms keep the UNION shape stable while a type filter
    // is active — the planner prunes them; only the SQL stays simple.
    const billArm = includeBills
      ? Prisma.sql`
          (SELECT b.id, 'BILL' AS kind,
                 ts_rank_cd(b.search_vector, ${this.tsquery(query)}) AS rank,
                 COALESCE(b.last_action_date, b.updated_at::date) AS sort_date
          FROM bills b
          WHERE b.search_vector @@ ${this.tsquery(query)}
          ORDER BY rank DESC LIMIT ${MAX_SEARCH_WINDOW})`
      : Prisma.sql`(SELECT NULL::text AS id, 'BILL' AS kind, 0::float4 AS rank, NULL::date AS sort_date WHERE FALSE)`;

    const propArm = includeProps
      ? Prisma.sql`
          (SELECT p.id, 'PROPOSITION' AS kind,
                 ts_rank_cd(p.search_vector, ${this.tsquery(query)}) AS rank,
                 p.election_date::date AS sort_date
          FROM propositions p
          WHERE p.search_vector @@ ${this.tsquery(query)}
            AND p.deleted_at IS NULL
          ORDER BY rank DESC LIMIT ${MAX_SEARCH_WINDOW})`
      : Prisma.sql`(SELECT NULL::text AS id, 'PROPOSITION' AS kind, 0::float4 AS rank, NULL::date AS sort_date WHERE FALSE)`;

    // Per-arm ORDER BY rank LIMIT lets Postgres top-N heapsort each leg
    // instead of materializing a full sort of every match; combined with
    // clampToWindow this bounds the merge at 2×MAX_SEARCH_WINDOW rows.
    //
    // Snippet source: the searchable text minus the title (the title
    // renders highlighted separately on the card). Bills = subject + AI
    // plain-English summary + last action — the indexed B/C/D weights.
    // Propositions = summary + the first 20 kB of full text; the vector
    // indexes 256 KiB of full text, so a match deeper than the headline
    // window yields an unhighlighted leading fragment (accepted cost —
    // headlining 256 KiB per row is not). ts_headline runs on the
    // LIMITed page only, never the full match set.
    return this.db.$queryRaw<UnifiedSearchRow[]>`
      WITH matches AS (${billArm} UNION ALL ${propArm}),
      page AS (
        SELECT id, kind, rank, sort_date
        FROM matches
        ORDER BY rank DESC, sort_date DESC NULLS LAST, id ASC
        LIMIT ${take} OFFSET ${skip}
      )
      SELECT page.id, page.kind, page.rank::float8 AS rank,
        CASE WHEN page.kind = 'BILL' THEN ts_headline(
          'english',
          concat_ws(' ', b.subject, b.ai_summary->>'plainEnglishSummary', b.last_action),
          ${this.tsquery(query)}, ${HEADLINE_OPTIONS}
        ) ELSE ts_headline(
          'english',
          concat_ws(' ', p.summary, left(coalesce(p.full_text, ''), 20000)),
          ${this.tsquery(query)}, ${HEADLINE_OPTIONS}
        ) END AS snippet
      FROM page
      LEFT JOIN bills b ON page.kind = 'BILL' AND b.id = page.id
      LEFT JOIN propositions p ON page.kind = 'PROPOSITION' AND p.id = page.id
      ORDER BY page.rank DESC, page.sort_date DESC NULLS LAST, page.id ASC
    `;
  }

  /**
   * Typeahead. A measure-number-shaped query returns DIRECT jump rows
   * first (bill_number prefix match over the trigram index); full-text
   * bill and proposition rows fill the remainder. No snippets — the
   * dropdown renders labels only.
   */
  async suggest(
    rawQuery: string,
    take: number,
  ): Promise<SearchSuggestionModel[]> {
    const query = sanitizeSearchQuery(rawQuery);
    if (query.length === 0) return [];

    const direct = await this.directMatches(query, take);
    const remaining = Math.max(take - direct.length, 0);
    // Single numnode probe for both FTS legs (typeahead fires per
    // keystroke; the legs must not each re-pay it).
    if (remaining === 0 || (await this.isEmptyQuery(query))) {
      return direct.slice(0, take);
    }

    // Reserve slots for propositions or the (much larger) bill corpus
    // crowds them out of every typeahead: bills fill remaining minus
    // whatever propositions actually return, never the whole budget.
    const propSlots = Math.min(2, Math.max(remaining - 1, 0));
    const [bills, props] = await Promise.all([
      this.suggestBills(query, direct, remaining),
      propSlots > 0
        ? this.suggestPropositions(query, propSlots)
        : Promise.resolve([]),
    ]);
    const billTake = remaining - props.length;
    return [...direct, ...bills.slice(0, billTake), ...props];
  }

  private async directMatches(
    query: string,
    take: number,
  ): Promise<SearchSuggestionModel[]> {
    const normalized = normalizeMeasureNumberQuery(query);
    if (!normalized) return [];
    const prefix = `${normalized}%`;
    const limit = Math.min(3, take);
    const rows = await this.db.$queryRaw<
      { id: string; bill_number: string; session_year: string; title: string }[]
    >`
      SELECT id, bill_number, session_year, title
      FROM bills
      WHERE bill_number ILIKE ${prefix}
      ORDER BY session_year DESC, bill_number ASC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      kind: SearchSuggestionKind.DIRECT,
      label: r.title,
      sublabel: `${r.bill_number} · ${r.session_year}`,
      jurisdiction: STATE_JURISDICTION,
    }));
  }

  private async suggestBills(
    query: string,
    exclude: SearchSuggestionModel[],
    limit: number,
  ): Promise<SearchSuggestionModel[]> {
    const excludeIdFragments = exclude.map((s) => Prisma.sql`${s.id}::text`);
    const excludeCond =
      excludeIdFragments.length > 0
        ? Prisma.sql`AND b.id NOT IN (${Prisma.join(excludeIdFragments)})`
        : Prisma.empty;
    const rows = await this.db.$queryRaw<
      { id: string; bill_number: string; session_year: string; title: string }[]
    >`
      SELECT b.id, b.bill_number, b.session_year, b.title
      FROM bills b
      WHERE b.search_vector @@ ${this.tsquery(query)} ${excludeCond}
      ORDER BY ts_rank_cd(b.search_vector, ${this.tsquery(query)}) DESC,
               b.last_action_date DESC NULLS LAST
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      kind: SearchSuggestionKind.BILL,
      label: r.title,
      sublabel: `${r.bill_number} · ${r.session_year}`,
      jurisdiction: STATE_JURISDICTION,
    }));
  }

  private async suggestPropositions(
    query: string,
    limit: number,
  ): Promise<SearchSuggestionModel[]> {
    const rows = await this.db.$queryRaw<
      { id: string; external_id: string; title: string }[]
    >`
      SELECT p.id, p.external_id, p.title
      FROM propositions p
      WHERE p.search_vector @@ ${this.tsquery(query)}
        AND p.deleted_at IS NULL
      ORDER BY ts_rank_cd(p.search_vector, ${this.tsquery(query)}) DESC,
               p.election_date DESC NULLS LAST
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      kind: SearchSuggestionKind.PROPOSITION,
      label: r.title,
      sublabel: r.external_id,
      jurisdiction: STATE_JURISDICTION,
    }));
  }
}
