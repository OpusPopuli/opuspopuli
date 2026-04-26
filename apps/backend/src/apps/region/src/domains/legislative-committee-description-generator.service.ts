import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptClientService } from '@opuspopuli/prompt-client';
import type { ILLMProvider } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  extractFieldString,
  extractJsonObjectSlice,
} from './llm-json-salvage.util';

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
 * - LEGISLATIVE_COMMITTEE_DESCRIPTION_CONCURRENCY (default 1)
 * - LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_COMMITTEES (default unlimited;
 *   useful in dev to verify pipeline on a handful before unleashing on
 *   the full ~30-60 committee roster).
 */
@Injectable()
export class LegislativeCommitteeDescriptionGeneratorService {
  private readonly logger = new Logger(
    LegislativeCommitteeDescriptionGeneratorService.name,
  );
  private readonly maxTokens: number;
  private readonly concurrency: number;
  private readonly maxCommittees?: number;

  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly promptClient?: PromptClientService,
    @Optional()
    @Inject('LLM_PROVIDER')
    private readonly llm?: ILLMProvider,
    @Optional() private readonly db?: DbService,
  ) {
    this.maxTokens = this.readPositiveInt(
      'LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_TOKENS',
      200,
    );
    this.concurrency = this.readPositiveInt(
      'LEGISLATIVE_COMMITTEE_DESCRIPTION_CONCURRENCY',
      1,
    );
    this.maxCommittees = this.readOptionalPositiveInt(
      'LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_COMMITTEES',
    );
  }

  /**
   * Generate descriptions for any active committee that doesn't have one.
   * Idempotent: reruns are no-ops once all committees are described.
   *
   * @param maxOverride — per-call cap that takes precedence over the
   *   LEGISLATIVE_COMMITTEE_DESCRIPTION_MAX_COMMITTEES env default.
   */
  async generateMissingDescriptions(maxOverride?: number): Promise<void> {
    if (!this.promptClient || !this.llm || !this.db) return;

    const cap =
      maxOverride && maxOverride > 0 ? maxOverride : this.maxCommittees;

    const pending = await this.db.legislativeCommittee.findMany({
      where: { deletedAt: null, description: null },
      select: { id: true, name: true, chamber: true },
      orderBy: [{ chamber: 'asc' }, { name: 'asc' }],
      ...(cap ? { take: cap } : {}),
    });

    if (pending.length === 0) return;

    const capSource =
      maxOverride && maxOverride > 0 ? 'mutation arg' : 'env default';
    const capNote = cap ? ` (cap ${capSource}=${cap})` : '';
    this.logger.log(
      `Generating AI descriptions for ${pending.length} legislative committees${capNote} (concurrency=${this.concurrency}, maxTokens=${this.maxTokens})`,
    );

    let succeeded = 0;
    for (let i = 0; i < pending.length; i += this.concurrency) {
      const batch = pending.slice(i, i + this.concurrency);
      const results = await Promise.all(
        batch.map((c) => this.tryGenerateAndPersist(c)),
      );
      succeeded += results.filter(Boolean).length;
    }

    this.logger.log(
      `Generated ${succeeded}/${pending.length} legislative committee descriptions successfully`,
    );
  }

  private async tryGenerateAndPersist(
    committee: CommitteeForDescription,
  ): Promise<boolean> {
    try {
      const description = await this.generateDescription(committee);
      if (!description) return false;
      await this.db!.legislativeCommittee.update({
        where: { id: committee.id },
        data: { description },
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Description generation failed for ${committee.chamber} ${committee.name}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async generateDescription(
    committee: CommitteeForDescription,
  ): Promise<string | undefined> {
    const structuredText = this.formatCommitteeData(committee);

    const { promptText } = await this.promptClient!.getDocumentAnalysisPrompt({
      documentType: 'legislative-committee-description',
      text: structuredText,
    });

    const result = await this.llm!.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: 0.2,
    });

    return this.parseDescriptionFromResponse(result.text);
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
  private parseDescriptionFromResponse(text: string): string | undefined {
    const candidate = extractJsonObjectSlice(text);
    if (candidate) {
      try {
        const parsed = JSON.parse(candidate) as { description?: string | null };
        const description = parsed.description?.trim();
        if (description && description.length > 0) return description;
        // Explicit `null` from the LLM means "name too generic" — bail.
        if (parsed.description === null) return undefined;
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
