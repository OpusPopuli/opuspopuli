import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { ILLMProvider } from '@opuspopuli/llm-provider';
import {
  PromptClientService,
  type BriefingSummaryParams,
} from '@opuspopuli/prompt-client';
import { BriefingSummaryValidatorService } from './briefing-summary-validator.service';

/**
 * Cache TTL — 24 hours. Briefing data updates daily as the underlying
 * feed rerank job runs; a longer TTL would stale the paragraph past
 * the count summary below it. A shorter TTL would blow the LLM budget
 * for users who revisit several times a day.
 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Input the resolver hands to the service when it needs a summary.
 * `firstName` is the only T1 field; the rest are non-sensitive aggregates
 * derived from the user's already-rendered briefing data.
 */
export interface BriefingSummaryContext {
  readonly language: 'en' | 'es';
  readonly firstName: string | null;
  readonly billCount: number;
  readonly repCount: number;
  readonly committeeCount: number;
  readonly propositionCount: number;
  readonly urgentBillCount: number;
  readonly topBillTopAxis:
    | 'directMaterial'
    | 'valuesAlignment'
    | 'actionability'
    | null;
}

/**
 * Cache hit / miss / generated-and-cached. Surfaces in telemetry so we
 * can monitor LLM cost + validator drop rate without trusting log greps.
 */
export type BriefingSummaryOutcome =
  | { kind: 'cache_hit'; text: string }
  | { kind: 'coalesced'; text: string | null }
  | { kind: 'generated'; text: string; tokensOut: number }
  | { kind: 'skipped_by_llm'; reason: string }
  | { kind: 'validator_rejected'; reason: string }
  | { kind: 'llm_failed' }
  | { kind: 'malformed_output' };

/**
 * Persistent (user, language) -> LLM-polished briefing-summary paragraph
 * cache, with the inline LLM call + commitment-4 validator pipeline
 * (#849 Phase 2).
 *
 * On any failure path the public `getOrGenerate` returns `null` rather
 * than throwing — the resolver returns the null to the frontend, which
 * silently falls back to the Phase 1 deterministic template. The
 * greeting block NEVER breaks even when the LLM is down, the validator
 * rejects every output, or the prompt-service is unreachable.
 *
 * Cost guard: we use the existing CostBudgetService pattern from
 * LlmRerankService for the rerank flow; briefing-summary is a single
 * call per user per day per language, which is two orders of magnitude
 * cheaper than the per-bill rerank — no per-user budget gate needed in
 * v1. If usage grows, add one before the LLM call below.
 */
@Injectable()
export class BriefingSummaryService {
  private readonly logger = new Logger(BriefingSummaryService.name);

  /**
   * In-flight generations keyed by `${userId}:${language}`. Two
   * concurrent first-paint requests for the same user would otherwise
   * each fire a 5-15s LLM call and race to write the cache; coalescing
   * means the second caller awaits the first instead. Cleaned up in a
   * `.finally()` so a thrown generate never poisons the map.
   *
   * Single-instance scope is fine — the knowledge service runs one
   * pod; if we ever scale horizontally, swap to a Redis lock keyed on
   * the same string.
   */
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly db: DbService,
    private readonly promptClient: PromptClientService,
    private readonly validator: BriefingSummaryValidatorService,
    @Inject('LLM_PROVIDER') private readonly llm: ILLMProvider,
  ) {}

  /**
   * Return a cached briefing-summary paragraph for (userId, language),
   * or generate + cache one in line. Returns `null` on any failure path
   * so the caller (resolver) lets the frontend fall back to the
   * deterministic Phase 1 template.
   *
   * Concurrent calls for the same `(userId, language)` are coalesced
   * via the `inFlight` map — only the first one fires the LLM; the
   * rest await its result so we don't double-spend tokens on a race.
   */
  async getOrGenerate(
    userId: string,
    context: BriefingSummaryContext,
  ): Promise<string | null> {
    const expectedHash = await this.fetchExpectedTemplateHash();

    const cached = await this.readCache(userId, context.language, expectedHash);
    if (cached) {
      this.logTelemetry(userId, context.language, {
        kind: 'cache_hit',
        text: cached,
      });
      return cached;
    }

    const key = `${userId}:${context.language}`;
    const inFlight = this.inFlight.get(key);
    if (inFlight) {
      // A peer request is already generating for this user/language —
      // await its result rather than firing a second LLM call.
      const text = await inFlight;
      this.logTelemetry(userId, context.language, {
        kind: 'coalesced',
        text,
      });
      return text;
    }

    const promise = this.generate(userId, context, expectedHash).then(
      (outcome) => {
        this.logTelemetry(userId, context.language, outcome);
        return outcome.kind === 'generated' ? outcome.text : null;
      },
    );
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * Fetch the current prompt-service template hash so the cache read
   * can compare. Best-effort: on prompt-service failure we return
   * undefined and `readCache` skips the hash check (TTL still
   * governs). Caller-side mismatch ≠ catastrophe; the next call
   * regenerates against the fresh template.
   */
  private async fetchExpectedTemplateHash(): Promise<string | undefined> {
    try {
      // Cheap-ish probe — the prompt-service caches templates per
      // node. We don't render a full prompt here, just touch the
      // template metadata. If this becomes a hot path, switch to a
      // dedicated `getTemplateHash(name)` API.
      const probe = await this.promptClient.getBriefingSummaryPrompt({
        language: 'en',
        billCount: 0,
        repCount: 0,
        committeeCount: 0,
        propositionCount: 0,
        urgentBillCount: 0,
      });
      return probe.promptHash ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Cache lookup with expiry check + template-hash invalidation.
   * Returns null on:
   *   - miss
   *   - expired row (past TTL)
   *   - templateHash mismatch (prompt-service template was rephrased
   *     since the row was written — the cached paragraph references
   *     instructions that no longer apply, so regenerate)
   *   - any DB error (so a flaky cache never breaks the page).
   *
   * When `expectedHash` is undefined (probe failed), the hash check
   * is skipped — TTL still governs staleness.
   */
  private async readCache(
    userId: string,
    language: 'en' | 'es',
    expectedHash: string | undefined,
  ): Promise<string | null> {
    try {
      const row = await this.db.briefingSummaryCache.findUnique({
        where: { userId_language: { userId, language } },
      });
      if (!row) return null;
      if (row.expiresAt.getTime() <= Date.now()) return null;
      if (
        expectedHash !== undefined &&
        row.templateHash !== null &&
        row.templateHash !== expectedHash
      ) {
        // Prompt template was rephrased upstream — invalidate.
        return null;
      }
      return row.summaryText;
    } catch (err) {
      this.logger.warn(
        {
          event: 'briefing_summary_cache_read_failed',
          userId,
          err: String(err),
        },
        'Cache read failed; treating as miss',
      );
      return null;
    }
  }

  /**
   * The full prompt → LLM → validate → cache pipeline. Each failure
   * mode collapses to a typed outcome so the caller can return the
   * Phase 1 fallback uniformly.
   */
  private async generate(
    userId: string,
    context: BriefingSummaryContext,
    expectedHash: string | undefined,
  ): Promise<BriefingSummaryOutcome> {
    const params = this.contextToParams(context);

    let promptText: string;
    let templateHash: string | null = expectedHash ?? null;
    try {
      const prompt = await this.promptClient.getBriefingSummaryPrompt(params);
      promptText = prompt.promptText;
      // The just-fetched hash supersedes the probe hash for cache
      // writes — captures any race where the template changed between
      // the probe and this call.
      templateHash = prompt.promptHash ?? expectedHash ?? null;
    } catch (err) {
      this.logger.warn(
        {
          event: 'briefing_summary_prompt_fetch_failed',
          userId,
          err: String(err),
        },
        'prompt-service unreachable; falling back to template',
      );
      return { kind: 'llm_failed' };
    }

    let raw: string;
    let tokensOut = 0;
    try {
      const response = await this.llm.generate(promptText);
      raw = response.text;
      // ILLMProvider returns a single `tokensUsed` counter rather than
      // the prompt-vs-completion split. Persist it as `tokensOut`
      // (the cost-driver number) so dashboards have one comparable
      // value across all caches; we dropped the `tokensIn` column
      // rather than write a dead `0` forever.
      tokensOut = response.tokensUsed ?? 0;
    } catch (err) {
      this.logger.warn(
        { event: 'briefing_summary_llm_failed', userId, err: String(err) },
        'LLM call failed; falling back to template',
      );
      return { kind: 'llm_failed' };
    }

    const parsed = this.parseLlmJson(raw);
    if (!parsed) return { kind: 'malformed_output' };
    if ('skip' in parsed)
      return { kind: 'skipped_by_llm', reason: parsed.reason };

    const validation = this.validator.validate(parsed.paragraph, {
      language: context.language,
    });
    if (!validation.valid) {
      return {
        kind: 'validator_rejected',
        reason: validation.rejectionReason ?? 'unknown',
      };
    }

    await this.writeCache(
      userId,
      context.language,
      parsed.paragraph,
      templateHash,
      tokensOut,
    );

    return { kind: 'generated', text: parsed.paragraph, tokensOut };
  }

  /**
   * Map the resolver-level context onto the prompt-client params. The
   * mapping is straight; the only conditional is null vs string for
   * `firstName` since the prompt template branches the no-name register
   * on the presence/absence of the value.
   */
  private contextToParams(
    context: BriefingSummaryContext,
  ): BriefingSummaryParams {
    return {
      language: context.language,
      firstName: context.firstName ?? undefined,
      billCount: context.billCount,
      repCount: context.repCount,
      committeeCount: context.committeeCount,
      propositionCount: context.propositionCount,
      urgentBillCount: context.urgentBillCount,
      topBillTopAxis: context.topBillTopAxis ?? undefined,
    };
  }

  /**
   * Parse the LLM's JSON response into one of the two shapes the
   * template promises: `{ paragraph: string }` or `{ skip: true, reason: string }`.
   * Returns null on any parse failure so the caller can fall back.
   */
  private parseLlmJson(
    raw: string,
  ): { paragraph: string } | { skip: true; reason: string } | null {
    const trimmed = raw.trim();
    let candidate: unknown;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      // Some models wrap JSON in ```json fences despite our instructions.
      // Strip + retry once before giving up.
      const stripped = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      try {
        candidate = JSON.parse(stripped);
      } catch {
        return null;
      }
    }
    if (!candidate || typeof candidate !== 'object') return null;
    const obj = candidate as Record<string, unknown>;
    if (obj.skip === true) {
      return {
        skip: true,
        reason: typeof obj.reason === 'string' ? obj.reason : 'unspecified',
      };
    }
    if (typeof obj.paragraph === 'string' && obj.paragraph.trim().length > 0) {
      return { paragraph: obj.paragraph };
    }
    return null;
  }

  /**
   * Upsert the cache row. Wrapped in try/catch so a cache write failure
   * still surfaces the just-generated paragraph to the user — the next
   * load will simply regenerate, which is wasteful but not broken.
   */
  private async writeCache(
    userId: string,
    language: 'en' | 'es',
    summaryText: string,
    templateHash: string | null,
    tokensOut: number,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
    try {
      await this.db.briefingSummaryCache.upsert({
        where: { userId_language: { userId, language } },
        create: {
          userId,
          language,
          summaryText,
          templateHash,
          tokensOut,
          expiresAt,
        },
        update: {
          summaryText,
          templateHash,
          tokensOut,
          computedAt: new Date(),
          expiresAt,
        },
      });
    } catch (err) {
      this.logger.warn(
        {
          event: 'briefing_summary_cache_write_failed',
          userId,
          err: String(err),
        },
        "Cache write failed; this run's output served but next load will regenerate",
      );
    }
  }

  /**
   * Centralized telemetry so cache hit-rate, validator drop-rate, and
   * LLM cost can be alerted on without log-grep heuristics. Same event
   * shape across outcomes for cleaner dashboards.
   */
  private logTelemetry(
    userId: string,
    language: 'en' | 'es',
    outcome: BriefingSummaryOutcome,
  ): void {
    this.logger.log(
      {
        event: 'briefing_summary',
        userId,
        language,
        kind: outcome.kind,
        ...(outcome.kind === 'generated'
          ? { tokensOut: outcome.tokensOut }
          : {}),
        ...(outcome.kind === 'skipped_by_llm' ||
        outcome.kind === 'validator_rejected'
          ? { reason: outcome.reason }
          : {}),
      },
      `briefing-summary ${userId} ${language} -> ${outcome.kind}`,
    );
  }
}
