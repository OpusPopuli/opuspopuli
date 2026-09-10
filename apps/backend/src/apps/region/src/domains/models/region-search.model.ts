import {
  createUnionType,
  Field,
  Float,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { BillModel } from './bill.model';
import { PropositionModel } from './proposition.model';
import { JurisdictionLevelGQL } from './jurisdiction.model';

/**
 * Unified search over the civic corpus (#1153, spec
 * docs/plans/SPEC-bills-propositions-search.md).
 *
 * The union carries full region entities — no `@key`/`@ResolveReference`
 * federation work needed (the `legislativeCommittees(nameFilter:)` shape).
 * Per-result metadata (snippet, rank) lives on a wrapper type because GraphQL
 * unions cannot carry fields of their own.
 */

/** Optional type filter for `regionSearch`. */
export enum SearchResultType {
  BILL = 'BILL',
  PROPOSITION = 'PROPOSITION',
}

registerEnumType(SearchResultType, {
  name: 'SearchResultType',
  description: 'Restrict unified search to one entity type',
});

export const RegionSearchEntity = createUnionType({
  name: 'RegionSearchEntity',
  description: 'A bill or proposition returned by unified search',
  types: () => [BillModel, PropositionModel] as const,
  resolveType(value: BillModel | PropositionModel) {
    return 'billNumber' in value ? BillModel : PropositionModel;
  },
});

/**
 * Which jurisdiction a result belongs to (#1180).
 *
 * Constant today — every bill and proposition in the corpus is state-level
 * California — and derived in the resolver rather than stored, so this
 * needs no column and no migration.
 *
 * It exists now because of what happens when county minutes are indexed:
 * jurisdiction has to be recorded **at ingest**, on the row. Inferring a
 * county from document text at query time is the kind of guess this
 * platform does not make. Shipping the field now gives that ingest work an
 * obvious slot to fill; adding it later means re-versioning a query the
 * frontend already consumes.
 */
@ObjectType('ResultJurisdiction')
export class ResultJurisdictionModel {
  @Field(() => JurisdictionLevelGQL)
  level!: JurisdictionLevelGQL;

  /** Display name, e.g. "California" or "Sonoma County". */
  @Field()
  name!: string;

  /** Region plugin id where one applies, e.g. "california-sonoma". */
  @Field(() => ID, { nullable: true })
  id?: string | null;
}

/**
 * A per-corpus match count. Replaces the two-type-shaped
 * `billCount`/`propositionCount`, which cannot survive a third corpus.
 * Both are kept until the frontend migrates.
 */
@ObjectType('SearchTypeCount')
export class SearchTypeCountModel {
  @Field(() => SearchResultType)
  type!: SearchResultType;

  @Field(() => Int)
  count!: number;
}

/**
 * Every bill and proposition in the corpus is a California statewide
 * record, so jurisdiction is a constant rather than a column (#1180).
 *
 * Deliberately one shared object, not a per-row lookup: the moment county
 * minutes are indexed, jurisdiction must come from the INDEXED ROW,
 * stamped at ingest. When that lands this constant should disappear
 * rather than grow a branch — inferring a county at query time is the
 * guess this field exists to prevent.
 */
export const STATE_JURISDICTION: ResultJurisdictionModel = {
  level: JurisdictionLevelGQL.STATE,
  name: 'California',
  id: 'california',
};

@ObjectType('RegionSearchItem')
export class RegionSearchItemModel {
  @Field(() => RegionSearchEntity)
  result!: BillModel | PropositionModel;

  /**
   * `ts_headline` output with the match wrapped in the fixed markers
   * `⟪`/`⟫` (SNIPPET_START/SNIPPET_END in region-search.service.ts).
   *
   * CONTRACT FOR RENDERERS: this is a slice of scraped SOURCE TEXT and
   * may itself contain HTML fragments. The markers make highlighting
   * possible without HTML, not the string safe for innerHTML — split on
   * the markers and render the segments as text nodes (React children),
   * never build an HTML string from this field.
   */
  @Field({ nullable: true })
  snippet?: string;

  @Field(() => Float)
  rank!: number;

  /** Which jurisdiction this result belongs to (#1180). */
  @Field(() => ResultJurisdictionModel)
  jurisdiction!: ResultJurisdictionModel;
}

@ObjectType('PaginatedRegionSearch')
export class PaginatedRegionSearchModel {
  @Field(() => [RegionSearchItemModel])
  items!: RegionSearchItemModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;

  /** Count of bill matches across the whole result set (facet label). */
  @Field(() => Int)
  billCount!: number;

  /** Count of proposition matches across the whole result set. */
  @Field(() => Int)
  propositionCount!: number;

  /**
   * The corpora this query actually searched (#1180).
   *
   * Distinguishes "we searched there and found nothing" from "we never
   * looked" — states an empty result set otherwise conflates, and which
   * only diverge once a corpus exists that a given query does not cover.
   * A surface that cannot say what it covered should not imply it covered
   * everything; the same instinct as `county_thresholds.source_url` being
   * NOT NULL.
   */
  @Field(() => [SearchResultType])
  searchedTypes!: SearchResultType[];

  /**
   * Generic per-corpus counts. Prefer this over billCount/propositionCount,
   * which are deprecated in spirit and will be removed once the frontend
   * has migrated.
   */
  @Field(() => [SearchTypeCountModel])
  counts!: SearchTypeCountModel[];
}

/**
 * Typeahead row kinds. DIRECT = the query looks like a measure number
 * ("ab 12") and matched `bill_number` by prefix — rendered as a
 * "jump to bill" row above the full-text sections.
 */
export enum SearchSuggestionKind {
  DIRECT = 'DIRECT',
  BILL = 'BILL',
  PROPOSITION = 'PROPOSITION',
}

registerEnumType(SearchSuggestionKind, {
  name: 'SearchSuggestionKind',
  description: 'Typeahead suggestion row kind',
});

@ObjectType('SearchSuggestion')
export class SearchSuggestionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => SearchSuggestionKind)
  kind!: SearchSuggestionKind;

  /** Primary row text — the entity title. */
  @Field()
  label!: string;

  /** Secondary text — e.g. "AB 1236 · 2025-2026" or "Proposition 12". */
  @Field({ nullable: true })
  sublabel?: string;

  /**
   * Which jurisdiction this suggestion belongs to (#1180). Typeahead needs
   * it for the same reason results do: once county records are indexed, a
   * row reading "Measure H" is ambiguous without its county.
   */
  @Field(() => ResultJurisdictionModel)
  jurisdiction!: ResultJurisdictionModel;
}
