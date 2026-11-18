import {
  AiProvenanceKind,
  type AiProvenanceModel,
} from './models/ai-provenance.model';

/**
 * Build the reader-facing receipt for one generated output (#1450).
 *
 * Every AI output stores the same five columns under its own prefix —
 * `analysisPromptHash`, `bioLlmModel`, `summaryGeneratedAt` … — so one
 * table-driven reader serves all of them instead of seven hand-written copies.
 */

/** The column prefixes that carry an output's provenance. */
export type ProvenancePrefix =
  | 'analysis'
  | 'aiSummary'
  | 'bio'
  | 'committeesSummary'
  | 'activitySummary'
  | 'description'
  | 'summary';

/**
 * How the surface's own data says the text was produced, for surfaces that
 * record it (`analysisSource`, `bioSource`). `unrecognised` is a value
 * outside the allowlist, or none at all: the receipt then claims a model only
 * if the row holds a prompt hash as evidence, and otherwise says UNKNOWN.
 * Surfaces with no such column have one kind of writer and pass nothing.
 */
export type DeclaredOrigin = 'ai' | 'manual' | 'scraped' | 'unrecognised';

/**
 * Map a recorded origin value through an allowlist, so a legacy, seeded or
 * future value is never read as "AI" by default.
 */
export function declaredOrigin(
  value: string | null | undefined,
  allowed: Readonly<Record<string, Exclude<DeclaredOrigin, 'unrecognised'>>>,
): DeclaredOrigin {
  return (value && allowed[value]) || 'unrecognised';
}

/**
 * What the output was made from. Each field is set only when it can be shown
 * true of THIS output — a later fetch of the same page is not the document
 * an older summary read.
 */
export interface SourceRef {
  sourceUrl?: string | null;
  /** An identifier for the exact source version, where it has no URL. */
  sourceRef?: string | null;
  sourceFetchedAt?: Date | null;
  sourcePublishedAt?: Date | null;
}

export interface ProvenanceOptions extends SourceRef {
  declared?: DeclaredOrigin | null;
  /**
   * The surface has a code path that writes text with no model call, marked
   * by a source hash with no prompt hash — the same rule its generator uses
   * to tell the two apart (`committee-summary-generator.service.ts`).
   */
  canBeDeterministic?: boolean;
}

type Row = Record<string, unknown>;

/**
 * The fields of an archived `SourceVersion` a receipt names. Never select the
 * whole row: it holds the source document's bytes (`content`).
 */
export const SOURCE_VERSION_REF_SELECT = {
  sourceUrl: true,
  fetchedAt: true,
} as const;

export interface SourceVersionRef {
  sourceUrl: string;
  fetchedAt: Date;
}

function column<T>(row: Row, prefix: ProvenancePrefix, name: string): T | null {
  const value = row[`${prefix}${name}`];
  return value === undefined ? null : (value as T | null);
}

function kindOf(
  row: Row,
  prefix: ProvenancePrefix,
  options: ProvenanceOptions,
): AiProvenanceKind {
  if (options.declared === 'manual') return AiProvenanceKind.MANUAL;
  if (options.declared === 'scraped') return AiProvenanceKind.SCRAPED;
  const noPrompt = column<string>(row, prefix, 'PromptHash') === null;
  if (options.declared === 'unrecognised' && noPrompt) {
    return AiProvenanceKind.UNKNOWN;
  }
  const sourced = column<string>(row, prefix, 'SourceHash') !== null;
  if (options.canBeDeterministic && noPrompt && sourced) {
    return AiProvenanceKind.DETERMINISTIC;
  }
  return AiProvenanceKind.AI;
}

function source(
  options: SourceRef,
): Pick<
  AiProvenanceModel,
  'sourceUrl' | 'sourceRef' | 'sourceFetchedAt' | 'sourcePublishedAt'
> {
  return {
    sourceUrl: options.sourceUrl ?? undefined,
    sourceRef: options.sourceRef ?? undefined,
    sourceFetchedAt: options.sourceFetchedAt ?? undefined,
    sourcePublishedAt: options.sourcePublishedAt ?? undefined,
  };
}

/** A representative row as `findUnique` returns it, plus its archived source. */
export interface RepresentativeProvenanceRow {
  bio?: string | null;
  bioSource?: string | null;
  committeesSummary?: string | null;
  activitySummary?: string | null;
  sourceVersion?: SourceVersionRef | null;
  [column: string]: unknown;
}

const BIO_ORIGINS = { 'ai-generated': 'ai', scraped: 'scraped' } as const;

/**
 * The three receipts on a representative's page.
 *
 * Only a SCRAPED bio names a source: it is the member's official page, word
 * for word. A generated bio is written from our record of the member
 * (`bio-generator.service.ts` `formatRepData`), not from a document, so it
 * names none — a receipt lists only what the model read. Neither names a
 * fetch date: the sync re-points `sourceVersion` at every fetch, whether or
 * not the bio was rewritten from it. The two summaries are written from our
 * own records (committee assignments, legislative actions).
 */
export function representativeProvenance(rep: RepresentativeProvenanceRow): {
  bioProvenance?: AiProvenanceModel;
  committeesSummaryProvenance?: AiProvenanceModel;
  activitySummaryProvenance?: AiProvenanceModel;
} {
  return {
    bioProvenance: buildAiProvenance(rep, 'bio', rep.bio, {
      declared: declaredOrigin(rep.bioSource, BIO_ORIGINS),
      sourceUrl:
        rep.bioSource === 'scraped' ? rep.sourceVersion?.sourceUrl : undefined,
    }),
    committeesSummaryProvenance: buildAiProvenance(
      rep,
      'committeesSummary',
      rep.committeesSummary,
      { canBeDeterministic: true },
    ),
    activitySummaryProvenance: buildAiProvenance(
      rep,
      'activitySummary',
      rep.activitySummary,
    ),
  };
}

/**
 * The receipt for the output stored under `prefix` on `row`, or `undefined`
 * when `output` — the text itself — is null or absent: a receipt for nothing
 * would be a claim about nothing. Taking the value, not a boolean, means a
 * caller cannot get "is there output" wrong by testing only `!== null` on a
 * field that was never loaded.
 *
 * For text that is not model output, the prompt and model fields are left
 * empty even if columns hold values: a bio re-scraped after an AI run keeps
 * that run's timestamp and hashes (#1450 plan, finding 3), and showing them
 * against official text would attribute it to a model.
 */
export function buildAiProvenance(
  row: Row,
  prefix: ProvenancePrefix,
  output: unknown,
  options: ProvenanceOptions = {},
): AiProvenanceModel | undefined {
  if (output === null || output === undefined) return undefined;
  const kind = kindOf(row, prefix, options);
  if (kind === AiProvenanceKind.DETERMINISTIC) {
    // Rendered by code at a known time; there is no prompt or model to name.
    const generatedAt = column<Date>(row, prefix, 'GeneratedAt') ?? undefined;
    return { kind, generatedAt, ...source(options) };
  }
  if (kind !== AiProvenanceKind.AI) {
    return { kind, ...source(options) };
  }
  return {
    kind,
    promptHash: column<string>(row, prefix, 'PromptHash') ?? undefined,
    promptVersion: column<string>(row, prefix, 'PromptVersion') ?? undefined,
    llmModel: column<string>(row, prefix, 'LlmModel') ?? undefined,
    llmDigest: column<string>(row, prefix, 'LlmDigest') ?? undefined,
    generatedAt: column<Date>(row, prefix, 'GeneratedAt') ?? undefined,
    ...source(options),
  };
}

/** The provenance columns of one `civics_blocks` row — one source page. */
export interface CivicsBlockProvenanceRow {
  sourceUrl: string;
  promptHash: string | null;
  promptVersion: string | null;
  llmModel: string | null;
  llmDigest: string | null;
  extractedAt: Date;
}

/**
 * The receipt for one civics source page (#1450).
 *
 * Civics data is merged across pages, so there is no single receipt for it:
 * the page shows one per source, and each merged item (a term, a stage, a
 * chamber) finds its own through the `sourceUrl` its `CivicText` already
 * carries. One extraction call writes a block's content, prompt, model and
 * `extractedAt` in a single update (`civics-sync.service.ts`), so the
 * receipt always describes the content beside it and the page is its source.
 */
export function civicsSourceProvenance(
  row: CivicsBlockProvenanceRow,
): AiProvenanceModel {
  return {
    kind: AiProvenanceKind.AI,
    promptHash: row.promptHash ?? undefined,
    promptVersion: row.promptVersion ?? undefined,
    llmModel: row.llmModel ?? undefined,
    llmDigest: row.llmDigest ?? undefined,
    generatedAt: row.extractedAt,
    sourceUrl: row.sourceUrl,
  };
}
