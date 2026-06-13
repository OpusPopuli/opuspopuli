import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@opuspopuli/relationaldb-provider';

/**
 * Default per-user, per-day token budget for the LLM re-rank job (#745).
 * Tuned for ~20 candidates × ~500 tokens-per-call headroom = ~10K. The
 * operator can raise via `LLM_RERANK_PER_USER_DAILY_TOKEN_CAP`.
 */
const DEFAULT_PER_USER_DAILY_TOKEN_CAP = 10_000;

/**
 * Conservative upper bound on what one LLM call could add to the
 * running total. Subtracted from the cap when gating so a user at
 * 9_500/10_000 doesn't fire another call that pushes them to ~10_500.
 * Pessimistic on purpose — false negatives just delay the next call
 * to tomorrow, false positives let the user overshoot the cap.
 */
const ESTIMATED_TOKENS_PER_CALL = 500;

/**
 * Per-user, per-day LLM token-budget gate for the rerank job (#745).
 *
 * Sums `tokensIn + tokensOut` across the user's `bill_relevance_cache`
 * rows whose `computed_at` falls within the current UTC day. When the
 * sum is at or above the configured cap, the rerank service skips the
 * LLM call and writes the embedding-only row instead — the no-
 * explanation fallback required by the AC.
 *
 * UTC day is a deliberate choice: it matches the nightly cron's
 * "3 AM" reference (also UTC) so the budget resets cleanly between
 * runs without timezone bookkeeping.
 */
@Injectable()
export class CostBudgetService {
  private readonly logger = new Logger(CostBudgetService.name);
  private readonly perUserDailyCap: number;

  constructor(
    private readonly db: DbService,
    config: ConfigService,
  ) {
    const fromEnv = config.get<string>('LLM_RERANK_PER_USER_DAILY_TOKEN_CAP');
    const parsed = fromEnv ? parseInt(fromEnv, 10) : NaN;
    this.perUserDailyCap =
      Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_PER_USER_DAILY_TOKEN_CAP;
  }

  /**
   * Returns true if the user is still within their daily token budget.
   * Best-effort — a DB hiccup on the lookup is treated as "still within
   * budget" rather than blocking the rerank, so transient errors don't
   * silently degrade the feature. Cost overruns are logged on every
   * write via the cache row's `tokens_out` column.
   */
  async withinBudget(userId: string): Promise<boolean> {
    try {
      const startOfUtcDay = new Date();
      startOfUtcDay.setUTCHours(0, 0, 0, 0);
      const rows = await this.db.billRelevanceCache.findMany({
        where: { userId, computedAt: { gte: startOfUtcDay } },
        select: { tokensIn: true, tokensOut: true },
      });
      const used = rows.reduce(
        (sum, r) => sum + (r.tokensIn ?? 0) + (r.tokensOut ?? 0),
        0,
      );
      // Gate on `used + ESTIMATED_TOKENS_PER_CALL <= cap` rather than
      // `used < cap` so a near-cap user doesn't fire one more call that
      // pushes them well past the budget. The cap then represents an
      // actual ceiling rather than the floor of a "+1 LLM call" range.
      const within = used + ESTIMATED_TOKENS_PER_CALL <= this.perUserDailyCap;
      if (!within) {
        this.logger.warn(
          {
            event: 'llm_rerank_budget_exceeded',
            userId,
            tokensUsedToday: used,
            cap: this.perUserDailyCap,
            estimatedNextCall: ESTIMATED_TOKENS_PER_CALL,
          },
          `User ${userId} hit daily LLM budget (${used}+~${ESTIMATED_TOKENS_PER_CALL}/${this.perUserDailyCap}) — falling back to embedding-only`,
        );
      }
      return within;
    } catch (err) {
      this.logger.warn(
        {
          event: 'llm_rerank_budget_check_failed',
          userId,
          error: (err as Error).message,
        },
        'budget check failed — assuming within budget',
      );
      return true;
    }
  }

  get dailyCap(): number {
    return this.perUserDailyCap;
  }
}
