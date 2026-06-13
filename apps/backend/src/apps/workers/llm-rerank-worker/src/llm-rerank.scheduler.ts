import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  QueueService,
  LLM_RERANK_QUEUE,
  TRIGGER_SOURCE,
  type LlmRerankJobData,
  type LlmRerankCommitteeCandidate,
} from '@opuspopuli/queue-provider';
import { LlmRerankJobService } from 'src/apps/knowledge/src/domains/personalized-feed/llm-rerank-job.service';

/**
 * Nightly LLM re-rank scheduler (#745).
 *
 * Fires at 3 AM UTC by default. Enumerates active users (anyone with at
 * least one declared interest tag) and enqueues one `llm-rerank` job
 * per user with the user's RankingFlags (TRUE-only) + interestTags
 * baked into the job data. The `LlmRerankProcessor` consumes from the
 * queue and runs `LlmRerankService.rerankForUser` for each.
 *
 * Pattern: per-user job. Lets BullMQ provide parallelism + per-user
 * retries. Cost: enumerating + reading SignalProfile rows at scheduling
 * time. For the active-user enumeration the scheduler reads
 * `signal_profiles` directly from the shared DB — same cross-service
 * shortcut PersonalizedFeedService uses for bills. Full federation
 * refactor tracked at opuspopuli#761.
 *
 * **T3 omission (documented limitation)**: cron-derived flags include
 * T1+T2 only (see `RankingFlagsService` in users service for the
 * canonical derivation with T3). T3-derived flags require
 * SensitiveProfile decryption which crosses the bounded-context line.
 * v1.0 trade-off — cron-triggered rerank for users with T3 signals will
 * produce slightly lower-fidelity explanations than mutation-triggered
 * ones (where the frontend passes the full flag set via federation).
 * #761 fixes this.
 *
 * Env knobs:
 *   - `LLM_RERANK_CRON_ENABLED`  (default true; set "false" in UAT to skip)
 *   - `LLM_RERANK_CRON_PATTERN`  read via @Cron at module-load time;
 *     defaults to "0 3 * * *" (3 AM UTC). Override requires worker restart.
 */
const DEFAULT_CRON = '0 3 * * *';

/**
 * Defensive ceiling on the global proposition candidate fetch for the
 * nightly multi-entity fan-out (opuspopuli#836). CA carries O(10)
 * statewide propositions per cycle; this leaves headroom. Bumped when
 * local/county ballots land. Mirrors the
 * `RANKABLE_PROPS_FETCH_LIMIT` constant in
 * `personalized-propositions.service.ts`.
 */
const PROPOSITION_CANDIDATE_FETCH_LIMIT = 50;

/**
 * Defensive ceiling on the global representative candidate fetch.
 * CA has ~120 state legislators + ~52 federal reps; 200 is comfortable
 * headroom. Bumped when local reps (county supervisors, city council)
 * land.
 */
const REPRESENTATIVE_CANDIDATE_FETCH_LIMIT = 200;

/**
 * Defensive ceiling on the global legislative-committee candidate fetch.
 * CA Assembly carries ~80 committees + ~84 subcommittees; 200 leaves
 * headroom for Senate-side ingest landing.
 */
const COMMITTEE_CANDIDATE_FETCH_LIMIT = 200;

@Injectable()
export class LlmRerankScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(LlmRerankScheduler.name, {
    timestamp: true,
  });

  constructor(
    private readonly db: DbService,
    private readonly queueService: QueueService,
    private readonly jobs: LlmRerankJobService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (this.isCronEnabled()) {
      this.logger.log(
        `Nightly LLM rerank cron registered: ${this.cronPattern()}`,
      );
    } else {
      this.logger.log(
        'LLM_RERANK_CRON_ENABLED=false — nightly cron disabled (mutations still enqueue jobs)',
      );
    }
  }

  /**
   * @Cron reads its pattern at decorator-evaluation (module-load) time
   * via `process.env` because NestJS evaluates the decorator before any
   * `ConfigService` is constructed — there's no way to thread the
   * service in here. The runtime gate inside the handler reads via
   * `ConfigService` so test overrides + ConfigModule.forFeature work.
   * Override the pattern at deploy time, not via hot-reload.
   */
  @Cron(process.env.LLM_RERANK_CRON_PATTERN ?? DEFAULT_CRON, {
    name: 'llm-rerank-nightly-fanout',
  })
  async runNightlyFanout(): Promise<void> {
    if (!this.isCronEnabled()) {
      return;
    }
    try {
      const { enqueued } = await this.fanOutForAllActiveUsers();
      this.logger.log(
        `Nightly fanout enqueued ${enqueued} rerank job(s)${
          enqueued === 0 ? ' (no active users)' : ''
        }`,
      );
    } catch (err) {
      this.logger.error(
        `Nightly fanout failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private isCronEnabled(): boolean {
    return this.config.get<string>('LLM_RERANK_CRON_ENABLED') !== 'false';
  }

  private cronPattern(): string {
    return this.config.get<string>('LLM_RERANK_CRON_PATTERN') ?? DEFAULT_CRON;
  }

  /**
   * Reads all active users, derives T1+T2 flags inline, and enqueues
   * one job per user. Public so it can be exercised directly by
   * integration tests without waiting for cron.
   *
   * Batched fan-out (#745 review S9): DB upserts run in parallel via
   * Promise.all, then BullMQ enqueues land in one `addBulk` round-trip
   * instead of N. Cuts a 10k-user fanout from ~10k×(insert + enqueue)
   * serial round-trips to roughly chunkSize parallel DB writes plus a
   * single Redis call.
   */
  async fanOutForAllActiveUsers(): Promise<{
    enqueued: number;
    entityBreakdown: Record<string, number>;
  }> {
    const profiles = await this.db.signalProfile.findMany({
      where: { interestTags: { isEmpty: false } },
      select: {
        userId: true,
        interestTags: true,
        housingTenure: true,
        childrenAgeBands: true,
        parentOfStudent: true,
        hasEldercareDependents: true,
        studentLevel: true,
        educator: true,
        employmentStatus: true,
        unionMember: true,
        gigWorker: true,
        primaryTransitMode: true,
        vehicleTypes: true,
        specialLicenses: true,
      },
    });
    if (profiles.length === 0) {
      return {
        enqueued: 0,
        entityBreakdown: {
          bill: 0,
          proposition: 0,
          representative: 0,
          committee: 0,
        },
      };
    }

    const yyyymmdd = this.utcYyyymmdd(new Date());
    const plan = profiles.map((p) => ({
      profile: p,
      rankingFlags: this.deriveT1T2Flags(p),
      bullmqJobId: `cron-${p.userId}-${yyyymmdd}`,
    }));

    // ====== BILL FAN-OUT (existing #745 flow, unchanged) ======
    // Upsert lifecycle rows in parallel (idempotent on bullmqJobId after
    // migration 20260530200000 added the unique constraint).
    const billRows = await Promise.all(
      plan.map((entry) =>
        this.jobs.create({
          bullmqJobId: entry.bullmqJobId,
          triggerSource: TRIGGER_SOURCE.CRON,
          userId: entry.profile.userId,
        }),
      ),
    );

    // Single bulk enqueue with deterministic jobIds — duplicates land
    // as silent no-ops at the BullMQ layer.
    const billEntries = plan.map((entry, i) => ({
      data: {
        rerankJobId: billRows[i].id,
        triggerSource: TRIGGER_SOURCE.CRON,
        userId: entry.profile.userId,
        rankingFlags: entry.rankingFlags,
        interestTags: [...entry.profile.interestTags],
        // entityType omitted → processor defaults to 'bill' (backward-compat).
      } satisfies LlmRerankJobData,
      opts: { jobId: entry.bullmqJobId },
    }));
    await this.queueService.enqueueBulk<LlmRerankJobData>(
      LLM_RERANK_QUEUE,
      billEntries,
    );

    // ====== PROPOSITION + REPRESENTATIVE FAN-OUT (opuspopuli#836) ======
    // MVP candidate selection: shared global candidate sets across all users.
    // - Propositions: active future-dated CA props (no per-user jurisdiction
    //   filter yet — CA has only statewide ballots ingested today)
    // - Representatives: all CA reps (no per-user slate resolution yet)
    // Per-user filtering is a clear follow-up: when local/county ballots +
    // jurisdiction resolution land, the candidate selectors below should
    // become per-user via the existing UserJurisdiction stack.
    //
    // Committees: deferred entirely. The privacy contract requires the
    // membersOnUserSlate intersect, which depends on per-user rep-slate
    // resolution. Follow-up issue: implement committee scheduling once
    // jurisdiction resolution is plumbed through.

    const propositionCandidateIds = await this.fetchPropositionCandidateIds();
    const representativeCandidateIds =
      await this.fetchRepresentativeCandidateIds();
    const committeeCandidates = await this.fetchCommitteeCandidates();

    let propJobs = 0;
    let repJobs = 0;
    let committeeJobs = 0;

    if (propositionCandidateIds.length > 0) {
      propJobs = await this.enqueueEntityFanOut(plan, yyyymmdd, 'proposition', {
        candidateIds: propositionCandidateIds,
      });
    }
    if (representativeCandidateIds.length > 0) {
      repJobs = await this.enqueueEntityFanOut(
        plan,
        yyyymmdd,
        'representative',
        { candidateIds: representativeCandidateIds },
      );
    }
    if (committeeCandidates.length > 0) {
      committeeJobs = await this.enqueueCommitteeFanOut(
        plan,
        yyyymmdd,
        committeeCandidates,
      );
    }

    return {
      enqueued: plan.length + propJobs + repJobs + committeeJobs,
      entityBreakdown: {
        bill: plan.length,
        proposition: propJobs,
        representative: repJobs,
        committee: committeeJobs,
      },
    };
  }

  /**
   * Fetch the global proposition candidate set for tonight's batch.
   * Filters: not soft-deleted, election in the future, status active or
   * pending. CA-only today; once local/county ballots land, this query
   * must be per-user-jurisdiction-scoped.
   */
  private async fetchPropositionCandidateIds(): Promise<string[]> {
    const rows = await this.db.proposition.findMany({
      where: {
        deletedAt: null,
        electionDate: { gte: new Date() },
        status: { in: ['active', 'pending'] },
      },
      select: { id: true },
      take: PROPOSITION_CANDIDATE_FETCH_LIMIT,
    });
    if (rows.length === PROPOSITION_CANDIDATE_FETCH_LIMIT) {
      this.logger.warn(
        `Hit PROPOSITION_CANDIDATE_FETCH_LIMIT (${PROPOSITION_CANDIDATE_FETCH_LIMIT}) — raise the cap or scope per user.`,
      );
    }
    return rows.map((r) => r.id);
  }

  /**
   * Fetch the global representative candidate set for tonight's batch.
   * Includes ALL non-deleted reps across every region — Assembly,
   * Senate, county boards of supervisors, etc. The frontend's rep-slate
   * resolution unions reps from both the district-based query and the
   * county-supervisors query, so the scheduler must enrich all of them
   * for the briefing's cache lookup to find a match.
   *
   * Follow-up: per-user slate via the existing UserJurisdiction stack —
   * same refactor that makes the propositions filter per-user.
   */
  private async fetchRepresentativeCandidateIds(): Promise<string[]> {
    const rows = await this.db.representative.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: REPRESENTATIVE_CANDIDATE_FETCH_LIMIT,
    });
    if (rows.length === REPRESENTATIVE_CANDIDATE_FETCH_LIMIT) {
      this.logger.warn(
        `Hit REPRESENTATIVE_CANDIDATE_FETCH_LIMIT (${REPRESENTATIVE_CANDIDATE_FETCH_LIMIT}) — raise the cap or scope per user.`,
      );
    }
    return rows.map((r) => r.id);
  }

  /**
   * Defensive ceiling on the global legislative-committee candidate
   * fetch. CA carries ~80 Assembly committees today (Senate side
   * pending ingest); 200 leaves headroom.
   */
  private async fetchCommitteeCandidates(): Promise<
    LlmRerankCommitteeCandidate[]
  > {
    const rows = await this.db.legislativeCommittee.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: COMMITTEE_CANDIDATE_FETCH_LIMIT,
    });
    if (rows.length === COMMITTEE_CANDIDATE_FETCH_LIMIT) {
      this.logger.warn(
        `Hit COMMITTEE_CANDIDATE_FETCH_LIMIT (${COMMITTEE_CANDIDATE_FETCH_LIMIT}) — raise the cap or scope per user.`,
      );
    }
    // Privacy contract (prompt-service#81 / opuspopuli#836): the LLM
    // template treats `membersOnUserSlate` as the strongest anchor —
    // "your rep serves on it". The scheduler does NOT yet compute the
    // per-user rep-slate intersect — that's tracked as opuspopuli#839
    // (requires plumbing the existing district-reps + county-supervisors
    // resolvers into the scheduler's per-user fan-out). We pass `[]`
    // here, which vacuously upholds the contract: an empty list means
    // no member anchor is asserted, and the LLM falls back to topical
    // / recent-activity / upcoming-hearing anchors per the template's
    // priority order. Committees with strong topic overlap still get
    // useful explanations; committees with weak topic match return skip.
    return rows.map((r) => ({
      legislativeCommitteeId: r.id,
      membersOnUserSlate: [],
    }));
  }

  /**
   * Committee-specific fan-out: one job per user with the global
   * committee candidate set + each candidate's pre-computed
   * `membersOnUserSlate` (currently `[]` for all — see
   * fetchCommitteeCandidates docblock for the Phase-2 enrichment plan).
   */
  private async enqueueCommitteeFanOut(
    plan: ReadonlyArray<{
      profile: { userId: string; interestTags: string[] };
      rankingFlags: string[];
    }>,
    yyyymmdd: string,
    committeeCandidates: LlmRerankCommitteeCandidate[],
  ): Promise<number> {
    const bullmqJobIds = plan.map(
      (entry) => `cron-committee-${entry.profile.userId}-${yyyymmdd}`,
    );

    const rows = await Promise.all(
      plan.map((entry, i) =>
        this.jobs.create({
          bullmqJobId: bullmqJobIds[i],
          triggerSource: TRIGGER_SOURCE.CRON,
          userId: entry.profile.userId,
        }),
      ),
    );

    const entries = plan.map((entry, i) => ({
      data: {
        rerankJobId: rows[i].id,
        triggerSource: TRIGGER_SOURCE.CRON,
        userId: entry.profile.userId,
        rankingFlags: entry.rankingFlags,
        interestTags: [...entry.profile.interestTags],
        entityType: 'committee' as const,
        committeeCandidates,
      } satisfies LlmRerankJobData,
      opts: { jobId: bullmqJobIds[i] },
    }));
    await this.queueService.enqueueBulk<LlmRerankJobData>(
      LLM_RERANK_QUEUE,
      entries,
    );

    return plan.length;
  }

  /**
   * Generic per-entity fan-out: creates one lifecycle row per user and
   * enqueues one BullMQ job per user with the entityType discriminator
   * + pre-resolved candidate IDs. Same dedup pattern as the bill flow.
   */
  private async enqueueEntityFanOut(
    plan: ReadonlyArray<{
      profile: { userId: string; interestTags: string[] };
      rankingFlags: string[];
    }>,
    yyyymmdd: string,
    entityType: 'proposition' | 'representative',
    payload: { candidateIds: string[] },
  ): Promise<number> {
    const bullmqJobIds = plan.map(
      (entry) => `cron-${entityType}-${entry.profile.userId}-${yyyymmdd}`,
    );

    const rows = await Promise.all(
      plan.map((entry, i) =>
        this.jobs.create({
          bullmqJobId: bullmqJobIds[i],
          triggerSource: TRIGGER_SOURCE.CRON,
          userId: entry.profile.userId,
        }),
      ),
    );

    const entries = plan.map((entry, i) => ({
      data: {
        rerankJobId: rows[i].id,
        triggerSource: TRIGGER_SOURCE.CRON,
        userId: entry.profile.userId,
        rankingFlags: entry.rankingFlags,
        interestTags: [...entry.profile.interestTags],
        entityType,
        candidateIds: payload.candidateIds,
      } satisfies LlmRerankJobData,
      opts: { jobId: bullmqJobIds[i] },
    }));
    await this.queueService.enqueueBulk<LlmRerankJobData>(
      LLM_RERANK_QUEUE,
      entries,
    );

    return plan.length;
  }

  /**
   * UTC-anchored yyyymmdd for the cron's `cron-${userId}-${yyyymmdd}`
   * dedup key. Using local time would let a worker in a non-UTC TZ
   * produce a different bucket for the same logical nightly run,
   * weakening the dedup. Construct from `Date.UTC()` parts so the
   * result is stable regardless of `process.env.TZ`.
   */
  private utcYyyymmdd(d: Date): string {
    const yyyy = d.getUTCFullYear().toString();
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = d.getUTCDate().toString().padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  /**
   * T1+T2 derivation copied from `RankingFlagsService.getFlagsForUser`
   * (users service) — duplicated here to avoid a cross-bounded-context
   * module import. The two must stay in sync until #761 consolidates.
   * Unit tests on both sides lock the contract.
   *
   * T3-derived flags (immigration, health, veteran, etc.) are
   * intentionally NOT included — see class-level T3 omission note.
   */
  private deriveT1T2Flags(p: {
    housingTenure: string | null;
    childrenAgeBands: string[];
    parentOfStudent: string[];
    hasEldercareDependents: boolean | null;
    studentLevel: string | null;
    educator: boolean | null;
    employmentStatus: string | null;
    unionMember: boolean | null;
    gigWorker: boolean | null;
    primaryTransitMode: string | null;
    vehicleTypes: string[];
    specialLicenses: string[];
  }): string[] {
    const workerStatuses = new Set([
      'w2',
      '1099',
      'self_employed',
      'business_owner',
    ]);
    const flags: string[] = [];
    if (p.housingTenure === 'renter') flags.push('isRenter');
    if (p.housingTenure === 'owner') flags.push('isHomeowner');
    if (p.childrenAgeBands.length > 0 || p.parentOfStudent.length > 0) {
      flags.push('isParent');
    }
    if (p.hasEldercareDependents === true) flags.push('isCaregiver');
    if (p.studentLevel != null) flags.push('isStudent');
    if (p.educator === true) flags.push('isEducator');
    if (workerStatuses.has(p.employmentStatus ?? '')) flags.push('isWorker');
    if (p.employmentStatus === 'business_owner') flags.push('isBusinessOwner');
    if (p.unionMember === true) flags.push('isUnionMember');
    if (p.gigWorker === true) flags.push('isGigWorker');
    if (p.primaryTransitMode === 'transit') flags.push('isTransitRider');
    if (
      p.vehicleTypes.length > 0 &&
      !p.vehicleTypes.every((v) => v === 'none')
    ) {
      flags.push('isDriver');
    }
    if (p.specialLicenses.length > 0) flags.push('hasSpecialLicense');
    return flags;
  }
}
