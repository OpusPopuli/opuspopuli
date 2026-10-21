import { Injectable, Logger } from '@nestjs/common';
import {
  extractFieldString,
  extractJsonObjectSlice,
  type CommitteeAssignment,
} from '@opuspopuli/common';
import {
  memberCommitteeNames,
  namedRoleGroups,
  renderRoleClause,
  ROLE_CLAIM,
} from './committee-roles';
import { readOptionalPositiveInt, readPositiveInt } from './config-helpers';
import { extractLastName } from './region.service';
import { AiOutputProvenance, LlmGeneratorBase } from './llm-generator.base';

/**
 * The sync's sentinel for "could not resolve a region id".
 *
 * Shared with the bio generator's scope resolution; scoping a query on it
 * matches nothing at all rather than everything.
 */
const UNRESOLVED_REGION = 'unknown';

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
export class CommitteeSummaryGeneratorService extends LlmGeneratorBase {
  private readonly logger = new Logger(CommitteeSummaryGeneratorService.name);
  // Field initializers run after super(), so this.config is already set.
  private readonly maxTokens = readPositiveInt(
    this.config,
    'COMMITTEE_SUMMARY_GENERATOR_MAX_TOKENS',
    200,
  );
  private readonly concurrency = readPositiveInt(
    this.config,
    'COMMITTEE_SUMMARY_GENERATOR_CONCURRENCY',
    1,
  );
  private readonly maxReps = readOptionalPositiveInt(
    this.config,
    'COMMITTEE_SUMMARY_GENERATOR_MAX_REPS',
  );

  /**
   * Query the DB for representatives that have committees but no summary,
   * generate summaries for up to `cap` candidates, and persist the
   * result directly to the DB. Idempotent: reruns are no-ops once all
   * candidates are summarized.
   *
   * @param regionId - Scopes candidate selection to the region being synced.
   * @param maxRepsOverride — per-call cap that takes precedence over the
   *   COMMITTEE_SUMMARY_GENERATOR_MAX_REPS env default. Wired to the
   *   syncRegionData mutation's `maxReps` arg.
   */
  async generateMissingSummaries(
    regionId?: string,
    maxRepsOverride?: number,
  ): Promise<void> {
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
        // Scoped to the region being synced, for the reason #1394 gives for
        // the bio generator: unscoped, a California sync summarises another
        // region's reps, and the prompt is handed this chamber's context.
        // Latent rather than observed only because the one other enabled
        // region has no committee data scraped yet.
        //
        // `'unknown'` is the sync's sentinel for an unresolved region
        // (`regionId ?? provider.getName?.() ?? 'unknown'`). Scoping on it
        // matches no row, which would silently summarise nothing — the
        // failure #1394 documents for bios on the `run-rep-sync` path.
        ...(regionId && regionId !== UNRESOLVED_REGION ? { regionId } : {}),
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
      const generated = await this.generateSummary(rep);
      if (!generated) return false;
      // Explicit nulls, not omission: Prisma reads `undefined` as "leave
      // alone", which on a re-summarised rep would keep a previous run's AI
      // attribution against text that is now wholly deterministic.
      const { provenance } = generated;
      await this.db!.representative.update({
        where: { id: rep.id },
        data: {
          committeesSummary: generated.summary,
          committeesSummaryPromptHash: provenance?.promptHash ?? null,
          committeesSummaryPromptVersion: provenance?.promptVersion ?? null,
          committeesSummaryLlmModel: provenance?.llmModel ?? null,
          committeesSummaryLlmDigest: provenance?.llmModelDigest ?? null,
        },
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Committee summary generation failed for ${rep.name}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async generateSummary(rep: RepForSummary): Promise<
    | {
        summary: string;
        /** Null when no model output survived into `summary`. */
        provenance: AiOutputProvenance | null;
      }
    | undefined
  > {
    // The split (#1393): roles come from the structured fields, policy areas
    // from the model, and the model is never shown a role.
    const roleGroups = namedRoleGroups(rep.committees);
    const memberNames = memberCommitteeNames(rep.committees);
    const roleClause = renderRoleClause(extractLastName(rep.name), roleGroups);

    // A rep with nothing but named roles has no policy sentence to write, so
    // there is no call to make and no prompt to fetch. The role clause alone
    // is a complete summary.
    let policySentence = '';
    let provenance: AiOutputProvenance | null = null;
    if (memberNames.length > 0) {
      const prompt = await this.promptClient!.getDocumentAnalysisPrompt({
        documentType: 'representative-committees-summary',
        text: this.formatRepData(rep, memberNames),
      });
      const result = await this.llm!.generate(prompt.promptText, {
        maxTokens: this.maxTokens,
        temperature: 0.2,
      });
      policySentence = this.withoutRoleClaims(
        rep,
        this.parseSummaryFromResponse(result.text) ?? '',
      );
      // Only when the model's sentence actually SURVIVES. If the guard
      // discarded it, every stored word came from `renderRoleClause`, and
      // attributing deterministic text to a prompt and a model is the
      // misattribution `clearedAiAttribution` exists to prevent — pointing
      // the wrong way. "A model wrote this" must not be recorded of text a
      // model did not write.
      if (policySentence) provenance = await this.outputProvenance(prompt);
    }

    const summary = [policySentence, roleClause]
      .filter((part) => part.length > 0)
      .join(' ');
    if (!summary) return undefined;

    return { summary, provenance };
  }

  /**
   * Discard a policy sentence that claims a role (#1393).
   *
   * The prompt is handed committee names with no roles attached, so any role
   * word in its output is invented — there was nothing to read it from. The
   * deterministic clause carries the real roles, so dropping the sentence
   * loses a summary of policy areas and keeps every true statement; the
   * alternative is publishing a chairmanship nobody holds.
   *
   * Instructing against it is not enough on its own: that was the lesson of
   * three prior revisions. See `bio-source-guard.ts` for the same reasoning.
   */
  private withoutRoleClaims(rep: RepForSummary, sentence: string): string {
    if (!sentence || !ROLE_CLAIM.test(sentence)) return sentence;

    this.logger.warn(
      `Committee summary for ${rep.name}: discarded the policy sentence, ` +
        `which claimed a role it was never given — ` +
        JSON.stringify(sentence),
    );
    return '';
  }

  /**
   * Format the prompt input: the MEMBERSHIP committee names only.
   *
   * Deliberately narrower than the bio prompt — no bio, party or district, so
   * the sentence is grounded only in assignments — and narrower again than
   * before #1393: **no roles**. Roles are rendered from the structured fields
   * by {@link renderRoleClause}, and withholding them here is what makes a
   * false role claim unreachable rather than merely discouraged.
   *
   * The chamber is still passed: it is the one piece of context that stops a
   * bare committee name being read as some other body's.
   */
  private formatRepData(rep: RepForSummary, memberNames: string[]): string {
    const committeeLines = memberNames.map((name) => `  - ${name}`).join('\n');
    return [
      `Name: ${rep.name}`,
      `Chamber: ${rep.chamber}`,
      `Committee Memberships:\n${committeeLines}`,
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
