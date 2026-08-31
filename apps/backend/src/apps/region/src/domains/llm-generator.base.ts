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
}
