import { Injectable, Logger } from '@nestjs/common';
import { extractJsonObjectSlice } from '@opuspopuli/common';
import type {
  MinutesSummaryClaim,
  MinutesSummaryClaimKind,
  MinutesSummaryResult,
} from '@opuspopuli/common';
import { Prisma } from '@opuspopuli/relationaldb-provider';
import { readOptionalPositiveInt, readPositiveInt } from './config-helpers';
import { LlmGeneratorBase } from './llm-generator.base';

const VALID_KINDS = new Set<MinutesSummaryClaimKind>([
  'decision',
  'concern',
  'controversy',
  'public_comment',
  'disclosure',
]);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);

/** Minimal projection the summarizer reads from a Minutes row. */
interface MinutesForSummary {
  id: string;
  externalId: string;
  body: string;
  date: Date;
  rawText: string | null;
  summary: string | null;
}

/**
 * Generates a plain-English synopsis + structured claims for meeting minutes
 * (daily journals / weekly histories), writing `Minutes.summary` and
 * `Minutes.summaryClaims`. Mirrors {@link PropositionAnalysisService}: read
 * source text → prompt-service template → LLM → JSON-salvage + normalize →
 * write JSONB. Idempotency is by `summary IS NULL` (or `force`) — minutes has
 * no prompt-hash column, so an explicit regenerate uses `force`. See #813.
 */
@Injectable()
export class MinutesSummaryService extends LlmGeneratorBase {
  private readonly logger = new Logger(MinutesSummaryService.name);
  private readonly maxTokens = readPositiveInt(
    this.config,
    'MINUTES_SUMMARY_MAX_TOKENS',
    2000,
  );
  private readonly concurrency = readPositiveInt(
    this.config,
    'MINUTES_SUMMARY_CONCURRENCY',
    1,
  );
  private readonly maxRows = readOptionalPositiveInt(
    this.config,
    'MINUTES_SUMMARY_MAX_ROWS',
  );
  /**
   * Cap the rawText handed to the LLM to bound cost + stay within context
   * (largest observed journal ~262 KB). One-shot truncation is fine for now;
   * multi-pass is a filed follow-up (#813 out-of-scope).
   */
  private readonly maxInputChars = readPositiveInt(
    this.config,
    'MINUTES_SUMMARY_MAX_INPUT_CHARS',
    60000,
  );

  /**
   * Summarize one minutes row. Skips rows without rawText, and rows already
   * summarized unless `force` is set (used by the regenerate mutation).
   */
  async summarize(minutesId: string, force = false): Promise<boolean> {
    if (!this.promptClient || !this.llm || !this.db) return false;

    const row = await this.db.minutes.findUnique({
      where: { id: minutesId },
      select: {
        id: true,
        externalId: true,
        body: true,
        date: true,
        rawText: true,
        summary: true,
      },
    });
    if (!row) {
      this.logger.warn(`Minutes ${minutesId} not found`);
      return false;
    }
    if (!row.rawText || row.rawText.trim().length === 0) {
      this.logger.debug(`Skipping ${row.externalId}: no rawText to summarize`);
      return false;
    }
    if (!force && row.summary) {
      this.logger.debug(`Skipping ${row.externalId}: summary already present`);
      return false;
    }
    return this.tryGenerateAndPersist(row);
  }

  /**
   * Summarize all active minutes that have rawText but no summary yet. Used
   * by the post-ingest hook (per-row jobs) and the backfill mutation.
   */
  async summarizeMissing(maxRowsOverride?: number): Promise<void> {
    if (!this.promptClient || !this.llm || !this.db) return;

    const cap =
      maxRowsOverride && maxRowsOverride > 0 ? maxRowsOverride : this.maxRows;

    const pending = await this.db.minutes.findMany({
      where: { isActive: true, rawText: { not: null }, summary: null },
      select: {
        id: true,
        externalId: true,
        body: true,
        date: true,
        rawText: true,
        summary: true,
      },
      orderBy: { date: 'desc' },
      take: cap,
    });
    if (pending.length === 0) return;

    this.logger.log(
      `Summarizing ${pending.length} minutes (concurrency=${this.concurrency}, maxTokens=${this.maxTokens})`,
    );

    let succeeded = 0;
    for (let i = 0; i < pending.length; i += this.concurrency) {
      const batch = pending.slice(i, i + this.concurrency);
      const results = await Promise.all(
        batch.map((m) => this.tryGenerateAndPersist(m)),
      );
      succeeded += results.filter(Boolean).length;
    }

    this.logger.log(
      `Summarized ${succeeded}/${pending.length} minutes successfully`,
    );
  }

  private async tryGenerateAndPersist(
    row: MinutesForSummary,
  ): Promise<boolean> {
    try {
      const payload = await this.generateOne(row);
      if (!payload) return false;

      await this.db!.minutes.update({
        where: { id: row.id },
        data: {
          summary: payload.summary,
          summaryClaims: payload.claims as unknown as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Minutes summary failed for ${row.externalId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async generateOne(
    row: MinutesForSummary,
  ): Promise<MinutesSummaryResult | undefined> {
    const { promptText } = await this.promptClient!.getDocumentAnalysisPrompt({
      documentType: 'minutes-summary',
      text: this.formatMinutes(row),
    });

    const result = await this.llm!.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: 0.2,
    });

    // Cost telemetry — the per-row output is capped by maxTokens; log the
    // actual spend so an operator can watch cumulative usage during a
    // backfill. A Prometheus counter / dashboard panel is a fast-follow.
    if (result.tokensUsed != null) {
      this.logger.debug(
        `minutes-summary ${row.externalId}: ${result.tokensUsed} tokens`,
      );
    }

    return this.parsePayload(result.text, row);
  }

  private formatMinutes(row: MinutesForSummary): string {
    const raw = row.rawText ?? '';
    const text =
      raw.length > this.maxInputChars ? raw.slice(0, this.maxInputChars) : raw;
    return [
      `ExternalId: ${row.externalId}`,
      `Body: ${row.body}`,
      `Date: ${row.date.toISOString().slice(0, 10)}`,
      '',
      'MinutesText:',
      text,
    ].join('\n');
  }

  private parsePayload(
    text: string,
    row: MinutesForSummary,
  ): MinutesSummaryResult | undefined {
    const candidate = extractJsonObjectSlice(text);
    if (!candidate) {
      this.logger.debug(
        `Summary parse failed for ${row.externalId}: no JSON object in ${text.length}-char response`,
      );
      return undefined;
    }
    try {
      const parsed = JSON.parse(candidate) as Partial<MinutesSummaryResult>;
      return this.normalize(parsed, row);
    } catch (error) {
      this.logger.debug(
        `Summary JSON.parse failed for ${row.externalId}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  private normalize(
    parsed: Partial<MinutesSummaryResult>,
    row: MinutesForSummary,
  ): MinutesSummaryResult | undefined {
    const summary =
      typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (!summary) {
      // The synopsis is the one field the UI can't recover from — refuse a
      // half-populated result rather than persist an empty summary.
      this.logger.debug(`Summary missing core field for ${row.externalId}`);
      return undefined;
    }
    const claims = Array.isArray(parsed.claims)
      ? (parsed.claims
          .map((c) => this.normalizeClaim(c))
          .filter((c) => c !== null) as MinutesSummaryClaim[])
      : [];
    return { summary, claims };
  }

  private normalizeClaim(c: unknown): MinutesSummaryClaim | null {
    if (!c || typeof c !== 'object') return null;
    const o = c as Record<string, unknown>;
    const kind = o.kind as MinutesSummaryClaimKind;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!VALID_KINDS.has(kind) || !title) return null;

    const citationRaw = (
      o.citation && typeof o.citation === 'object' ? o.citation : {}
    ) as Record<string, unknown>;

    const claim: MinutesSummaryClaim = {
      kind,
      title,
      detail: typeof o.detail === 'string' ? o.detail.trim() : '',
      citation: {
        pageHint:
          typeof citationRaw.pageHint === 'string'
            ? citationRaw.pageHint
            : undefined,
        quote:
          typeof citationRaw.quote === 'string' ? citationRaw.quote : undefined,
      },
    };
    if (Array.isArray(o.billRefs)) {
      claim.billRefs = o.billRefs.filter((b) => typeof b === 'string');
    }
    if (typeof o.severity === 'string' && VALID_SEVERITIES.has(o.severity)) {
      claim.severity = o.severity as MinutesSummaryClaim['severity'];
    }
    return claim;
  }
}
