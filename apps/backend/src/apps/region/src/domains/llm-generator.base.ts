import { Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptClientService } from '@opuspopuli/prompt-client';
import { type ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';

/**
 * Shared constructor parameters for region AI-generator services.
 *
 * All generator services (BioGeneratorService, CommitteeSummaryGeneratorService,
 * EntityActivitySummaryGeneratorService, LegislativeCommitteeDescriptionGeneratorService,
 * PropositionAnalysisService) inject the same four optional dependencies.
 * Extracting them here removes the constructor-signature duplication that
 * jscpd flags as structural clones.
 *
 * NestJS note: the `@Optional()` and `@Inject()` decorators on a base-class
 * constructor are inherited by subclasses through `reflect-metadata`, so the
 * DI container sees them when it instantiates the concrete subclass.
 */
/**
 * Why a generator refused an LLM response (#1085).
 *
 * These used to be `undefined` returns logged at `debug` — switched off in the
 * only environment that matters — or, in the missing-summary case, not logged
 * at any level. A failure that produces no record is indistinguishable from a
 * measure nobody tried to analyse.
 */
export type GenerationFailureReason =
  /** The model stopped against its output budget before closing the JSON. */
  'truncated' | 'no_json' | 'parse_error' | 'no_summary' | 'llm_error';

export interface GenerationFailure {
  readonly reason: GenerationFailureReason;
  /**
   * The model's own account of why it stopped. `length` means the output was
   * truncated against the caller's max-tokens budget — a different problem
   * from a model that rambled instead of returning JSON, and the two want
   * opposite fixes.
   */
  readonly finishReason?: string;
  readonly responseChars?: number;
  readonly inputChars?: number;
  /** Bounded diagnostic detail. Never response text — see formatGenerationFailure. */
  readonly detail?: string;
}

/**
 * The attribution triple every persisted AI output must carry (#1149).
 *
 * `CivicsBlock` is the reference pattern: `promptHash` + `promptVersion`
 * name the exact published prompt (the #1143 attestation chain), `llmModel`
 * names what ran it. Field names here are generic; each writer maps them
 * onto its own prefixed columns (`bio_prompt_hash`, `summary_prompt_hash`,
 * …) because a table carrying several AI outputs needs to say WHICH output
 * a hash attributes.
 */
export interface AiOutputProvenance {
  readonly promptHash: string;
  readonly promptVersion: string;
  /** Bare model name from `getModelName()` — the CivicsBlock convention. */
  readonly llmModel: string | null;
  /**
   * Content digest of the weights that ran it (#1281, M1 scope item 5).
   *
   * A tag is not a pin: `ollama pull` can replace the weights behind an
   * unchanged name, so `llmModel` alone cannot answer "which model produced
   * this" — including retrospectively, for rows already written.
   *
   * `UNKNOWN_MODEL_DIGEST` when the provider could not resolve one. Recorded
   * rather than omitted, because "we could not determine it" and "we never
   * asked" are different claims and only one of them is honest.
   */
  readonly llmModelDigest: string;
}

/** Recorded when a provider cannot resolve its digest — never left blank. */
export const UNKNOWN_MODEL_DIGEST = 'unknown';

export abstract class LlmGeneratorBase {
  constructor(
    @Optional() protected readonly config?: ConfigService,
    @Optional() protected readonly promptClient?: PromptClientService,
    @Optional()
    @Inject('LLM_PROVIDER')
    protected readonly llm?: ILLMProvider,
    @Optional() protected readonly db?: DbService,
  ) {}

  /**
   * One-line description of a refusal, for logging at `warn`.
   *
   * Deliberately carries sizes and reasons but never the response body. The
   * generated text is a public filed record rather than personal data, so this
   * is a log-hygiene rule rather than a privacy one: a truncated 8k-character
   * ramble in the log costs the reader the very signal they came for.
   *
   * Subclasses log this with their own logger rather than the base owning one,
   * so adopting it changes nothing about where a service's lines come from.
   */
  protected formatGenerationFailure(
    subject: string,
    failure: GenerationFailure,
  ): string {
    const parts = [`reason=${failure.reason}`];
    if (failure.finishReason) parts.push(`finish=${failure.finishReason}`);
    if (typeof failure.inputChars === 'number') {
      parts.push(`inputChars=${failure.inputChars}`);
    }
    if (typeof failure.responseChars === 'number') {
      parts.push(`responseChars=${failure.responseChars}`);
    }
    if (failure.detail) parts.push(`detail=${failure.detail}`);
    return `Generation failed for ${subject}: ${parts.join(' ')}`;
  }

  /**
   * Capture provenance at the prompt-fetch site (#1149).
   *
   * Exists so a generator cannot destructure `{ promptText }` and silently
   * discard the attribution the prompt client already returned — the exact
   * failure this primitive retrofits away. Call it with the full prompt
   * response; thread the result to the persist call.
   */
  protected async outputProvenance(prompt: {
    promptHash: string;
    promptVersion: string;
  }): Promise<AiOutputProvenance> {
    return {
      promptHash: prompt.promptHash,
      promptVersion: prompt.promptVersion,
      llmModel: this.llm?.getModelName() ?? null,
      // Async because resolving the digest is an HTTP call on first use. The
      // provider caches it for the life of the process, so this costs one
      // round-trip per run, not one per generation.
      llmModelDigest:
        (await this.llm?.getModelDigest()) ?? UNKNOWN_MODEL_DIGEST,
    };
  }

  /**
   * Attach provenance to a persist payload.
   *
   * THE write path for AI output (#1281). `outputProvenance` alone was
   * opt-in, and opt-in drifted within three months: five of six generators
   * called it and `proposition-analysis` quietly rebuilt the same fields
   * inline, so a change to the attribution set reached five of them.
   *
   * Routing the payload through here means the columns and the provenance are
   * assembled in one place, and a generator that forgets is visible as a
   * generator that did not call it — rather than as a row that looks written
   * correctly until someone asks which prompt produced it.
   *
   * `map` exists because a table carrying several AI outputs needs prefixed
   * columns (`bio_prompt_hash`, `summary_prompt_hash`, …) to say WHICH output
   * a hash attributes.
   */
  protected async withProvenance<TData extends object, TOut extends object>(
    data: TData,
    prompt: { promptHash: string; promptVersion: string },
    map: (provenance: AiOutputProvenance) => TOut,
  ): Promise<TData & TOut> {
    return { ...data, ...map(await this.outputProvenance(prompt)) };
  }
}
