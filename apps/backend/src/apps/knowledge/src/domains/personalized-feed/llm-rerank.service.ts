import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { ILLMProvider } from '@opuspopuli/llm-provider';
import {
  PromptClientService,
  type BillRelevanceExplanationParams,
} from '@opuspopuli/prompt-client';
import type { PersonalizationInputDto } from './dto/personalization-input.dto';
import { PersonalizedFeedService } from './personalized-feed.service';
import { ExplanationValidatorService } from './explanation-validator.service';
import { CostBudgetService } from './cost-budget.service';
import { coerceAiSummary, toTrueFlagNames } from './personalized-feed.utils';

/**
 * Default cache TTL (planning-doc cadence: weekly review). The nightly
 * batch (cron, follow-up subtask) will recompute well before this.
 */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Hard cap on bills re-ranked per user per call — keeps LLM spend
 * bounded even before the per-user token-budget service in Subtask 4.
 */
const DEFAULT_CANDIDATE_LIMIT = 20;

/**
 * Shape of the Bill row the rerank loop needs. Selected verbatim from
 * the batch `findMany` so the runtime + compile-time shapes match.
 */
interface CandidateBill {
  id: string;
  regionId: string;
  billNumber: string;
  sessionYear: string;
  title: string;
  aiSummary: unknown;
}

/**
 * Mutable counters threaded through the per-candidate iterations.
 * Outer `rerankForUser` allocates one and reads it into RerankSummary
 * after the loop completes.
 */
interface RerankCounters {
  writesWith: number;
  writesWithout: number;
  writesSkipped: number;
  llmFailures: number;
  validatorRejections: number;
  totalTokens: number;
  budgetExhausted: boolean;
}

export interface RerankSummary {
  readonly userId: string;
  readonly candidatesConsidered: number;
  readonly cacheWritesWithExplanation: number;
  readonly cacheWritesWithoutExplanation: number;
  readonly llmFailures: number;
  readonly validatorRejections: number;
  /** True if the per-user daily token cap stopped this run early. */
  readonly budgetExhausted: boolean;
  readonly totalTokens: number;
}

/**
 * LLM-driven re-rank for the personalized bill feed (#745).
 *
 * For each of the user's top candidates (from the embedding-based v1
 * ranker in `PersonalizedFeedService`), this calls:
 *   1. `PromptClientService.getBillRelevanceExplanationPrompt` — render
 *      the user-specific `bill-relevance-explanation` prompt
 *      (cross-repo contract with prompt-service #72).
 *   2. `ILLMProvider.generate(promptText)` — call the configured LLM
 *      (Ollama in the default dev stack).
 *   3. Parse the LLM's JSON output. If it returns `{ skip: true }`,
 *      a malformed body, or the call fails, we still write the cache
 *      row with `relevanceExplanation: null` so the resolver can serve
 *      the embedding-only rank without re-asking the LLM until the
 *      cache expires. The frontend's `WhyThisPanel` already falls back
 *      to the heuristic axis explanation when the field is null (#744).
 *
 * Constraint validation (planning doc §5.3 — banned-phrase list, word
 * count, protected-class inference) and per-user token-budget capping
 * are Subtask 4 follow-ups; their hooks are documented inline below.
 */
@Injectable()
export class LlmRerankService {
  private readonly logger = new Logger(LlmRerankService.name);

  constructor(
    private readonly db: DbService,
    private readonly feed: PersonalizedFeedService,
    private readonly promptClient: PromptClientService,
    private readonly validator: ExplanationValidatorService,
    private readonly budget: CostBudgetService,
    @Inject('LLM_PROVIDER') private readonly llm: ILLMProvider,
  ) {}

  async rerankForUser(
    userId: string,
    input: PersonalizationInputDto,
    options: { candidateLimit?: number; ttlMs?: number } = {},
  ): Promise<RerankSummary> {
    const limit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const expiresAt = new Date(Date.now() + ttlMs);

    const candidates = await this.feed.getFeedForUser(userId, input, limit);

    // Batch-fetch every candidate bill in one round-trip (was N+1 per
    // user before). The map carries the rows the per-candidate body
    // needs; absence ⇒ bill was hard-deleted between rank and rerank
    // and we skip that candidate entirely (FK on personalized_feed_cache
    // would otherwise reject the upsert and abort the whole batch).
    const billIds = candidates.map((c) => c.billId);
    const bills = await this.db.bill.findMany({
      where: { id: { in: billIds } },
      select: {
        id: true,
        regionId: true,
        billNumber: true,
        sessionYear: true,
        title: true,
        aiSummary: true,
      },
    });
    const billById = new Map(bills.map((b) => [b.id, b]));

    const counters: RerankCounters = {
      writesWith: 0,
      writesWithout: 0,
      writesSkipped: 0,
      llmFailures: 0,
      validatorRejections: 0,
      totalTokens: 0,
      budgetExhausted: false,
    };
    const trueFlags = toTrueFlagNames(input.flags);

    for (const candidate of candidates) {
      await this.processSingleCandidate({
        userId,
        candidate,
        bill: billById.get(candidate.billId),
        input,
        trueFlags,
        expiresAt,
        counters,
      });
    }

    const summary: RerankSummary = {
      userId,
      candidatesConsidered: candidates.length,
      cacheWritesWithExplanation: counters.writesWith,
      cacheWritesWithoutExplanation: counters.writesWithout,
      llmFailures: counters.llmFailures,
      validatorRejections: counters.validatorRejections,
      budgetExhausted: counters.budgetExhausted,
      totalTokens: counters.totalTokens,
    };

    this.logger.log(
      {
        event: 'llm_rerank_user',
        ...summary,
        skippedMissingBills: counters.writesSkipped,
      },
      `LLM rerank for ${userId}: ${counters.writesWith}/${candidates.length} explained, ${counters.writesWithout} cache-only, ${counters.writesSkipped} skipped (missing bill), ${counters.llmFailures} failures, ${counters.validatorRejections} validator-rejected, ${counters.totalTokens} tokens${counters.budgetExhausted ? ' (budget hit)' : ''}`,
    );

    return summary;
  }

  /**
   * One iteration of the rerank loop. Encapsulates the budget check →
   * LLM call → validator → cache upsert sequence so the outer loop
   * stays under the cognitive-complexity gate. Mutates `counters` in
   * place; returns void.
   *
   * Skips the cache upsert entirely when the candidate's bill row is
   * missing (hard-deleted between embedding rank and rerank write).
   * The FK on `personalized_feed_cache.bill_id` would otherwise reject
   * with P2003 and abort the whole batch.
   */
  private async processSingleCandidate(args: {
    userId: string;
    candidate: { billId: string; relevanceScore: number };
    bill: CandidateBill | undefined;
    input: PersonalizationInputDto;
    trueFlags: string[];
    expiresAt: Date;
    counters: RerankCounters;
  }): Promise<void> {
    const { userId, candidate, bill, input, trueFlags, expiresAt, counters } =
      args;

    if (!bill) {
      counters.writesSkipped++;
      this.logger.debug(
        { event: 'llm_rerank_bill_missing', userId, billId: candidate.billId },
        `Skipping cache upsert — bill ${candidate.billId} not found (hard-deleted?)`,
      );
      return;
    }

    if (
      !counters.budgetExhausted &&
      !(await this.budget.withinBudget(userId))
    ) {
      counters.budgetExhausted = true;
    }

    const llmResult = counters.budgetExhausted
      ? this.emptyResult()
      : await this.tryGenerateExplanation(userId, bill, input);

    if (llmResult.failed) counters.llmFailures++;
    counters.totalTokens += llmResult.tokensUsed;

    let acceptedExplanation = llmResult.explanation;
    if (acceptedExplanation) {
      const result = this.validator.validate(acceptedExplanation, {
        userRankingFlags: trueFlags,
      });
      if (!result.valid) {
        counters.validatorRejections++;
        acceptedExplanation = null;
      }
    }

    await this.db.personalizedFeedCache.upsert({
      where: { userId_billId: { userId, billId: candidate.billId } },
      create: {
        userId,
        billId: candidate.billId,
        relevanceScore: candidate.relevanceScore,
        relevanceExplanation: acceptedExplanation,
        templateHash: llmResult.templateHash,
        tokensIn: llmResult.tokensIn,
        tokensOut: llmResult.tokensOut,
        expiresAt,
      },
      update: {
        relevanceScore: candidate.relevanceScore,
        relevanceExplanation: acceptedExplanation,
        templateHash: llmResult.templateHash,
        tokensIn: llmResult.tokensIn,
        tokensOut: llmResult.tokensOut,
        computedAt: new Date(),
        expiresAt,
      },
    });

    if (acceptedExplanation) counters.writesWith++;
    else counters.writesWithout++;
  }

  /**
   * Per-bill LLM call with full error containment. Never throws — the
   * caller writes a cache row either way so the feed serves even when
   * every LLM call in a batch fails (the no-explanation fallback
   * required by the AC). Failures surface in the returned summary +
   * structured log lines for observability.
   *
   * Takes the bill row by value (already fetched in the batch lookup)
   * so this method is pure relative to the DB.
   */
  private async tryGenerateExplanation(
    userId: string,
    bill: CandidateBill,
    input: PersonalizationInputDto,
  ): Promise<{
    explanation: string | null;
    templateHash: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    tokensUsed: number;
    failed: boolean;
  }> {
    if (!bill.aiSummary) {
      return this.emptyResult();
    }

    try {
      const params = this.buildParams(bill, input);
      const { promptText, promptHash } =
        await this.promptClient.getBillRelevanceExplanationPrompt(params);
      const llmResponse = await this.llm.generate(promptText);

      const parsed = this.parseLlmOutput(llmResponse.text);
      const tokensUsed = llmResponse.tokensUsed ?? 0;

      return {
        explanation: parsed.explanation,
        templateHash: promptHash,
        // Token telemetry: Ollama returns `tokensUsed` (total only) —
        // we record on `tokensOut` and leave `tokensIn` null until the
        // provider exposes a split. Cost gates work on the sum either way.
        tokensIn: null,
        tokensOut: tokensUsed,
        tokensUsed,
        failed: false,
      };
    } catch (err) {
      this.logger.warn(
        {
          event: 'llm_rerank_bill_failed',
          userId,
          billId: bill.id,
          error: (err as Error).message,
        },
        `LLM rerank failed for ${userId}/${bill.id} — caching embedding-only score`,
      );
      return { ...this.emptyResult(), failed: true };
    }
  }

  /**
   * Map the stored Bill row + already-resolved user input onto the
   * `BillRelevanceExplanationParams` shape the prompt-client expects.
   * Documented cross-service shortcut (see PersonalizedFeedService) —
   * the bill's structured summary is read directly from the shared DB
   * rather than via federation; #761 removes this step.
   */
  private buildParams(
    bill: CandidateBill,
    input: PersonalizationInputDto,
  ): BillRelevanceExplanationParams {
    // Runtime-validate the Json column before reading fields — a malformed
    // entry (array, scalar, null) would otherwise silently produce undefined
    // strings/arrays downstream and trickle into the prompt as empty text.
    const summary = coerceAiSummary(bill.aiSummary);

    return {
      regionId: bill.regionId,
      billNumber: bill.billNumber,
      sessionYear: bill.sessionYear,
      title: bill.title,
      plainEnglishSummary: summary.plainEnglishSummary ?? '',
      topics: summary.topics ?? [],
      whoItAffects: summary.whoItAffects ?? [],
      fiscalImpactLevel: this.coerceFiscalLevel(summary.fiscalImpact?.level),
      fiscalImpactSummary: summary.fiscalImpact?.summary,
      stakeholderImpact: summary.stakeholderImpact,
      userInterestTags: input.interestTags,
      userRankingFlags: toTrueFlagNames(input.flags),
    };
  }

  private coerceFiscalLevel(
    value: string | undefined,
  ): 'none' | 'low' | 'medium' | 'high' | undefined {
    if (
      value === 'none' ||
      value === 'low' ||
      value === 'medium' ||
      value === 'high'
    ) {
      return value;
    }
    return undefined;
  }

  /**
   * Parse the LLM's JSON output. Accepts either the explanation shape
   * `{ explanation, citedSection?, citedSignals? }` or the skip shape
   * `{ skip: true, reason }`. Anything else → null explanation (the
   * cache row still gets written, just without the personalized line).
   */
  private parseLlmOutput(raw: string): { explanation: string | null } {
    const trimmed = raw.trim();
    try {
      const parsed = JSON.parse(trimmed) as
        | { explanation?: unknown; skip?: unknown }
        | undefined;
      if (
        parsed &&
        typeof parsed.explanation === 'string' &&
        parsed.explanation.length > 0
      ) {
        return { explanation: parsed.explanation };
      }
      // `{ skip: true }` is an expected outcome — the LLM declined to
      // produce a defensible narrative under the §5.3 constraints.
      return { explanation: null };
    } catch {
      this.logger.debug('LLM output was not valid JSON; dropping explanation');
      return { explanation: null };
    }
  }

  private emptyResult() {
    return {
      explanation: null,
      templateHash: null,
      tokensIn: null,
      tokensOut: null,
      tokensUsed: 0,
      failed: false,
    };
  }
}
