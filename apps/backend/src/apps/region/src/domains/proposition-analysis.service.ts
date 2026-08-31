import { Injectable, Logger } from '@nestjs/common';
import {
  extractJsonObjectSlice,
  type PropositionAnalysisClaim,
  type PropositionAnalysisSection,
  type PropositionExistingVsProposed,
} from '@opuspopuli/common';
import { Prisma } from '@opuspopuli/relationaldb-provider';
import { readOptionalPositiveInt, readPositiveInt } from './config-helpers';
import {
  LlmGeneratorBase,
  type GenerationFailure,
  type GenerationFailureReason,
} from './llm-generator.base';

/**
 * Shape we ask the LLM to return. Matches the DB columns added by the
 * add_proposition_analysis migration one-to-one.
 */
interface AnalysisPayload {
  analysisSummary: string;
  keyProvisions: string[];
  fiscalImpact: string;
  yesOutcome: string;
  noOutcome: string;
  existingVsProposed: PropositionExistingVsProposed;
  analysisSections: PropositionAnalysisSection[];
  analysisClaims: PropositionAnalysisClaim[];
}

/** Minimum shape needed from a Proposition row to run analysis. */
interface PropForAnalysis {
  id: string;
  externalId: string;
  title: string;
  fullText: string | null;
  analysisPromptHash: string | null;
  analysisGeneratedAt: Date | null;
  updatedAt: Date;
}

/**
 * Generates AI-backed civic analysis for ballot propositions from the
 * extracted PDF fullText. Produces the plain-language summary, key
 * provisions, fiscal impact, yes/no outcomes, existing-vs-proposed
 * comparison, AI-segmented section anchors, and per-claim attribution
 * that the frontend Layer 1/2/4 components render.
 *
 * Mirrors BioGeneratorService + CommitteeSummaryGeneratorService:
 * - Injects PromptClientService + ILLMProvider optionally so the service
 *   no-ops gracefully in envs without either (e.g., unit tests).
 * - Uses `documentType: 'proposition-analysis'` which the prompt-client
 *   routes to a `document-analysis-proposition-analysis` template in the
 *   private prompt-service. Template lives there, not here.
 * - Short-circuits reruns when the prompt hash is unchanged and fullText
 *   hasn't been touched since the last generation — cheap idempotency.
 *
 * Tunable via env vars:
 * - PROPOSITION_ANALYSIS_MAX_TOKENS (default 6000) — see the constant below;
 *   the default was measured, not guessed.
 * - PROPOSITION_ANALYSIS_CONCURRENCY (default 1)
 * - PROPOSITION_ANALYSIS_MAX_PROPS (default unlimited) — dev cap.
 */
type GenerateOutcome =
  | { ok: true; payload: AnalysisPayload; promptHash: string }
  | { ok: false; failure: GenerationFailure };

type PersistOutcome =
  | { ok: true }
  | { ok: false; reason: GenerationFailureReason };

/**
 * A `JSON.parse` message, minus the response text V8 quotes back inside it.
 *
 * The position is the diagnostic half — it says whether the JSON died two
 * characters in or eight thousand, which is the difference between a model
 * that never started and one that was cut off mid-object. The quoted snippet
 * is just the response body arriving in the log by another route.
 */
function describeParseError(error: Error): string {
  const position = /position (\d+)/.exec(error.message);
  return position ? `${error.name} at position ${position[1]}` : error.name;
}

@Injectable()
export class PropositionAnalysisService extends LlmGeneratorBase {
  private readonly logger = new Logger(PropositionAnalysisService.name);
  // Field initializers run after super(), so this.config is already set.
  /**
   * Output budget, in tokens.
   *
   * ── Measured against production, 2026-08-31 (#1085) ──────────────────
   *
   * Was 2000. Two measures had never produced an analysis:
   *
   *   25-0020A2  61,123 chars in  ->  no_json at 2000, ANALYSED at 6000
   *   25-0032A1  88,671 chars in  ->  no_json at 2000, ANALYSED at 6000
   *
   * The payload scales with the measure: `analysisSections` and
   * `analysisClaims` grow with length, so past roughly 50k characters of
   * input the JSON no longer fits in 2000 tokens. It is cut before its
   * closing brace, `extractJsonObjectSlice` requires balanced braces, and the
   * failure presents as "the model returned no JSON at all" — which reads as
   * a model ignoring the format rather than a budget being too small.
   *
   * #1085's own technical note said not to raise this, on the reasoning that
   * it governs output while the problem was input length. That was wrong:
   * output length is a FUNCTION of input length here, which is exactly why
   * only the longest measures failed.
   *
   * 6000 is a value that worked, not a measured ceiling — the true floor for
   * an 88k measure is somewhere between 2000 and 6000 and was not bisected.
   * Chosen with headroom because the corpus is 52 rows and stable, so the
   * cost of over-provisioning is small and the cost of another silent
   * shortfall is months of nobody knowing.
   */
  private readonly maxTokens = readPositiveInt(
    this.config,
    'PROPOSITION_ANALYSIS_MAX_TOKENS',
    6000,
  );
  private readonly concurrency = readPositiveInt(
    this.config,
    'PROPOSITION_ANALYSIS_CONCURRENCY',
    1,
  );
  private readonly maxProps = readOptionalPositiveInt(
    this.config,
    'PROPOSITION_ANALYSIS_MAX_PROPS',
  );

  /**
   * Generate (or regenerate) analysis for a single proposition by id.
   * Returns true when a fresh analysis was written, false on skip/failure.
   *
   * @param force — when true, skips the prompt-hash short-circuit and
   *   always calls the LLM. Used by the explicit regeneratePropositionAnalysis
   *   resolver mutation and the backfill script's --force flag.
   */
  async generate(propositionId: string, force = false): Promise<boolean> {
    if (!this.promptClient || !this.llm || !this.db) return false;

    const prop = await this.db.proposition.findUnique({
      where: { id: propositionId },
      select: {
        id: true,
        externalId: true,
        title: true,
        fullText: true,
        analysisPromptHash: true,
        analysisGeneratedAt: true,
        updatedAt: true,
      },
    });
    if (!prop) {
      this.logger.warn(`Proposition ${propositionId} not found`);
      return false;
    }
    if (!prop.fullText || prop.fullText.trim().length === 0) {
      this.logger.debug(`Skipping ${prop.externalId}: no fullText to analyze`);
      return false;
    }

    if (!force && (await this.isCurrent(prop))) {
      this.logger.debug(
        `Skipping ${prop.externalId}: analysis is current (prompt hash unchanged, fullText unmodified since generation)`,
      );
      return false;
    }

    return (await this.tryGenerateAndPersist(prop)).ok;
  }

  /**
   * Generate analyses for all propositions that have fullText but no
   * analysis yet (or whose prompt template has since changed). Used by
   * the backfill script and the post-ingestion hook.
   */
  async generateMissing(maxPropsOverride?: number): Promise<void> {
    if (!this.promptClient || !this.llm || !this.db) return;

    const cap =
      maxPropsOverride && maxPropsOverride > 0
        ? maxPropsOverride
        : this.maxProps;

    const pending = await this.db.proposition.findMany({
      where: {
        deletedAt: null,
        fullText: { not: null },
        analysisGeneratedAt: null,
      },
      select: {
        id: true,
        externalId: true,
        title: true,
        fullText: true,
        analysisPromptHash: true,
        analysisGeneratedAt: true,
        updatedAt: true,
      },
      orderBy: { electionDate: 'desc' },
      take: cap,
    });

    if (pending.length === 0) return;

    this.logger.log(
      `Generating AI analysis for ${pending.length} proposition(s) (concurrency=${this.concurrency}, maxTokens=${this.maxTokens})`,
    );

    let succeeded = 0;
    const failed: string[] = [];
    for (let i = 0; i < pending.length; i += this.concurrency) {
      const batch = pending.slice(i, i + this.concurrency);
      const results = await Promise.all(
        batch.map((p) => this.tryGenerateAndPersist(p)),
      );
      results.forEach((result, index) => {
        if (result.ok) {
          succeeded += 1;
        } else {
          failed.push(`${batch[index].externalId} (${result.reason})`);
        }
      });
    }

    // A bare ratio was the only production signal this ever emitted, and a
    // ratio cannot be acted on: it names no measure and gives no reason.
    if (failed.length > 0) {
      this.logger.warn(
        `Generated ${succeeded}/${pending.length} proposition analyses; ${failed.length} failed: ${failed.join(', ')}`,
      );
      return;
    }

    this.logger.log(
      `Generated ${succeeded}/${pending.length} proposition analyses successfully`,
    );
  }

  /**
   * Decide whether a stored analysis is still current: the prompt hash
   * matches what the prompt-service returns today AND the proposition row
   * hasn't been touched since the analysis was written. Either miss
   * triggers a regeneration.
   */
  private async isCurrent(prop: PropForAnalysis): Promise<boolean> {
    if (!prop.analysisGeneratedAt || !prop.analysisPromptHash) return false;
    if (prop.updatedAt.getTime() > prop.analysisGeneratedAt.getTime()) {
      return false;
    }
    try {
      const currentHash = await this.promptClient!.getPromptHash(
        'document-analysis-proposition-analysis',
      );
      return currentHash === prop.analysisPromptHash;
    } catch (error) {
      this.logger.warn(
        `Prompt hash lookup failed; treating analysis as stale: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async tryGenerateAndPersist(
    prop: PropForAnalysis,
  ): Promise<PersistOutcome> {
    try {
      const outcome = await this.generateOne(prop);
      if (!outcome.ok) {
        return this.reportFailure(prop, outcome.failure);
      }

      await this.db!.proposition.update({
        where: { id: prop.id },
        data: {
          analysisSummary: outcome.payload.analysisSummary,
          keyProvisions: outcome.payload
            .keyProvisions as unknown as Prisma.InputJsonValue,
          fiscalImpact: outcome.payload.fiscalImpact,
          yesOutcome: outcome.payload.yesOutcome,
          noOutcome: outcome.payload.noOutcome,
          existingVsProposed: outcome.payload
            .existingVsProposed as unknown as Prisma.InputJsonValue,
          analysisSections: outcome.payload
            .analysisSections as unknown as Prisma.InputJsonValue,
          analysisClaims: outcome.payload
            .analysisClaims as unknown as Prisma.InputJsonValue,
          analysisSource: 'ai-generated',
          analysisPromptHash: outcome.promptHash,
          analysisGeneratedAt: new Date(),
          // A measure that analyses now is no longer unanalysable. Clearing in
          // the same update is what keeps the column from accumulating stale
          // verdicts that outlive the problem they describe.
          analysisFailureReason: null,
          analysisFailedAt: null,
        },
      });
      return { ok: true };
    } catch (error) {
      return this.reportFailure(prop, {
        reason: 'llm_error',
        detail: (error as Error).message,
      });
    }
  }

  /**
   * Say so, in both places a reader might look: the log, and the row.
   *
   * Before #1085 the only signal that any of this happened was a ratio —
   * `Generated 4/8` — with no measure names and no reasons.
   */
  private async reportFailure(
    prop: PropForAnalysis,
    failure: GenerationFailure,
  ): Promise<PersistOutcome> {
    this.logger.warn(this.formatGenerationFailure(prop.externalId, failure));
    try {
      await this.db!.proposition.update({
        where: { id: prop.id },
        data: {
          analysisFailureReason: failure.reason,
          analysisFailedAt: new Date(),
        },
      });
    } catch (error) {
      // Recording the failure must never become a second, louder failure.
      this.logger.warn(
        `Could not record the analysis failure for ${prop.externalId}: ${(error as Error).message}`,
      );
    }
    return { ok: false, reason: failure.reason };
  }

  private async generateOne(prop: PropForAnalysis): Promise<GenerateOutcome> {
    const { promptText, promptHash } =
      await this.promptClient!.getDocumentAnalysisPrompt({
        documentType: 'proposition-analysis',
        text: this.formatPropData(prop),
      });

    const result = await this.llm!.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: 0.2,
    });

    // Carried on every refusal below. `finishReason` is the field that
    // distinguishes "the output was cut off at maxTokens mid-JSON" from "the
    // model finished and what it wrote was not JSON" — the first is an output
    // budget problem, the second is a prompt problem, and before #1085 this
    // was discarded so neither could be told apart.
    const context = {
      finishReason: result.finishReason,
      responseChars: result.text?.length ?? 0,
      inputChars: prop.fullText?.length ?? 0,
    };

    // `extractJsonObjectSlice` needs balanced braces, so an output cut off
    // mid-object comes back empty and is indistinguishable from a model that
    // wrote no JSON at all — which is exactly the ambiguity #1085 turns on.
    // `finishReason` resolves it, so name the case rather than making every
    // future reader recombine two fields to see it.
    // `finishReason` alone is not trustworthy: until #1085 the Ollama
    // provider mapped it from `done`, which is true whenever generation
    // finished FOR ANY REASON — so a budget-exhausted response reported
    // "stop" and this branch never fired. The provider is fixed, but older
    // Ollama builds omit `done_reason`, so also infer truncation from the
    // budget actually spent. Either signal is enough.
    const spentOutputTokens = result.tokensOut ?? 0;
    const budgetExhausted =
      spentOutputTokens > 0 && spentOutputTokens >= this.maxTokens * 0.98;
    const truncated = result.finishReason === 'length' || budgetExhausted;

    const candidate = extractJsonObjectSlice(result.text);
    if (!candidate) {
      return {
        ok: false,
        failure: { reason: truncated ? 'truncated' : 'no_json', ...context },
      };
    }

    let parsed: Partial<AnalysisPayload>;
    try {
      parsed = JSON.parse(candidate) as Partial<AnalysisPayload>;
    } catch (error) {
      return {
        ok: false,
        failure: {
          reason: truncated ? 'truncated' : 'parse_error',
          ...context,
          detail: describeParseError(error as Error),
        },
      };
    }

    // Propositions are verbose and the payload spans ~8 fields, so partial
    // salvage is not useful — a half-populated analysis leaves UI sections
    // empty in unpredictable ways. Refusing is still right; being quiet
    // about it was not.
    const payload = this.normalizePayload(parsed, prop);
    if (!payload) {
      return { ok: false, failure: { reason: 'no_summary', ...context } };
    }

    return { ok: true, payload, promptHash };
  }

  /**
   * Format the proposition data the LLM is analyzing. Keeps the fullText
   * verbatim (the prompt needs it for claim-citation offsets) and includes
   * externalId + title so the model can disambiguate identical-sounding
   * measures from different jurisdictions.
   */
  private formatPropData(prop: PropForAnalysis): string {
    return [
      `ExternalId: ${prop.externalId}`,
      `Title: ${prop.title}`,
      '',
      'FullText:',
      prop.fullText ?? '',
    ].join('\n');
  }

  /**
   * Coerce a parsed payload into the expected shape — default missing
   * fields so the DB update never writes `undefined` where NULL is
   * required, and clamp claim/section offsets to valid ranges into the
   * source fullText. Returns undefined if the core summary is missing,
   * since that's the one field the UI can't recover from.
   */
  private normalizePayload(
    parsed: Partial<AnalysisPayload>,
    prop: PropForAnalysis,
  ): AnalysisPayload | undefined {
    const summary = parsed.analysisSummary?.trim();
    if (!summary) return undefined;

    const textLen = prop.fullText?.length ?? 0;
    const clamp = (n: number | undefined): number => {
      if (typeof n !== 'number' || Number.isNaN(n)) return 0;
      return Math.max(0, Math.min(textLen, Math.floor(n)));
    };

    const sections = this.normalizeSections(
      Array.isArray(parsed.analysisSections) ? parsed.analysisSections : [],
      prop.fullText ?? '',
    );

    const claims = Array.isArray(parsed.analysisClaims)
      ? parsed.analysisClaims
          .filter(
            (c): c is PropositionAnalysisClaim =>
              !!c && typeof c.claim === 'string' && typeof c.field === 'string',
          )
          .map((c) => ({
            claim: c.claim,
            field: c.field,
            sourceStart: clamp(c.sourceStart),
            sourceEnd: clamp(c.sourceEnd),
            confidence: c.confidence,
          }))
          .filter((c) => c.sourceEnd > c.sourceStart)
      : [];

    return {
      analysisSummary: summary,
      keyProvisions: Array.isArray(parsed.keyProvisions)
        ? parsed.keyProvisions.filter((k): k is string => typeof k === 'string')
        : [],
      fiscalImpact: parsed.fiscalImpact?.trim() ?? '',
      yesOutcome: parsed.yesOutcome?.trim() ?? '',
      noOutcome: parsed.noOutcome?.trim() ?? '',
      existingVsProposed: {
        current: parsed.existingVsProposed?.current?.trim() ?? '',
        proposed: parsed.existingVsProposed?.proposed?.trim() ?? '',
      },
      analysisSections: sections,
      analysisClaims: claims,
    };
  }

  /**
   * Reconcile LLM-supplied sections against the actual fullText.
   *
   * LLMs cannot count characters precisely — they routinely off-by-one
   * the endOffset (so consecutive sections end up with a 1-char gap that
   * silently drops a character at every boundary in the rendered UI),
   * skip the leading preamble entirely, or forget to extend the last
   * section to the end of the document.
   *
   * Strategy: trust the section HEADINGS, not the offsets. For each
   * heading that appears verbatim in fullText, snap its startOffset to
   * the actual string match. Then derive each endOffset from the next
   * section's startOffset, force section[0] to start at 0, and force
   * the last section to end at fullText.length. Sections whose heading
   * isn't in fullText fall back to clamped LLM offsets but still get
   * gap-closed against neighbours.
   */
  private normalizeSections(
    raw: unknown[],
    fullText: string,
  ): PropositionAnalysisSection[] {
    const textLen = fullText.length;
    if (textLen === 0) return [];

    const clamp = (n: number | undefined): number => {
      if (typeof n !== 'number' || Number.isNaN(n)) return 0;
      return Math.max(0, Math.min(textLen, Math.floor(n)));
    };

    const valid = raw.filter(
      (s): s is PropositionAnalysisSection =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as PropositionAnalysisSection).heading === 'string',
    );
    if (valid.length === 0) return [];

    // Snap each section's start to where its heading is found in
    // fullText. Search after the previous section's resolved start so
    // identical sub-headings later in the document don't all collapse
    // onto the first occurrence.
    let searchFrom = 0;
    const snapped = valid.map((s) => {
      const heading = s.heading.trim();
      const idx = heading ? fullText.indexOf(heading, searchFrom) : -1;
      const resolvedStart = idx >= 0 ? idx : clamp(s.startOffset);
      searchFrom = Math.max(searchFrom, resolvedStart + 1);
      return {
        heading: s.heading,
        startOffset: resolvedStart,
        // tentative — will be overwritten in the next pass
        endOffset: clamp(s.endOffset),
      };
    });

    // Sort by startOffset so ordering is consistent regardless of the
    // order the LLM emitted sections in.
    snapped.sort((a, b) => a.startOffset - b.startOffset);

    // Force section[0] to cover any leading preamble.
    snapped[0].startOffset = 0;

    // Each section's end is the next section's start; the last section
    // runs to the end of the document.
    for (let i = 0; i < snapped.length - 1; i++) {
      snapped[i].endOffset = snapped[i + 1].startOffset;
    }
    const last = snapped.at(-1);
    if (last) last.endOffset = textLen;

    // Drop empty/inverted sections that survived (rare but possible if
    // two snapped headings landed on the same offset).
    return snapped.filter((s) => s.endOffset > s.startOffset);
  }
}
