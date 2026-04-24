import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { CommitteeAssignment, ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  extractFieldString,
  extractJsonObjectSlice,
} from './llm-json-salvage.util';

/** Minimal shape of a representative needed to render a committee summary. */
interface RepForSummary {
  id: string;
  name: string;
  chamber: string;
  committees: CommitteeAssignment[];
}

/**
 * Generates AI committee-assignment summaries for representatives — a short
 * preamble that renders above the full committee list on the detail page,
 * describing the POLICY AREAS the assignments touch (never characterizing
 * what the rep "cares about" or their priorities).
 *
 * Tunable via env vars:
 * - COMMITTEE_SUMMARY_GENERATOR_MAX_TOKENS (default 200)
 * - COMMITTEE_SUMMARY_GENERATOR_CONCURRENCY (default 1)
 * - COMMITTEE_SUMMARY_GENERATOR_MAX_REPS (default unlimited) — cap in dev so
 *   end-to-end plumbing can be verified on 5 reps instead of the full roster.
 *
 * Design: DB-driven candidate selection, NOT tied to the fetch batch.
 * A scrape might fail or only return part of a chamber (e.g., Senate-only
 * when Assembly breaks), but the committee data we want to summarize is
 * already in the DB from prior scrapes. Reading candidates from the DB
 * makes this job resilient to scrape flakes and lets the summary pass
 * run even when no reps actually changed in a given sync cycle.
 */
@Injectable()
export class CommitteeSummaryGeneratorService {
  private readonly logger = new Logger(CommitteeSummaryGeneratorService.name);
  private readonly maxTokens: number;
  private readonly concurrency: number;
  private readonly maxReps?: number;

  constructor(
    @Optional()
    private readonly config?: ConfigService,
    @Optional()
    private readonly promptClient?: PromptClientService,
    @Optional()
    @Inject('LLM_PROVIDER')
    private readonly llm?: ILLMProvider,
    @Optional()
    private readonly db?: DbService,
  ) {
    this.maxTokens = this.readPositiveInt(
      'COMMITTEE_SUMMARY_GENERATOR_MAX_TOKENS',
      200,
    );
    this.concurrency = this.readPositiveInt(
      'COMMITTEE_SUMMARY_GENERATOR_CONCURRENCY',
      1,
    );
    this.maxReps = this.readOptionalPositiveInt(
      'COMMITTEE_SUMMARY_GENERATOR_MAX_REPS',
    );
  }

  /**
   * Query the DB for representatives that have committees but no summary,
   * generate summaries for up to `cap` candidates, and persist the
   * result directly to the DB. Idempotent: reruns are no-ops once all
   * candidates are summarized.
   *
   * @param maxRepsOverride — per-call cap that takes precedence over the
   *   COMMITTEE_SUMMARY_GENERATOR_MAX_REPS env default. Wired to the
   *   syncRegionData mutation's `maxReps` arg.
   */
  async generateMissingSummaries(maxRepsOverride?: number): Promise<void> {
    if (!this.promptClient || !this.llm || !this.db) {
      return;
    }

    const cap =
      maxRepsOverride && maxRepsOverride > 0 ? maxRepsOverride : this.maxReps;

    // Filter by JSON shape in code rather than in the DB: Prisma's JSON
    // filters don't cleanly express "array is non-empty", and the dataset
    // is small enough (O(hundreds)) that a single indexed scan is fine.
    const pending = await this.db.representative.findMany({
      where: {
        deletedAt: null,
        committeesSummary: null,
      },
      select: { id: true, name: true, chamber: true, committees: true },
      orderBy: { lastName: 'asc' },
    });

    const candidates: RepForSummary[] = pending
      .map(
        (p: {
          id: string;
          name: string;
          chamber: string;
          committees: unknown;
        }) => ({
          id: p.id,
          name: p.name,
          chamber: p.chamber,
          committees: Array.isArray(p.committees)
            ? (p.committees as CommitteeAssignment[])
            : [],
        }),
      )
      .filter((p: RepForSummary) => p.committees.length > 0)
      .slice(0, cap ?? Number.POSITIVE_INFINITY);

    if (candidates.length === 0) {
      return;
    }

    const capSource =
      maxRepsOverride && maxRepsOverride > 0 ? 'mutation arg' : 'env default';
    const capNote = cap ? ` (cap ${capSource}=${cap})` : '';
    this.logger.log(
      `Generating AI committee summaries for ${candidates.length} representatives${capNote} (concurrency=${this.concurrency}, maxTokens=${this.maxTokens})`,
    );

    let succeeded = 0;
    for (let i = 0; i < candidates.length; i += this.concurrency) {
      const batch = candidates.slice(i, i + this.concurrency);
      const results = await Promise.all(
        batch.map((rep) => this.tryGenerateAndPersist(rep)),
      );
      succeeded += results.filter(Boolean).length;
    }

    this.logger.log(
      `Generated ${succeeded}/${candidates.length} committee summaries successfully`,
    );
  }

  /** Generate + persist a summary for one rep; swallow errors. */
  private async tryGenerateAndPersist(rep: RepForSummary): Promise<boolean> {
    try {
      const summary = await this.generateSummary(rep);
      if (!summary) return false;
      await this.db!.representative.update({
        where: { id: rep.id },
        data: { committeesSummary: summary },
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Committee summary generation failed for ${rep.name}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async generateSummary(
    rep: RepForSummary,
  ): Promise<string | undefined> {
    const structuredText = this.formatRepData(rep);

    const { promptText } = await this.promptClient!.getDocumentAnalysisPrompt({
      documentType: 'representative-committees-summary',
      text: structuredText,
    });

    const result = await this.llm!.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: 0.2,
    });

    return this.parseSummaryFromResponse(result.text);
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

  /**
   * Format the committee data as key-value text for the prompt. Deliberately
   * narrower than the bio prompt: we want the summary grounded only in
   * assignments, so we omit bio/party/district context.
   */
  private formatRepData(rep: RepForSummary): string {
    const committeeLines = rep.committees
      .map((c) => {
        const rolePrefix = c.role ? `${c.role}: ` : '';
        return `  - ${rolePrefix}${c.name}`;
      })
      .join('\n');
    return [
      `Name: ${rep.name}`,
      `Chamber: ${rep.chamber}`,
      `Committee Assignments:\n${committeeLines}`,
    ].join('\n');
  }

  /**
   * Two-tier parse mirroring the bio generator so a malformed/truncated JSON
   * response still yields a usable summary.
   */
  private parseSummaryFromResponse(text: string): string | undefined {
    // Tier 1: full JSON parse
    const candidate = extractJsonObjectSlice(text);
    if (candidate) {
      try {
        const parsed = JSON.parse(candidate) as { summary?: string };
        const summary = parsed.summary?.trim();
        if (summary && summary.length > 0) return summary;
      } catch {
        // fall through to Tier 2
      }
    }

    // Tier 2: extract the summary string directly. Summaries are much
    // shorter than bios, so the salvage-length threshold is tighter.
    const salvaged = extractFieldString(text, 'summary', 20);
    if (salvaged && salvaged.length > 0) {
      this.logger.debug(
        `Committee summary tier-2 salvage: extracted ${salvaged.length}-char summary from ${text.length}-char response`,
      );
      return salvaged;
    }

    const head = text.slice(0, 80).replaceAll('\n', ' ');
    const tail = text.slice(-80).replaceAll('\n', ' ');
    this.logger.debug(
      `Committee summary parse failed entirely: ${text.length}-char response. Head: "${head}..." Tail: "...${tail}"`,
    );
    return undefined;
  }
}
