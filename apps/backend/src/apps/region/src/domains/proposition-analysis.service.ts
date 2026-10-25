import { createHash, randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import {
  buildSkipKey,
  extractJsonObjectSlice,
  laneJobId,
  stableHash,
  type JsonRepairClass,
  parseJsonWithRepair,
  type PropositionAnalysisClaim,
  type PropositionAnalysisSection,
  type PropositionExistingVsProposed,
  locateQuote,
  findContactDetails,
} from '@opuspopuli/common';
import { Prisma } from '@opuspopuli/relationaldb-provider';
import { normaliseAnalysisClaims } from './claim-normalisers';
import { readOptionalPositiveInt, readPositiveInt } from './config-helpers';
import {
  LlmGeneratorBase,
  UNKNOWN_MODEL_DIGEST,
  type GenerationFailure,
  type GenerationFailureReason,
} from './llm-generator.base';

/**
 * The version of the code between the model's answer and the stored row —
 * JSON repair, the section and claim normalisers, contact-detail handling.
 * Part of the analysis skip key's config axis (propositions Phase B, K-P2):
 * **bump it whenever post-processing changes what an analysis stores**, or
 * the change never reaches a measure whose text, prompt and model are
 * unchanged. (The prompt template is versioned by its own hash.)
 */
export const PROPOSITION_ANALYZER_VERSION = 'proposition-analyzer-1';

/** Sampling temperature for an analysis — part of the config axis. */
const ANALYSIS_TEMPERATURE = 0.2;

/**
 * The config axis of the analysis skip key: the analyzer version and the
 * EFFECTIVE generation settings. Effective, not the code default — a node
 * that sets `PROPOSITION_ANALYSIS_MAX_TOKENS` hashes the value it runs with.
 * Region config does not reach the analysis prompt (`formatPropData` is id,
 * title and full text), so it is not here.
 */
export function propositionAnalysisConfigHash(maxTokens: number): string {
  return stableHash({
    analyzer: PROPOSITION_ANALYZER_VERSION,
    maxTokens,
    temperature: ANALYSIS_TEMPERATURE,
  });
}

/** The columns an analysis reads and its staleness check compares. */
const ANALYSIS_ROW_SELECT = {
  id: true,
  externalId: true,
  title: true,
  fullText: true,
  analysisPromptHash: true,
  sourceVersionId: true,
  analysisSourceTextHash: true,
  fullTextHash: true,
  analysisGeneratedAt: true,
  analysisLlmDigest: true,
  analysisConfigHash: true,
} as const;

/**
 * One measure's analysis as the propositions sync counts it (S4):
 * `unchanged` — current on every axis by the time the job ran.
 */
export type PropositionAnalysisOutcome =
  | 'created'
  | 'updated'
  | 'unchanged'
  /** Gone, or no text to analyse, by the time it ran — nothing to do. */
  | 'skipped'
  | 'failed';

/**
 * What a current analysis must match, resolved once per run. `promptHash`
 * and `modelDigest` are undefined when they could not be resolved — that
 * axis is then not used to call rows stale, as the prompt axis already
 * behaved before the model axis existed.
 */
export interface LiveAnalysisKey {
  promptHash?: string;
  modelDigest?: string;
  configHash: string;
}

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
export interface PropForAnalysis {
  id: string;
  externalId: string;
  title: string;
  fullText: string | null;
  analysisPromptHash: string | null;
  /** The archived page `fullText` was extracted from (#1306). */
  sourceVersionId: string | null;
  analysisSourceTextHash: string | null;
  fullTextHash: string | null;
  analysisGeneratedAt: Date | null;
  analysisLlmDigest: string | null;
  analysisConfigHash: string | null;
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
 *   prompt-service repo. Template lives there, not here.
 * - Short-circuits reruns when the prompt hash is unchanged and fullText
 *   hasn't been touched since the last generation — cheap idempotency.
 *
 * Tunable via env vars:
 * - PROPOSITION_ANALYSIS_MAX_TOKENS (default 6000) — see the constant below;
 *   the default was measured, not guessed.
 * - PROPOSITION_ANALYSIS_CONCURRENCY (default 1) — the batch pass
 *   (`generateMissing`, the backfill script) only. The sync queues each
 *   measure (S4); its concurrency is `BULLMQ_QUEUE_PROPOSITION_ANALYSIS_CONCURRENCY`.
 * - PROPOSITION_ANALYSIS_MAX_PROPS (default unlimited) — dev cap.
 */
type GenerateOutcome =
  | {
      ok: true;
      payload: AnalysisPayload;
      promptHash: string;
      promptVersion: string;
    }
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

/**
 * Re-parse to recover the error the MODEL caused, for the failure detail.
 *
 * `parseJsonWithRepair` returns `undefined` rather than an error, deliberately
 * — it has no opinion about which error is worth reporting. The one worth
 * reporting is the original: a post-repair message describes a string that was
 * never sent, and the position it names would send a reader to the wrong byte.
 */
function originalParseError(candidate: string): Error {
  try {
    JSON.parse(candidate);
    // Unreachable: only called after a failed repair, which only happens after
    // a failed parse. Stated rather than asserted away with a non-null.
    return new Error('SyntaxError');
  } catch (error) {
    return error as Error;
  }
}

/** Log-facing names for the repair classes, kept out of the shared util. */
const REPAIR_LABELS: Record<JsonRepairClass, string> = {
  quotes: 'unescaped quote(s)',
  commas: 'trailing comma(s)',
};

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

    const prop = await this.loadForAnalysis(propositionId);
    if (!prop) return false;

    if (!force && (await this.isCurrent(prop))) {
      this.logger.debug(
        `Skipping ${prop.externalId}: analysis is current (text, prompt, model and analyzer config unchanged)`,
      );
      return false;
    }

    return (await this.tryGenerateAndPersist(prop)).ok;
  }

  /**
   * One measure's analysis as a `proposition-analysis` job (S4): reload the
   * row, re-check it on every axis — an earlier run may have analysed it
   * since it was queued — and analyse it.
   *
   * A transport failure (`llm_error`: a runner killed, the lane unreachable)
   * is recorded on the row like any failure, then THROWN, so the queue
   * retries it; a later success clears the reason. A deterministic one
   * (`truncated`, `no_json`, `parse_error`, `no_summary`) is recorded and
   * returned as `failed`: a retry would spend a full generation to likely
   * repeat it.
   */
  async analyseOne(propositionId: string): Promise<PropositionAnalysisOutcome> {
    if (!this.promptClient || !this.llm || !this.db) {
      throw new Error(
        'Proposition analysis requires PromptClient, LLM provider and DbService',
      );
    }
    const prop = await this.loadForAnalysis(propositionId);
    // Not a failure: counting it as one would repeat every run and, five in
    // a row, trip the phase's consecutive-failure abort.
    if (!prop) return 'skipped';
    if (await this.isCurrent(prop)) return 'unchanged';

    const result = await this.tryGenerateAndPersist(prop);
    if (result.ok) return prop.analysisGeneratedAt ? 'updated' : 'created';
    if (result.reason === 'llm_error') {
      throw new Error(
        `Analysis of ${prop.externalId} failed transiently (llm_error); retrying`,
      );
    }
    return 'failed';
  }

  /**
   * The job id for a stale measure's analysis (S4): its id, and the skip key
   * over the four axes it is judged on, so a job collapses onto one in
   * flight only for identical inputs. An unknown prompt hash or digest gives
   * no key — a one-off id that never collapses.
   */
  static analysisJobId(
    prop: Pick<PropForAnalysis, 'id' | 'fullTextHash'>,
    live: LiveAnalysisKey,
  ): string {
    const skipKey = buildSkipKey({
      sourceHash: prop.fullTextHash ?? '',
      promptHash: live.promptHash ?? '',
      modelDigest: live.modelDigest ?? '',
      configHash: live.configHash,
    });
    return skipKey
      ? laneJobId(prop.id, 'analyse', skipKey)
      : `proposition-analysis-${randomUUID()}`;
  }

  /** A measure with text to analyse, or null — logged — when there is none. */
  private async loadForAnalysis(
    propositionId: string,
  ): Promise<PropForAnalysis | null> {
    const prop = await this.db!.proposition.findUnique({
      where: { id: propositionId },
      select: ANALYSIS_ROW_SELECT,
    });
    if (!prop) {
      this.logger.warn(`Proposition ${propositionId} not found`);
      return null;
    }
    if (!prop.fullText || prop.fullText.trim().length === 0) {
      this.logger.debug(`Skipping ${prop.externalId}: no fullText to analyze`);
      return null;
    }
    return prop;
  }

  /**
   * Generate analyses for all propositions that have fullText but no
   * analysis yet (or whose prompt template has since changed). Used by
   * the backfill script; the propositions sync queues each measure instead
   * (S4, `PropositionsSyncService.analyseStale`).
   *
   * ── CORPUS-WIDE, not region-scoped ───────────────────────────────────
   *
   * There is no `regionPluginName` filter, so this regenerates every stale
   * proposition in the database regardless of which region's sync invoked
   * it. Measured 2026-10-12: a sync scoped to `california` moved all 15
   * `california-sonoma` measures to prompt v4 as well — 70 rows, not the 56
   * the job named.
   *
   * That is RIGHT for the backfill script and for a prompt revision, which
   * makes the whole corpus stale at once and should regenerate it. It is
   * surprising as the tail of a region-scoped job: the GPU cost of every
   * other region lands on whoever synced one, and the job's own counters
   * describe a subset of what it did.
   *
   * Left corpus-wide deliberately. Scoping it to the calling region would
   * mean a prompt revision only reached the regions someone happened to
   * sync, which is the worse failure — a corpus split across prompt
   * versions with nothing saying so. Documented here instead, because the
   * surprise is in the invocation and not in the selection.
   */
  async generateMissing(maxPropsOverride?: number): Promise<void> {
    if (!this.promptClient || !this.llm || !this.db) return;

    const { pending } = await this.stampAndSelectStale(maxPropsOverride);

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
   * SHA-256 of the text an analysis was generated against.
   *
   * MUST stay byte-identical to the `full_text_hash` generated column, which
   * Postgres computes as `encode(sha256(full_text::bytea),'hex')`. Verified
   * equal across ASCII, smart quotes, em-dashes, Spanish accents and the
   * empty string — if the two ever diverged, every row would compare unequal
   * and regenerate on every run, which on a 32B model is hours of work.
   */
  private static sourceTextHash(fullText: string | null): string | null {
    if (fullText === null || fullText === undefined) return null;
    return createHash('sha256').update(fullText, 'utf8').digest('hex');
  }

  /**
   * The measures whose analysis is stale on some axis, and the live key they
   * were judged against — what both the batch pass and the propositions
   * sync's queue (S4) act on. Stamps legacy config hashes first, so a
   * stamped row is not selected.
   */
  async stampAndSelectStale(maxPropsOverride?: number): Promise<{
    live: LiveAnalysisKey;
    pending: PropForAnalysis[];
    /** Analysable measures already current on every axis — K-P2's skips. */
    current: number;
  }> {
    const cap =
      maxPropsOverride && maxPropsOverride > 0
        ? maxPropsOverride
        : this.maxProps;

    // Resolved ONCE for the whole batch: a prompt revision or a model pull
    // makes every stored analysis stale at once, so one lookup and an
    // in-database comparison beat a lookup per row.
    const live = await this.liveKey();
    await this.stampLegacyConfigHash(live);

    const analysable = {
      deletedAt: null,
      // Both: an empty text has nothing to analyse, and would otherwise be
      // selected — and skipped — every run.
      AND: [{ fullText: { not: null } }, { fullText: { not: '' } }],
    };
    const stale = this.staleWhere(live);
    const [pending, current] = await Promise.all([
      this.db!.proposition.findMany({
        where: { ...analysable, OR: stale },
        select: ANALYSIS_ROW_SELECT,
        orderBy: { electionDate: 'desc' },
        take: cap,
      }),
      this.db!.proposition.count({
        where: { ...analysable, NOT: { OR: stale } },
      }),
    ]);
    return { live, pending, current };
  }

  /**
   * The live values a current analysis must match (K-P2). A failed lookup
   * leaves that axis undefined rather than failing the run.
   */
  private async liveKey(): Promise<LiveAnalysisKey> {
    let promptHash: string | undefined;
    try {
      promptHash = await this.promptClient!.getPromptHash(
        'document-analysis-proposition-analysis',
      );
    } catch (error) {
      this.logger.warn(
        `Prompt hash lookup failed; the prompt axis is not checked this run: ${(error as Error).message}`,
      );
    }
    const digest = (await this.llm!.getModelDigest()) ?? '';
    return {
      promptHash,
      modelDigest:
        digest && digest !== UNKNOWN_MODEL_DIGEST ? digest : undefined,
      configHash: propositionAnalysisConfigHash(this.maxTokens),
    };
  }

  /**
   * The one-time backfill the owner chose (2026-10-24): an analysis written
   * before the config axis existed has no config hash, and is stamped with
   * the live one instead of regenerated.
   *
   * An accepted assumption, not a proof: the stamp says the row was produced
   * by this analyzer and these settings, which is true unless a node ran it
   * under another `PROPOSITION_ANALYSIS_MAX_TOKENS` or before a normaliser
   * change. Stamping fills only the config column — a row stale on its
   * prompt, model or text is still caught by that axis — so it does not wait
   * for the prompt hash or digest to resolve: waiting would re-analyse every
   * legacy row on a run whose digest lookup failed. Touches only rows with no
   * hash yet; after the first run, none.
   */
  private async stampLegacyConfigHash(live: LiveAnalysisKey): Promise<void> {
    const { count } = await this.db!.proposition.updateMany({
      where: {
        analysisConfigHash: null,
        analysisGeneratedAt: { not: null },
      },
      data: { analysisConfigHash: live.configHash },
    });
    if (count > 0) {
      this.logger.log(
        `Stamped the analyzer config hash on ${count} current analysis(es) written before it was recorded`,
      );
    }
  }

  /**
   * Rows whose analysis is stale on any axis of the key (K-P2): never
   * analysed, or analysed under a different prompt, model, analyzer config,
   * or text.
   */
  private staleWhere(live: LiveAnalysisKey): Prisma.PropositionWhereInput[] {
    // Each axis needs BOTH arms. `{ not: x }` compiles to `col <> x`, and in
    // SQL three-valued logic a NULL column yields NULL, not true — a row that
    // never recorded the value would match neither arm and read as fresh.
    const axis = (
      field: 'analysisPromptHash' | 'analysisLlmDigest' | 'analysisConfigHash',
      value: string | undefined,
    ): Prisma.PropositionWhereInput[] =>
      value ? [{ [field]: null }, { [field]: { not: value } }] : [];
    return [
      { analysisGeneratedAt: null },
      // Prompt axis (#1212 S5); model axis (K-P2 — a model pull used to
      // leave every analysis "current"); config axis (K-P2).
      ...axis('analysisPromptHash', live.promptHash),
      ...axis('analysisLlmDigest', live.modelDigest),
      ...axis('analysisConfigHash', live.configHash),
      // Source-text axis (#1279). `fullTextHash` is a Postgres generated
      // column, so this compares two stored hashes in the database.
      { analysisSourceTextHash: null },
      {
        NOT: {
          analysisSourceTextHash: {
            equals: this.db!.proposition.fields.fullTextHash,
          },
        },
      },
    ];
  }

  /**
   * Whether a stored analysis is current on every axis of the key (K-P2) —
   * the single-row path's version of {@link staleWhere}. No `updatedAt`
   * condition: every sync upsert and every embedding write bump `updatedAt`,
   * so that condition made every row stale after any sync.
   */
  private async isCurrent(prop: PropForAnalysis): Promise<boolean> {
    if (!prop.analysisGeneratedAt || !prop.analysisPromptHash) return false;
    // Computed here rather than read from `fullTextHash` so the single-row
    // path does not depend on the caller having selected that column.
    const sourceHash = PropositionAnalysisService.sourceTextHash(
      prop.fullText ?? null,
    );
    if (!prop.analysisSourceTextHash) return false;
    if (prop.analysisSourceTextHash !== sourceHash) return false;
    const live = await this.liveKey();
    if (!live.promptHash || live.promptHash !== prop.analysisPromptHash) {
      return false;
    }
    if (live.modelDigest && live.modelDigest !== prop.analysisLlmDigest) {
      return false;
    }
    // A pre-K-P2 row is current on the config axis (the backfill rule); the
    // next batch run stamps its hash.
    return (
      prop.analysisConfigHash === null ||
      prop.analysisConfigHash === live.configHash
    );
  }

  private async tryGenerateAndPersist(
    prop: PropForAnalysis,
  ): Promise<PersistOutcome> {
    try {
      const outcome = await this.generateOne(prop);
      if (!outcome.ok) {
        return this.reportFailure(prop, outcome.failure);
      }

      // Built by the base class rather than assembled here (#1281). This
      // service previously rebuilt the same fields inline, which is how it
      // came to be the one generator of six that did not use the shared
      // helper — and how a change to the attribution set would have reached
      // five of them.
      const provenance = await this.outputProvenance({
        promptHash: outcome.promptHash,
        promptVersion: outcome.promptVersion,
      });

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
          analysisPromptHash: provenance.promptHash,
          analysisPromptVersion: provenance.promptVersion,
          analysisLlmModel: provenance.llmModel,
          analysisLlmDigest: provenance.llmModelDigest,
          // Which text version this analysis — and therefore every claim
          // offset derived from it — was generated against (#1279). Without
          // this, a later in-place rewrite of fullText leaves citations
          // addressing different characters with nothing to detect it.
          analysisSourceTextHash: PropositionAnalysisService.sourceTextHash(
            prop.fullText,
          ),
          // The config axis of the skip key (K-P2): which analyzer and
          // generation settings produced this.
          analysisConfigHash: propositionAnalysisConfigHash(this.maxTokens),
          analysisGeneratedAt: new Date(),
          // A measure that analyses now is no longer unanalysable. Clearing in
          // the same update is what keeps the column from accumulating stale
          // verdicts that outlive the problem they describe.
          analysisFailureReason: null,
          analysisFailedAt: null,
        },
      });

      // Dual-write into the evidence graph (#1293), after the authoritative
      // blob and outside its transaction — the analysis a citizen reads must
      // not be lost because its mirror failed.
      //
      // Verified against the same hash the row just recorded, so a verdict is
      // bound to the exact text version it checked (#1279).
      await this.mirrorClaims(
        {
          subjectType: 'proposition',
          subjectId: prop.id,
          claims: normaliseAnalysisClaims(outcome.payload.analysisClaims),
          sourceText: prop.fullText ?? null,
          sourceTextHash: PropositionAnalysisService.sourceTextHash(
            prop.fullText,
          ),
          // The archived page `fullText` was extracted from (#1306), so each
          // citation can be traced to stored bytes rather than to a column
          // the next sync overwrites in place.
          sourceVersionId: prop.sourceVersionId,
        },
        // `error`, not `warn`: the claims were not written. A systematic
        // failure here is otherwise invisible until something reads the
        // tables, which nothing does yet (#1296).
        (message) => this.logger.error(message),
      );

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
    const { promptText, promptHash, promptVersion } =
      await this.promptClient!.getDocumentAnalysisPrompt({
        documentType: 'proposition-analysis',
        text: this.formatPropData(prop),
      });

    const result = await this.llm!.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: ANALYSIS_TEMPERATURE,
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

    // Repair before giving up, the same two malformation classes civics
    // recovers from (#1337). This path had a bare `JSON.parse`, which is the
    // shape civics-sync had before that work: a slice with balanced braces
    // that still will not parse is almost always a bad escape inside a string
    // — an unescaped quote the model carried in from quoted source text, or an
    // illegal trailing comma. Both are recoverable, and on civics the quote
    // repair alone recovered 22,162 characters of correct extraction that had
    // been discarded whole.
    //
    // It matters more here than there. A proposition's `full_text` runs to
    // ~38,000 characters of statutory prose full of quotation marks, the
    // payload spans eight fields, and `normalizePayload` refuses a partial
    // salvage — so one stray character costs the entire analysis of one
    // measure, and on a 32B model that is a long time to spend on nothing.
    const repaired = parseJsonWithRepair(candidate);
    if (!repaired) {
      return {
        ok: false,
        failure: {
          reason: truncated ? 'truncated' : 'parse_error',
          ...context,
          // The ORIGINAL error, not the post-repair one: it describes what the
          // model actually produced, where the other describes a string that
          // was never sent.
          detail: describeParseError(originalParseError(candidate)),
        },
      };
    }

    if (repaired.applied.length > 0) {
      // At `warn`, not silently. The model emitting invalid JSON is a defect
      // worth seeing even when it is survivable, and knowing WHICH class fired
      // is what tells you whether the prompt or the source text is at fault.
      this.logger.warn(
        {
          externalId: prop.externalId,
          repaired: repaired.applied,
          candidateChars: candidate.length,
          repairedChars: repaired.repairedChars,
        },
        `Proposition analysis: recovered ${prop.externalId} — the model's ` +
          `JSON was invalid, the content was intact. Repaired: ` +
          `${repaired.applied.map((c: JsonRepairClass) => REPAIR_LABELS[c]).join(' and ')}.`,
      );
    }

    const parsed = repaired.value as Partial<AnalysisPayload>;

    // Propositions are verbose and the payload spans ~8 fields, so partial
    // salvage is not useful — a half-populated analysis leaves UI sections
    // empty in unpredictable ways. Refusing is still right; being quiet
    // about it was not.
    const payload = this.normalizePayload(parsed, prop);
    if (!payload) {
      return { ok: false, failure: { reason: 'no_summary', ...context } };
    }

    return { ok: true, payload, promptHash, promptVersion };
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

    const claims = this.normalizeClaims(
      Array.isArray(parsed.analysisClaims) ? parsed.analysisClaims : [],
      prop.fullText ?? '',
      clamp,
    );

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
  /**
   * Turn the model's claims into citations, deriving offsets from the quote.
   *
   * Under the quote-then-locate contract (#1212) the model emits a verbatim
   * `sourceQuote` and no offsets, because offsets are arithmetic over tokens
   * and it cannot do them — measured anchoring under the old contract was 2%.
   * Code locates the quote instead, exactly as `normalizeSections` below
   * already does for section headings ("LLMs cannot count characters
   * precisely"). The locator is shared with the eval harness via
   * @opuspopuli/common so the measured rate describes this code path.
   *
   * Fails CLOSED. A quote that cannot be located is dropped rather than
   * rendered, matching the petition-verification precedent where an unmatched
   * scan degrades to unverified instead of guessing. The old contract's
   * behaviour — clamping asserted offsets into range — is what let a cited
   * span of `1240..5400` silently become `1240..2799` and render as precise
   * attribution, so it is never applied to a quoted claim.
   *
   * Claims produced under the OLD contract (no `sourceQuote`) keep the legacy
   * clamped path, so rows generated before the cutover still render while
   * regeneration is pending.
   */
  private normalizeClaims(
    raw: unknown[],
    fullText: string,
    clamp: (n: number | undefined) => number,
  ): PropositionAnalysisClaim[] {
    const valid = raw.filter(
      (c): c is PropositionAnalysisClaim =>
        !!c &&
        typeof c === 'object' &&
        typeof (c as PropositionAnalysisClaim).claim === 'string' &&
        typeof (c as PropositionAnalysisClaim).field === 'string',
    );

    // Which contract produced this payload. Decided per PAYLOAD, not per
    // claim: one template generates all of them, so a single quoted claim
    // means the rest were meant to be quoted too. Without this, a model on
    // the quoted contract that ignored the instruction and emitted offsets
    // for one claim would fall through to the legacy clamped path and get a
    // precise-looking citation from an asserted span — exactly the defect
    // #1212 removes. Non-compliance is not hypothetical: 25-48% of quotes
    // carried an ellipsis the template forbade.
    const quotedContract = valid.some((c) => !!c.sourceQuote?.trim());

    const out: PropositionAnalysisClaim[] = [];
    let unlocatable = 0;
    let redacted = 0;

    for (const c of valid) {
      const quote = c.sourceQuote?.trim();

      if (!quote) {
        if (quotedContract) {
          // Quoted contract, but this claim carries no quote. There is
          // nothing to verify against, so it cannot be a citation.
          unlocatable++;
          continue;
        }
        // Legacy offsets contract — unchanged behaviour.
        const legacy = {
          claim: c.claim,
          field: c.field,
          sourceStart: clamp(c.sourceStart),
          sourceEnd: clamp(c.sourceEnd),
          confidence: c.confidence,
        };
        if (legacy.sourceEnd > legacy.sourceStart) out.push(legacy);
        continue;
      }

      // A verbatim quote copies whatever it cites. Measured citation zones
      // put 2-5% of citations in the AG transmittal letter, which is exactly
      // where full_text carries proponent postal addresses, emails and phone
      // numbers unredacted (#1263). Under the offsets contract those were
      // fabricated positions; under this one they would be a disclosure path
      // into analysis_claims and onto the public page. Refuse rather than
      // redact: a citation that cannot be shown in full is not a citation.
      // Scan the claim text as well as the quote. The claim is model-written
      // FROM the same source, so it can restate a proponent's email or phone
      // in its own words even when the quoted span is clean — checking only
      // the quote would leave the shorter path to disclosure open.
      if (
        findContactDetails(quote).length > 0 ||
        findContactDetails(c.claim).length > 0
      ) {
        redacted++;
        continue;
      }

      const located = locateQuote(quote, fullText);
      if (!located) {
        unlocatable++;
        continue;
      }

      out.push({
        claim: c.claim,
        field: c.field,
        sourceStart: located.start,
        sourceEnd: located.end,
        sourceQuote: quote,
        verified: true,
        confidence: c.confidence,
      });
    }

    if (unlocatable > 0 || redacted > 0) {
      this.logger.warn(
        `Claim citations dropped: ${unlocatable} unlocatable, ${redacted} ` +
          `containing contact details (of ${valid.length} claims)`,
      );
    }

    return out;
  }

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
