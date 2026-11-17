import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';

/**
 * How a piece of generated-looking text came to be (#1450).
 *
 * Decided from what the row records, never from which page shows it: the
 * same surface can hold model output, hand-written text or text taken
 * verbatim from an official source, and the receipt must not say "AI" for
 * the last two.
 */
export enum AiProvenanceKind {
  /** Written by a language model. Its prompt and model may still be unrecorded. */
  AI = 'ai',
  /** Rendered from the data by code, with no model call. */
  DETERMINISTIC = 'deterministic',
  /** Written by a person. */
  MANUAL = 'manual',
  /** Taken from the official source as published. */
  SCRAPED = 'scraped',
  /**
   * The row records an origin outside the known values, or none, and holds
   * no prompt hash as evidence of a model. Said plainly rather than guessed.
   */
  UNKNOWN = 'unknown',
}

registerEnumType(AiProvenanceKind, {
  name: 'AiProvenanceKind',
  description: 'How a piece of text was produced',
});

/**
 * The receipt for one AI-written output: what read what, with which
 * instructions, when (#1450).
 *
 * Every field but `kind` is nullable on purpose. Rows written before
 * provenance was recorded exist, and a receipt that hid a missing field would
 * defeat its purpose — the reader is shown "not recorded" instead.
 *
 * `promptHash` is the sha256 of the bare template; it resolves to the exact
 * published text in prompt-service's `attestation/` record. It, not
 * `promptVersion`, is the exact identifier: history holds versions edited
 * without a bump.
 */
@ObjectType()
export class AiProvenanceModel {
  @Field(() => AiProvenanceKind)
  kind!: AiProvenanceKind;

  @Field({ nullable: true, description: 'sha256 of the prompt template' })
  promptHash?: string;

  @Field({ nullable: true })
  promptVersion?: string;

  @Field({ nullable: true, description: 'Model name, e.g. as served' })
  llmModel?: string;

  @Field({ nullable: true, description: 'Exact model build (digest)' })
  llmDigest?: string;

  @Field({ nullable: true })
  generatedAt?: Date;

  @Field({
    nullable: true,
    description:
      'The document the output was made from. Absent when it was made from our own records, or when which fetch it read cannot be shown.',
  })
  sourceUrl?: string;

  @Field({
    nullable: true,
    description:
      "The exact source version read, where it has no URL. Today only bills use it: the legislature's bill_version_id in its public data export (pubinfo).",
  })
  sourceRef?: string;

  @Field({
    nullable: true,
    description:
      "When the source was fetched — set only when this output can be shown to have read that fetch's text. If later fetches left the text unchanged, the latest of them.",
  })
  sourceFetchedAt?: Date;

  @Field({
    nullable: true,
    description: "The publisher's date for that document, where it gives one",
  })
  sourcePublishedAt?: Date;
}
