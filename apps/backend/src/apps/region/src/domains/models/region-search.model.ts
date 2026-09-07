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
}
