import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * An AI-segmented section of a proposition's full text — a ToC anchor
 * with character-offset bounds. Used by the Deep Dive layer to render
 * collapsible sections with a sticky table of contents.
 */
@ObjectType()
export class PropositionAnalysisSectionModel {
  @Field()
  heading!: string;

  @Field(() => Int)
  startOffset!: number;

  @Field(() => Int)
  endOffset!: number;
}

/**
 * An AI-derived claim with a citation back into the proposition text.
 * Rendered as an inline footnote next to Layer 2 analysis content;
 * clicking scrolls to the attributed range in Layer 4 and highlights it.
 */
@ObjectType()
export class PropositionAnalysisClaimModel {
  @Field()
  claim!: string;

  /** Which analysis field the claim backs (e.g., 'keyProvisions', 'fiscalImpact'). */
  @Field()
  field!: string;

  @Field(() => Int)
  sourceStart!: number;

  @Field(() => Int)
  sourceEnd!: number;

  /**
   * The passage the model quoted verbatim (#1212). `sourceStart`/`sourceEnd`
   * are DERIVED from this by locating it in the source, so the reader can be
   * shown what was cited rather than a pair of character offsets.
   *
   * Nullable: rows generated under the older offsets contract have no quote.
   */
  @Field({ nullable: true })
  sourceQuote?: string;

  /**
   * Whether the citation was verified by locating the quote in the source.
   *
   * Only ever true. A claim that could not be verified is not emitted as a
   * citation at all — the service fails closed rather than rendering an
   * unverifiable span, which is the defect #1212 removes.
   */
  @Field({ nullable: true })
  verified?: boolean;

  /** LLM's self-reported confidence: 'high' | 'medium' | 'low'. */
  @Field({ nullable: true })
  confidence?: string;
}

/**
 * Current-law vs. proposed-change comparison for Layer 2.
 */
@ObjectType()
export class ExistingVsProposedModel {
  @Field()
  current!: string;

  @Field()
  proposed!: string;
}
