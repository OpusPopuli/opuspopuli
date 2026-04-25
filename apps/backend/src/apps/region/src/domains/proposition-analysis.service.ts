import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type {
  ILLMProvider,
  PropositionAnalysisClaim,
  PropositionAnalysisSection,
  PropositionExistingVsProposed,
} from '@opuspopuli/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import { extractJsonObjectSlice } from './llm-json-salvage.util';

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
 * - PROPOSITION_ANALYSIS_MAX_TOKENS (default 2000) — ballot text + structured
 *   output needs more headroom than a rep bio.
 * - PROPOSITION_ANALYSIS_CONCURRENCY (default 1)
 * - PROPOSITION_ANALYSIS_MAX_PROPS (default unlimited) — dev cap.
 */
@Injectable()
export class PropositionAnalysisService {
  private readonly logger = new Logger(PropositionAnalysisService.name);
  private readonly maxTokens: number;
  private readonly concurrency: number;
  private readonly maxProps?: number;

  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly promptClient?: PromptClientService,
    @Optional()
    @Inject('LLM_PROVIDER')
    private readonly llm?: ILLMProvider,
    @Optional() private readonly db?: DbService,
  ) {
    this.maxTokens = this.readPositiveInt(
      'PROPOSITION_ANALYSIS_MAX_TOKENS',
      2000,
    );
    this.concurrency = this.readPositiveInt(
      'PROPOSITION_ANALYSIS_CONCURRENCY',
      1,
    );
    this.maxProps = this.readOptionalPositiveInt(
      'PROPOSITION_ANALYSIS_MAX_PROPS',
    );
  }

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

    return this.tryGenerateAndPersist(prop);
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
    for (let i = 0; i < pending.length; i += this.concurrency) {
      const batch = pending.slice(i, i + this.concurrency);
      const results = await Promise.all(
        batch.map((p) => this.tryGenerateAndPersist(p)),
      );
      succeeded += results.filter(Boolean).length;
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

  private async tryGenerateAndPersist(prop: PropForAnalysis): Promise<boolean> {
    try {
      const result = await this.generateOne(prop);
      if (!result) return false;

      await this.db!.proposition.update({
        where: { id: prop.id },
        data: {
          analysisSummary: result.payload.analysisSummary,
          keyProvisions: result.payload
            .keyProvisions as unknown as Prisma.InputJsonValue,
          fiscalImpact: result.payload.fiscalImpact,
          yesOutcome: result.payload.yesOutcome,
          noOutcome: result.payload.noOutcome,
          existingVsProposed: result.payload
            .existingVsProposed as unknown as Prisma.InputJsonValue,
          analysisSections: result.payload
            .analysisSections as unknown as Prisma.InputJsonValue,
          analysisClaims: result.payload
            .analysisClaims as unknown as Prisma.InputJsonValue,
          analysisSource: 'ai-generated',
          analysisPromptHash: result.promptHash,
          analysisGeneratedAt: new Date(),
        },
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Proposition analysis failed for ${prop.externalId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async generateOne(
    prop: PropForAnalysis,
  ): Promise<{ payload: AnalysisPayload; promptHash: string } | undefined> {
    const { promptText, promptHash } =
      await this.promptClient!.getDocumentAnalysisPrompt({
        documentType: 'proposition-analysis',
        text: this.formatPropData(prop),
      });

    const result = await this.llm!.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: 0.2,
    });

    const payload = this.parsePayload(result.text, prop);
    if (!payload) return undefined;
    return { payload, promptHash };
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
   * Parse the LLM response. Propositions are verbose and the payload is
   * structured across ~8 fields, so tier-2 partial salvage isn't useful
   * here — if the JSON doesn't parse cleanly we refuse the result rather
   * than persisting a half-populated analysis that would leave UI sections
   * empty in unpredictable ways.
   */
  private parsePayload(
    text: string,
    prop: PropForAnalysis,
  ): AnalysisPayload | undefined {
    const candidate = extractJsonObjectSlice(text);
    if (!candidate) {
      this.logger.debug(
        `Analysis parse failed for ${prop.externalId}: no JSON object in ${text.length}-char response`,
      );
      return undefined;
    }
    try {
      const parsed = JSON.parse(candidate) as Partial<AnalysisPayload>;
      return this.normalizePayload(parsed, prop);
    } catch (error) {
      this.logger.debug(
        `Analysis JSON.parse failed for ${prop.externalId}: ${(error as Error).message}`,
      );
      return undefined;
    }
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

  private readPositiveInt(envKey: string, fallback: number): number {
    const raw = this.config?.get<string>(envKey);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private readOptionalPositiveInt(envKey: string): number | undefined {
    const raw = this.config?.get<string>(envKey);
    if (!raw) return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
}
