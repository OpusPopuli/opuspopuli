import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { ILLMProvider } from '@opuspopuli/llm-provider';
import {
  PromptClientService,
  type BillRelevanceExplanationParams,
  type PropositionRelevanceExplanationParams,
  type RepresentativeRelevanceExplanationParams,
  type CommitteeRelevanceExplanationParams,
} from '@opuspopuli/prompt-client';
import type { PersonalizationInputDto } from './dto/personalization-input.dto';
import { PersonalizedFeedService } from './personalized-feed.service';
import { ExplanationValidatorService } from './explanation-validator.service';
import { CostBudgetService } from './cost-budget.service';
import { coerceAiSummary, toTrueFlagNames } from './personalized-feed.utils';

/**
 * One legislative-committee candidate for the committee rerank. The
 * `membersOnUserSlate` field is the privacy contract: callers MUST pass
 * the intersection of committee members and the user's resolved rep slate
 * (empty array when none overlap). The prompt-service treats this list as
 * the strongest anchor ("your rep serves on it") and CANNOT validate the
 * claim — see CommitteeRelevanceExplanationParams docblock in
 * @opuspopuli/prompt-client + prompt-service#81 + opuspopuli#836.
 */
export interface CommitteeRerankCandidate {
  readonly legislativeCommitteeId: string;
  readonly membersOnUserSlate: ReadonlyArray<string>;
}

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

  /**
   * Bill-relevance rerank — the original #745 flow. Aliased as
   * `rerankBillsForUser` from opuspopuli#836's multi-entity worker
   * dispatcher so the four entity-type rerank methods read symmetrically.
   * Existing callers using `rerankForUser` keep working.
   */
  async rerankBillsForUser(
    userId: string,
    input: PersonalizationInputDto,
    options: { candidateLimit?: number; ttlMs?: number } = {},
  ): Promise<RerankSummary> {
    return this.rerankForUser(userId, input, options);
  }

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
    // and we skip that candidate entirely (FK on bill_relevance_cache
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
   * The FK on `bill_relevance_cache.bill_id` would otherwise reject
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

    await this.db.billRelevanceCache.upsert({
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

  // ===========================================================================
  // MULTI-ENTITY RERANK (opuspopuli#836) — proposition / representative /
  // legislative-committee variants. Same control flow as bills (budget →
  // prompt → LLM → parse → validate → cache upsert), with entity-specific
  // candidate fetching and params builders. The validator + parser +
  // budget service are shared across all four entity types.
  //
  // Each method accepts pre-resolved candidate IDs (or candidate descriptors
  // for committees, which carry the membersOnUserSlate contract). The worker
  // scheduler (opuspopuli#836 / S4) is responsible for candidate selection
  // and the rep-slate intersect. This separation keeps the rerank service
  // testable in isolation and lets the candidate-selection logic evolve
  // independently.
  // ===========================================================================

  async rerankPropositionsForUser(
    userId: string,
    input: PersonalizationInputDto,
    propositionIds: ReadonlyArray<string>,
    options: { ttlMs?: number } = {},
  ): Promise<RerankSummary> {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const expiresAt = new Date(Date.now() + ttlMs);

    const propositions = await this.db.proposition.findMany({
      where: { id: { in: [...propositionIds] }, deletedAt: null },
      select: {
        id: true,
        externalId: true,
        title: true,
        electionDate: true,
        analysisSummary: true,
        fiscalImpact: true,
        yesOutcome: true,
        noOutcome: true,
      },
    });
    const propById = new Map(propositions.map((p) => [p.id, p]));

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

    for (const propositionId of propositionIds) {
      await this.processProposition({
        userId,
        propositionId,
        proposition: propById.get(propositionId),
        input,
        trueFlags,
        expiresAt,
        counters,
      });
    }

    return this.summarize(
      userId,
      propositionIds.length,
      counters,
      'proposition',
    );
  }

  async rerankRepresentativesForUser(
    userId: string,
    input: PersonalizationInputDto,
    representativeIds: ReadonlyArray<string>,
    options: { ttlMs?: number } = {},
  ): Promise<RerankSummary> {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const expiresAt = new Date(Date.now() + ttlMs);

    const representatives = await this.db.representative.findMany({
      where: { id: { in: [...representativeIds] }, deletedAt: null },
      select: {
        id: true,
        regionId: true,
        name: true,
        chamber: true,
        district: true,
        party: true,
        bio: true,
        committeesSummary: true,
        committees: true,
        activitySummary: true,
      },
    });
    const repById = new Map(representatives.map((r) => [r.id, r]));

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

    for (const representativeId of representativeIds) {
      await this.processRepresentative({
        userId,
        representativeId,
        representative: repById.get(representativeId),
        input,
        trueFlags,
        expiresAt,
        counters,
      });
    }

    return this.summarize(
      userId,
      representativeIds.length,
      counters,
      'representative',
    );
  }

  /**
   * Committee rerank — the privacy-critical case. The `membersOnUserSlate`
   * field on each candidate is the contract: callers MUST pass the
   * intersection of committee members and the user's resolved rep slate
   * (empty array when none overlap). NEVER pass reps not on the slate;
   * the prompt-service cannot validate the claim and the LLM will
   * fabricate a verifiable-sounding but wrong "your rep serves on it"
   * sentence. See opuspopuli#836's acceptance criteria + prompt-service#81.
   */
  async rerankCommitteesForUser(
    userId: string,
    input: PersonalizationInputDto,
    candidates: ReadonlyArray<CommitteeRerankCandidate>,
    options: { ttlMs?: number } = {},
  ): Promise<RerankSummary> {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const expiresAt = new Date(Date.now() + ttlMs);

    const committeeIds = candidates.map((c) => c.legislativeCommitteeId);
    const committees = await this.db.legislativeCommittee.findMany({
      where: { id: { in: committeeIds }, deletedAt: null },
      select: {
        id: true,
        name: true,
        chamber: true,
        description: true,
        activitySummary: true,
      },
    });
    const committeeById = new Map(committees.map((c) => [c.id, c]));

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
      await this.processCommittee({
        userId,
        candidate,
        committee: committeeById.get(candidate.legislativeCommitteeId),
        input,
        trueFlags,
        expiresAt,
        counters,
      });
    }

    return this.summarize(userId, candidates.length, counters, 'committee');
  }

  // ---------- Per-candidate helpers ----------

  private async processProposition(args: {
    userId: string;
    propositionId: string;
    proposition:
      | {
          id: string;
          externalId: string;
          title: string;
          electionDate: Date | null;
          analysisSummary: string | null;
          fiscalImpact: string | null;
          yesOutcome: string | null;
          noOutcome: string | null;
        }
      | undefined;
    input: PersonalizationInputDto;
    trueFlags: string[];
    expiresAt: Date;
    counters: RerankCounters;
  }): Promise<void> {
    const {
      userId,
      propositionId,
      proposition,
      input,
      trueFlags,
      expiresAt,
      counters,
    } = args;

    if (
      !proposition ||
      !proposition.analysisSummary ||
      !proposition.electionDate
    ) {
      counters.writesSkipped++;
      return;
    }

    if (
      !counters.budgetExhausted &&
      !(await this.budget.withinBudget(userId))
    ) {
      counters.budgetExhausted = true;
    }

    // Note (opuspopuli#839 tracks the fix): regionId is hardcoded to 'california'
    // here and in processCommittee. The Proposition + LegislativeCommittee
    // models don't carry a `regionId` column today (CA-only ingest), so the
    // prompt input pins to "california". When local/county data lands,
    // surface the region from the row + drop this hardcode.
    this.warnIfRegionHardcoded('proposition', propositionId);
    const params: PropositionRelevanceExplanationParams = {
      regionId: 'california',
      propositionNumber: proposition.externalId,
      electionDate: proposition.electionDate.toISOString().slice(0, 10),
      title: proposition.title,
      plainEnglishSummary: proposition.analysisSummary,
      topics: [],
      whoItAffects: [],
      fiscalImpactSummary: proposition.fiscalImpact ?? undefined,
      stakeholderImpact: proposition.yesOutcome ?? undefined,
      userInterestTags: input.interestTags,
      userRankingFlags: trueFlags,
    };

    const result = counters.budgetExhausted
      ? this.emptyResult()
      : await this.tryGenerateRelevanceExplanation(
          'proposition',
          propositionId,
          userId,
          () =>
            this.promptClient.getPropositionRelevanceExplanationPrompt(params),
        );

    if (result.failed) counters.llmFailures++;
    counters.totalTokens += result.tokensUsed;

    const accepted = this.validateAccepted(
      result.explanation,
      trueFlags,
      counters,
    );

    await this.db.propositionRelevanceCache.upsert({
      where: { userId_propositionId: { userId, propositionId } },
      create: {
        userId,
        propositionId,
        relevanceExplanation: accepted,
        templateHash: result.templateHash,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        expiresAt,
      },
      update: {
        relevanceExplanation: accepted,
        templateHash: result.templateHash,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        computedAt: new Date(),
        expiresAt,
      },
    });

    if (accepted) counters.writesWith++;
    else counters.writesWithout++;
  }

  private async processRepresentative(args: {
    userId: string;
    representativeId: string;
    representative:
      | {
          id: string;
          regionId: string;
          name: string;
          chamber: string;
          district: string;
          party: string | null;
          bio: string | null;
          committeesSummary: string | null;
          committees: unknown;
          activitySummary: string | null;
        }
      | undefined;
    input: PersonalizationInputDto;
    trueFlags: string[];
    expiresAt: Date;
    counters: RerankCounters;
  }): Promise<void> {
    const {
      userId,
      representativeId,
      representative,
      input,
      trueFlags,
      expiresAt,
      counters,
    } = args;

    if (!representative) {
      counters.writesSkipped++;
      return;
    }

    if (
      !counters.budgetExhausted &&
      !(await this.budget.withinBudget(userId))
    ) {
      counters.budgetExhausted = true;
    }

    const params: RepresentativeRelevanceExplanationParams = {
      regionId: representative.regionId,
      repName: representative.name,
      officeTitle:
        `${representative.chamber} ${representative.district}`.trim(),
      jurisdiction: this.coerceRepJurisdiction(
        representative.chamber,
        representative.regionId,
      ),
      party: this.coerceParty(representative.party),
      mandateSummary:
        representative.bio ??
        representative.committeesSummary ??
        `Represents ${representative.district} in the ${representative.chamber}.`,
      topicsOfFocus: [],
      committeeMemberships: this.coerceCommitteeNames(
        representative.committees,
      ),
      recentLegislativeAction: representative.activitySummary ?? undefined,
      userInterestTags: input.interestTags,
      userRankingFlags: trueFlags,
    };

    const result = counters.budgetExhausted
      ? this.emptyResult()
      : await this.tryGenerateRelevanceExplanation(
          'representative',
          representativeId,
          userId,
          () =>
            this.promptClient.getRepresentativeRelevanceExplanationPrompt(
              params,
            ),
        );

    if (result.failed) counters.llmFailures++;
    counters.totalTokens += result.tokensUsed;

    const accepted = this.validateAccepted(
      result.explanation,
      trueFlags,
      counters,
    );

    await this.db.representativeRelevanceCache.upsert({
      where: { userId_representativeId: { userId, representativeId } },
      create: {
        userId,
        representativeId,
        relevanceExplanation: accepted,
        templateHash: result.templateHash,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        expiresAt,
      },
      update: {
        relevanceExplanation: accepted,
        templateHash: result.templateHash,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        computedAt: new Date(),
        expiresAt,
      },
    });

    if (accepted) counters.writesWith++;
    else counters.writesWithout++;
  }

  private async processCommittee(args: {
    userId: string;
    candidate: CommitteeRerankCandidate;
    committee:
      | {
          id: string;
          name: string;
          chamber: string;
          description: string | null;
          activitySummary: string | null;
        }
      | undefined;
    input: PersonalizationInputDto;
    trueFlags: string[];
    expiresAt: Date;
    counters: RerankCounters;
  }): Promise<void> {
    const {
      userId,
      candidate,
      committee,
      input,
      trueFlags,
      expiresAt,
      counters,
    } = args;

    if (!committee) {
      counters.writesSkipped++;
      return;
    }

    if (
      !counters.budgetExhausted &&
      !(await this.budget.withinBudget(userId))
    ) {
      counters.budgetExhausted = true;
    }

    this.warnIfRegionHardcoded('committee', candidate.legislativeCommitteeId);
    // Privacy contract: pass membersOnUserSlate verbatim from the caller.
    // The caller MUST have intersected this with the user's rep slate; the
    // prompt-service cannot validate. See opuspopuli#836 + prompt-service#81.
    const params: CommitteeRelevanceExplanationParams = {
      regionId: 'california',
      committeeName: committee.name,
      jurisdiction: this.coerceCommitteeJurisdiction(committee.chamber),
      mandateSummary:
        committee.description ??
        committee.activitySummary ??
        `${committee.name} of the ${committee.chamber}.`,
      topics: [],
      membersOnUserSlate: [...candidate.membersOnUserSlate],
      recentBillTopicsTouched: [],
      upcomingHearings: [],
      userInterestTags: input.interestTags,
      userRankingFlags: trueFlags,
    };

    const result = counters.budgetExhausted
      ? this.emptyResult()
      : await this.tryGenerateRelevanceExplanation(
          'committee',
          candidate.legislativeCommitteeId,
          userId,
          () =>
            this.promptClient.getCommitteeRelevanceExplanationPrompt(params),
        );

    if (result.failed) counters.llmFailures++;
    counters.totalTokens += result.tokensUsed;

    const accepted = this.validateAccepted(
      result.explanation,
      trueFlags,
      counters,
    );

    await this.db.committeeRelevanceCache.upsert({
      where: {
        userId_legislativeCommitteeId: {
          userId,
          legislativeCommitteeId: candidate.legislativeCommitteeId,
        },
      },
      create: {
        userId,
        legislativeCommitteeId: candidate.legislativeCommitteeId,
        relevanceExplanation: accepted,
        templateHash: result.templateHash,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        expiresAt,
      },
      update: {
        relevanceExplanation: accepted,
        templateHash: result.templateHash,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        computedAt: new Date(),
        expiresAt,
      },
    });

    if (accepted) counters.writesWith++;
    else counters.writesWithout++;
  }

  // ---------- Shared multi-entity helpers ----------

  /**
   * Entity-agnostic LLM-call wrapper. Same try/catch shape as
   * tryGenerateExplanation but accepts a callback that builds the prompt,
   * so the same flow works for proposition / representative / committee.
   */
  private async tryGenerateRelevanceExplanation(
    entityType: string,
    entityId: string,
    userId: string,
    getPrompt: () => Promise<{ promptText: string; promptHash: string }>,
  ): Promise<{
    explanation: string | null;
    templateHash: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    tokensUsed: number;
    failed: boolean;
  }> {
    try {
      const { promptText, promptHash } = await getPrompt();
      const llmResponse = await this.llm.generate(promptText);
      const parsed = this.parseLlmOutput(llmResponse.text);
      const tokensUsed = llmResponse.tokensUsed ?? 0;
      return {
        explanation: parsed.explanation,
        templateHash: promptHash,
        tokensIn: null,
        tokensOut: tokensUsed,
        tokensUsed,
        failed: false,
      };
    } catch (err) {
      this.logger.warn(
        {
          event: 'llm_rerank_entity_failed',
          userId,
          entityType,
          entityId,
          error: (err as Error).message,
        },
        `LLM rerank failed for ${userId}/${entityType}/${entityId}`,
      );
      return { ...this.emptyResult(), failed: true };
    }
  }

  /** Run the explanation through the shared validator; null on rejection. */
  private validateAccepted(
    explanation: string | null,
    trueFlags: string[],
    counters: RerankCounters,
  ): string | null {
    if (!explanation) return null;
    const result = this.validator.validate(explanation, {
      userRankingFlags: trueFlags,
    });
    if (!result.valid) {
      counters.validatorRejections++;
      return null;
    }
    return explanation;
  }

  /** Build + log the summary at the end of a per-entity rerank run. */
  private summarize(
    userId: string,
    candidatesConsidered: number,
    counters: RerankCounters,
    entityType: string,
  ): RerankSummary {
    const summary: RerankSummary = {
      userId,
      candidatesConsidered,
      cacheWritesWithExplanation: counters.writesWith,
      cacheWritesWithoutExplanation: counters.writesWithout,
      llmFailures: counters.llmFailures,
      validatorRejections: counters.validatorRejections,
      budgetExhausted: counters.budgetExhausted,
      totalTokens: counters.totalTokens,
    };
    this.logger.log(
      {
        event: 'llm_rerank_entity_user',
        entityType,
        ...summary,
        skippedMissingEntities: counters.writesSkipped,
      },
      `LLM ${entityType} rerank for ${userId}: ${counters.writesWith}/${candidatesConsidered} explained, ${counters.writesWithout} cache-only, ${counters.writesSkipped} skipped, ${counters.llmFailures} failures, ${counters.validatorRejections} validator-rejected, ${counters.totalTokens} tokens${counters.budgetExhausted ? ' (budget hit)' : ''}`,
    );
    return summary;
  }

  // ---------- Coercion helpers ----------

  private coerceRepJurisdiction(
    chamber: string,
    regionId: string,
  ): RepresentativeRelevanceExplanationParams['jurisdiction'] {
    if (regionId === 'federal') return 'federal';
    const c = chamber.toLowerCase();
    if (c.includes('u.s.') || c.includes('us ')) return 'federal';
    if (c.includes('county')) return 'county';
    if (c.includes('city') || c.includes('council')) return 'city';
    return 'state';
  }

  /**
   * One-shot warn log per process for the hardcoded regionId in the
   * proposition + committee param builders. Tracked via the Set so the
   * warning fires once per entity type per process boot rather than
   * spamming logs on every per-candidate iteration.
   */
  private readonly hardcodedRegionWarned = new Set<string>();
  private warnIfRegionHardcoded(entityType: string, entityId: string): void {
    if (this.hardcodedRegionWarned.has(entityType)) return;
    this.hardcodedRegionWarned.add(entityType);
    this.logger.warn(
      {
        event: 'llm_rerank_region_hardcoded',
        entityType,
        sampleEntityId: entityId,
      },
      `regionId pinned to 'california' for ${entityType} rerank — surface via row column when multi-region data lands (opuspopuli#836 follow-up)`,
    );
  }

  private coerceCommitteeJurisdiction(
    chamber: string,
  ): CommitteeRelevanceExplanationParams['jurisdiction'] {
    const c = chamber.toLowerCase();
    if (c.includes('u.s. house') || c === 'house') return 'us_house';
    if (c.includes('u.s. senate')) return 'us_senate';
    if (c.includes('assembly')) return 'state_assembly';
    if (c === 'senate' || c.includes('state senate')) return 'state_senate';
    if (c.includes('joint')) return 'joint';
    return 'state_other';
  }

  private coerceParty(
    party: string | null,
  ): RepresentativeRelevanceExplanationParams['party'] {
    if (!party) return undefined;
    const p = party.toLowerCase();
    if (p === 'democrat' || p === 'democratic' || p === 'd') return 'democrat';
    if (p === 'republican' || p === 'r') return 'republican';
    if (p === 'independent' || p === 'i') return 'independent';
    if (p === 'nonpartisan' || p === 'np') return 'nonpartisan';
    return undefined;
  }

  /**
   * Coerce the `committees` JSON column (CommitteeAssignment[]) to a
   * flat list of committee names. Defensive against malformed JSON —
   * unparseable entries are dropped rather than crashing the rerank.
   */
  private coerceCommitteeNames(committees: unknown): string[] {
    if (!Array.isArray(committees)) return [];
    return committees
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && 'name' in entry) {
          const name = (entry as { name?: unknown }).name;
          return typeof name === 'string' ? name : null;
        }
        return null;
      })
      .filter((s): s is string => s !== null && s.length > 0)
      .slice(0, 6);
  }
}
