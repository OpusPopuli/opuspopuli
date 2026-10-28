import { Injectable, Logger } from '@nestjs/common';
import {
  extractFieldString,
  extractJsonObjectSlice,
  stableHash,
} from '@opuspopuli/common';
import { readOptionalPositiveInt, readPositiveInt } from './config-helpers';
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
const COMMITTEE_DESCRIPTION_GENERATOR_VERSION = 'committee-description-1';

/** The config axis of the skip key: everything that shapes what is stored. */
export function committeeDescriptionConfigHash(maxTokens: number): string {
  return stableHash({
    generator: COMMITTEE_DESCRIPTION_GENERATOR_VERSION,
    maxTokens,
    temperature: 0.2,
  });
}

const DESCRIPTION_TEMPLATE =
  'document-analysis-legislative-committee-description';

const DESCRIPTION_SELECT = {
  id: true,
  name: true,
  chamber: true,
  description: true,
  descriptionPromptHash: true,
  descriptionLlmDigest: true,
  descriptionSourceHash: true,
  descriptionConfigHash: true,
} as const;

interface DescriptionRow extends CommitteeForDescription {
  description: string | null;
  descriptionPromptHash: string | null;
  descriptionLlmDigest: string | null;
  descriptionSourceHash: string | null;
  descriptionConfigHash: string | null;
}

/** Minimal shape of a committee row needed to render a description prompt. */
interface CommitteeForDescription {
  id: string;
  name: string;
  chamber: string;
}

/**
 * Generates AI 2-3 sentence descriptions of what a legislative committee
 * does, anchored only in the chamber + committee name. Uses the
 * `document-analysis-legislative-committee-description` prompt in the
 * prompt-service.
 *
 * DB-driven candidate selection (committees with `description IS NULL`)
 * mirrors the resilience pattern of CommitteeSummaryGeneratorService —
 * resilient to scrape flakes, runs even when no committees actually
 * changed in a given sync cycle.
 *
 * Tunable via env vars:
 * - LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_TOKENS (default 200)
 * - LEGISLATIVE_COMMITTEE_DESCRIPTION_CONCURRENCY (default 1) — the in-process
 *   path only; the sync queues descriptions (`committee-description`)
 * - LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_COMMITTEES (default unlimited;
 *   useful in dev to verify pipeline on a handful before unleashing on
 *   the full ~30-60 committee roster).
 */
@Injectable()
export class LegislativeCommitteeDescriptionGeneratorService extends LlmGeneratorBase {
  private readonly logger = new Logger(
    LegislativeCommitteeDescriptionGeneratorService.name,
  );
  // Field initializers run after super(), so this.config is already set.
  private readonly maxTokens = readPositiveInt(
    this.config,
    'LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_TOKENS',
    200,
  );
  private readonly concurrency = readPositiveInt(
    this.config,
    'LEGISLATIVE_COMMITTEE_DESCRIPTION_CONCURRENCY',
    1,
  );
  private readonly maxCommittees = readOptionalPositiveInt(
    this.config,
    'LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_COMMITTEES',
  );

  /**
   * Committees whose description is stale on some axis, up to `cap`, and how
   * many are current. A legacy description (the live prompt and weights, no
   * input or config hash yet) is stamped current (owner, 2026-10-27). Before
   * Phase B only `description IS NULL` was selected, so a description was
   * never refreshed after a prompt or model change — and a committee the
   * model declined to describe was asked again every run.
   *
   * @param maxOverride - Per-call cap over LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_COMMITTEES
   */
  async selectStale(
    maxOverride?: number,
  ): Promise<{ pending: OutputTarget[]; current: number }> {
    if (!this.promptClient || !this.llm || !this.db) {
      return { pending: [], current: 0 };
    }
    const cap =
      maxOverride && maxOverride > 0 ? maxOverride : this.maxCommittees;
    const rows: DescriptionRow[] = await this.db.legislativeCommittee.findMany({
      where: { deletedAt: null },
      select: DESCRIPTION_SELECT,
      orderBy: [{ chamber: 'asc' }, { name: 'asc' }],
    });
    return partitionStale(rows, {
      assess: (row) => this.assess(row),
      stamp: (row, live) => this.stamp(row.id, live),
      target: (row, key) => ({ id: row.id, key }),
      cap,
    });
  }

  /**
   * One committee's description — the `committee-description` job (S4).
   * Re-checks currency first. A transient LLM failure throws, so the queue
   * retries it.
   */
  async generateOne(id: string): Promise<GeneratedOutputOutcome> {
    if (!this.promptClient || !this.llm || !this.db) return 'skipped';
    const row: DescriptionRow | null =
      await this.db.legislativeCommittee.findFirst({
        where: { id, deletedAt: null },
        select: DESCRIPTION_SELECT,
      });
    if (!row) return 'skipped';
    const { live, currency } = await this.assess(row);
    if (currency !== 'stale') {
      if (currency === 'legacy') await this.stamp(id, live);
      return 'unchanged';
    }

    const generated = await this.generateDescription(row);
    if (!generated) return 'failed';
    if (generated.description === null && row.description) {
      // A decline over a description we already have is the model failing,
      // not a verdict on the committee: keep the text, record no key (which
      // would stamp the old text with this prompt's attribution), ask again.
      return 'failed';
    }
    // A deliberate `null` ("the name is too generic") is RECORDED with its
    // key, so the committee is not asked again until the prompt, model or
    // name changes — the civics `empty` verdict, applied here.
    await this.db.legislativeCommittee.update({
      where: { id },
      data: {
        description: generated.description,
        descriptionPromptHash: generated.provenance.promptHash,
        descriptionPromptVersion: generated.provenance.promptVersion,
        descriptionLlmModel: generated.provenance.llmModel,
        descriptionLlmDigest: generated.provenance.llmModelDigest,
        descriptionSourceHash: live.sourceHash,
        descriptionConfigHash: live.configHash,
        descriptionGeneratedAt: new Date(),
      },
    });
    if (generated.description === null) return 'skipped';
    return row.description ? 'updated' : 'created';
  }

  /**
   * Describe every stale committee in this process — the inline path, when
   * the `committee-description` queue is off, and the admin script.
   */
  async generateMissingDescriptions(maxOverride?: number): Promise<void> {
    const { pending } = await this.selectStale(maxOverride);
    if (pending.length === 0) return;
    this.logger.log(
      `Generating AI descriptions for ${pending.length} legislative committees (concurrency=${this.concurrency}, maxTokens=${this.maxTokens})`,
    );
    await this.generateInProcess(
      pending,
      this.concurrency,
      'legislative committee descriptions',
      (id) => this.generateOne(id),
      this.logger,
    );
  }

  /** The live key — over exactly the prompt's input — and how the stored description compares. */
  private async assess(
    row: DescriptionRow,
  ): Promise<{ live: LiveOutputKey; currency: OutputCurrency }> {
    const live = await this.liveOutputKey(
      DESCRIPTION_TEMPLATE,
      this.formatCommitteeData(row),
      committeeDescriptionConfigHash(this.maxTokens),
    );
    const currency = outputCurrency(
      {
        promptHash: row.descriptionPromptHash,
        llmDigest: row.descriptionLlmDigest,
        sourceHash: row.descriptionSourceHash,
        configHash: row.descriptionConfigHash,
      },
      live,
    );
    return { live, currency };
  }

  /** Record a legacy description's input and config as current (decision 2). */
  private async stamp(id: string, live: LiveOutputKey): Promise<void> {
    await this.db!.legislativeCommittee.update({
      where: { id },
      data: {
        descriptionSourceHash: live.sourceHash,
        descriptionConfigHash: live.configHash,
      },
    });
  }

  private async generateDescription(
    committee: CommitteeForDescription,
  ): Promise<
    | {
        /** Null: the model declined ("the name is too generic"). */
        description: string | null;
        provenance: AiOutputProvenance;
      }
    | undefined
  > {
    const structuredText = this.formatCommitteeData(committee);

    const prompt = await this.promptClient!.getDocumentAnalysisPrompt({
      documentType: 'legislative-committee-description',
      text: structuredText,
    });
    const { promptText } = prompt;

    const result = await this.llm!.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: 0.2,
    });

    const description = this.parseDescriptionFromResponse(result.text);
    if (description === undefined) return undefined;
    return { description, provenance: await this.outputProvenance(prompt) };
  }

  /**
   * Format the committee identity as key-value text for the prompt.
   * Deliberately minimal: chamber + name are the only signals the prompt
   * is allowed to ground in (per its RULE 4).
   */
  private formatCommitteeData(committee: CommitteeForDescription): string {
    return [
      `Chamber: ${committee.chamber}`,
      `Committee Name: ${committee.name}`,
    ].join('\n');
  }

  /**
   * Two-tier parse mirroring the bio + summary generators so a
   * malformed/truncated JSON response still yields a usable description.
   */
  private parseDescriptionFromResponse(
    text: string,
  ): string | null | undefined {
    const candidate = extractJsonObjectSlice(text);
    if (candidate) {
      try {
        const parsed = JSON.parse(candidate) as { description?: string | null };
        const description = parsed.description?.trim();
        if (description && description.length > 0) return description;
        // Explicit `null` from the LLM means "name too generic" — a verdict,
        // recorded, not a failure.
        if (parsed.description === null) return null;
      } catch {
        // fall through to Tier 2
      }
    }

    const salvaged = extractFieldString(text, 'description', 20);
    if (salvaged && salvaged.length > 0) {
      this.logger.debug(
        `Committee description tier-2 salvage: extracted ${salvaged.length}-char description from ${text.length}-char response`,
      );
      return salvaged;
    }

    const head = text.slice(0, 80).replaceAll('\n', ' ');
    const tail = text.slice(-80).replaceAll('\n', ' ');
    this.logger.debug(
      `Committee description parse failed entirely: ${text.length}-char response. Head: "${head}..." Tail: "...${tail}"`,
    );
    return undefined;
  }
}
