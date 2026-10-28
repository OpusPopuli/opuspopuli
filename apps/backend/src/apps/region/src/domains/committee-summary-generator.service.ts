import { Injectable, Logger } from '@nestjs/common';
import {
  extractFieldString,
  extractJsonObjectSlice,
  stableHash,
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
import {
  outputCurrency,
  partitionStale,
  type GeneratedOutputOutcome,
  type LiveOutputKey,
  type OutputCurrency,
  type OutputTarget,
} from './generated-output-key';

/** Bumped when what this generator stores changes shape. */
const COMMITTEE_SUMMARY_GENERATOR_VERSION = 'committee-summary-1';

/** The config axis of the skip key: everything that shapes what is stored. */
export function committeeSummaryConfigHash(maxTokens: number): string {
  return stableHash({
    generator: COMMITTEE_SUMMARY_GENERATOR_VERSION,
    maxTokens,
    temperature: 0.2,
  });
}

const SUMMARY_TEMPLATE = 'document-analysis-representative-committees-summary';

/** The columns a rep's stored summary key is read from. */
const SUMMARY_SELECT = {
  id: true,
  name: true,
  chamber: true,
  committees: true,
  committeesSummary: true,
  committeesSummaryPromptHash: true,
  committeesSummaryLlmDigest: true,
  committeesSummarySourceHash: true,
  committeesSummaryConfigHash: true,
} as const;

interface SummaryRow {
  id: string;
  name: string;
  chamber: string;
  committees: unknown;
  committeesSummary: string | null;
  committeesSummaryPromptHash: string | null;
  committeesSummaryLlmDigest: string | null;
  committeesSummarySourceHash: string | null;
  committeesSummaryConfigHash: string | null;
}

function toRepForSummary(row: SummaryRow): RepForSummary {
  return {
    id: row.id,
    name: row.name,
    chamber: row.chamber,
    committees: Array.isArray(row.committees)
      ? (row.committees as CommitteeAssignment[])
      : [],
  };
}

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
 * - COMMITTEE_SUMMARY_GENERATOR_CONCURRENCY (default 1) — the in-process
 *   path only; the sync queues summaries (`committee-summary`)
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
   * Representatives with committees whose summary is stale on some axis, up
   * to `cap`, and how many are current. A legacy summary (the live prompt and
   * weights, no input or config hash yet) is stamped current (owner,
   * 2026-10-27). Before Phase B a summary was written once and never again —
   * a new committee assignment, prompt or model left it as it was.
   *
   * @param regionId - Scopes selection to the region being synced
   * @param maxRepsOverride - Per-call cap over COMMITTEE_SUMMARY_GENERATOR_MAX_REPS
   */
  async selectStale(
    regionId?: string,
    maxRepsOverride?: number,
  ): Promise<{ pending: OutputTarget[]; current: number }> {
    if (!this.promptClient || !this.llm || !this.db) {
      return { pending: [], current: 0 };
    }
    const cap =
      maxRepsOverride && maxRepsOverride > 0 ? maxRepsOverride : this.maxReps;
    const rows: SummaryRow[] = await this.db.representative.findMany({
      where: {
        deletedAt: null,
        // Scoped to the region being synced (#1394). `'unknown'` is the
        // sync's sentinel for an unresolved region; scoping on it would
        // silently summarise nothing.
        ...(regionId && regionId !== UNRESOLVED_REGION ? { regionId } : {}),
      },
      select: SUMMARY_SELECT,
      orderBy: { lastName: 'asc' },
    });

    return partitionStale(rows, {
      // Filtered in code: Prisma's JSON filters cannot say "non-empty array".
      assess: async (row) => {
        const rep = toRepForSummary(row);
        return rep.committees.length > 0 ? this.assess(rep, row) : undefined;
      },
      stamp: (row, live) => this.stamp(row.id, live),
      target: (row, key) => ({ id: row.id, key }),
      cap,
    });
  }

  /**
   * One rep's summary — the `committee-summary` job (S4). Re-checks currency
   * first. A transient LLM failure throws, so the queue retries it.
   */
  async generateOne(id: string): Promise<GeneratedOutputOutcome> {
    if (!this.promptClient || !this.llm || !this.db) return 'skipped';
    const row: SummaryRow | null = await this.db.representative.findFirst({
      where: { id, deletedAt: null },
      select: SUMMARY_SELECT,
    });
    if (!row) return 'skipped';
    const rep = toRepForSummary(row);
    if (rep.committees.length === 0) return 'skipped';
    const { live, currency } = await this.assess(rep, row);
    if (currency !== 'stale') {
      if (currency === 'legacy') await this.stamp(id, live);
      return 'unchanged';
    }

    const generated = await this.generateSummary(rep);
    if (!generated) return 'failed';
    // Explicit nulls, not omission: Prisma reads `undefined` as "leave
    // alone", which on a re-summarised rep would keep a previous run's AI
    // attribution against text that is now wholly deterministic.
    const { provenance } = generated;
    await this.db.representative.update({
      where: { id },
      data: {
        committeesSummary: generated.summary,
        committeesSummaryPromptHash: provenance?.promptHash ?? null,
        committeesSummaryPromptVersion: provenance?.promptVersion ?? null,
        committeesSummaryLlmModel: provenance?.llmModel ?? null,
        committeesSummaryLlmDigest: provenance?.llmModelDigest ?? null,
        committeesSummarySourceHash: live.sourceHash,
        committeesSummaryConfigHash: live.configHash,
        committeesSummaryGeneratedAt: new Date(),
      },
    });
    return row.committeesSummary ? 'updated' : 'created';
  }

  /**
   * Summarise every stale rep in this process — the inline path, when the
   * `committee-summary` queue is off. The sync queues them otherwise.
   */
  async generateMissingSummaries(
    regionId?: string,
    maxRepsOverride?: number,
  ): Promise<void> {
    const { pending } = await this.selectStale(regionId, maxRepsOverride);
    if (pending.length === 0) return;
    this.logger.log(
      `Generating AI committee summaries for ${pending.length} representatives (concurrency=${this.concurrency}, maxTokens=${this.maxTokens})`,
    );
    await this.generateInProcess(
      pending,
      this.concurrency,
      'committee summaries',
      (id) => this.generateOne(id),
      this.logger,
    );
  }

  /**
   * The live key and how the stored summary compares. The input is the whole
   * assignment list — names AND roles — plus name and chamber: the model sees
   * the names, and the role clause is rendered from the roles, so either
   * changing changes the summary.
   *
   * A summary with no prompt hash is deterministic (a rep holding only named
   * roles: rendered from the data, no model call) and is current on its input
   * and config alone.
   */
  private async assess(
    rep: RepForSummary,
    row: SummaryRow,
  ): Promise<{ live: LiveOutputKey; currency: OutputCurrency }> {
    const live = await this.liveOutputKey(
      SUMMARY_TEMPLATE,
      JSON.stringify({
        name: rep.name,
        chamber: rep.chamber,
        committees: rep.committees,
      }),
      committeeSummaryConfigHash(this.maxTokens),
    );
    const deterministicCurrent =
      row.committeesSummary !== null &&
      row.committeesSummaryPromptHash === null &&
      row.committeesSummarySourceHash === live.sourceHash &&
      row.committeesSummaryConfigHash === live.configHash;
    const currency = deterministicCurrent
      ? 'current'
      : outputCurrency(
          {
            promptHash: row.committeesSummaryPromptHash,
            llmDigest: row.committeesSummaryLlmDigest,
            sourceHash: row.committeesSummarySourceHash,
            configHash: row.committeesSummaryConfigHash,
          },
          live,
        );
    return { live, currency };
  }

  /** Record a legacy summary's input and config as current (decision 2). */
  private async stamp(id: string, live: LiveOutputKey): Promise<void> {
    await this.db!.representative.update({
      where: { id },
      data: {
        committeesSummarySourceHash: live.sourceHash,
        committeesSummaryConfigHash: live.configHash,
      },
    });
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
