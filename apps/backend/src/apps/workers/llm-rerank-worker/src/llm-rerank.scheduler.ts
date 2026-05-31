import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  QueueService,
  LLM_RERANK_QUEUE,
  TRIGGER_SOURCE,
  type LlmRerankJobData,
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
  async fanOutForAllActiveUsers(): Promise<{ enqueued: number }> {
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
    if (profiles.length === 0) return { enqueued: 0 };

    const yyyymmdd = this.utcYyyymmdd(new Date());
    const plan = profiles.map((p) => ({
      profile: p,
      rankingFlags: this.deriveT1T2Flags(p),
      bullmqJobId: `cron-${p.userId}-${yyyymmdd}`,
    }));

    // Upsert lifecycle rows in parallel (idempotent on bullmqJobId after
    // migration 20260530200000 added the unique constraint).
    const rows = await Promise.all(
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
    const entries = plan.map((entry, i) => ({
      data: {
        rerankJobId: rows[i].id,
        triggerSource: TRIGGER_SOURCE.CRON,
        userId: entry.profile.userId,
        rankingFlags: entry.rankingFlags,
        interestTags: [...entry.profile.interestTags],
      } satisfies LlmRerankJobData,
      opts: { jobId: entry.bullmqJobId },
    }));
    await this.queueService.enqueueBulk<LlmRerankJobData>(
      LLM_RERANK_QUEUE,
      entries,
    );

    return { enqueued: plan.length };
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
