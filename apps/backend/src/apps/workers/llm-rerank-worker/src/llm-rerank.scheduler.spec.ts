import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  LLM_RERANK_QUEUE,
  QueueService,
  TRIGGER_SOURCE,
  type LlmRerankJobData,
} from '@opuspopuli/queue-provider';

import { LlmRerankScheduler } from './llm-rerank.scheduler';
import { LlmRerankJobService } from 'src/apps/knowledge/src/domains/personalized-feed/llm-rerank-job.service';

/** Typed shape of a single entry in the `enqueueBulk` call args. */
type BulkEntry = { data: LlmRerankJobData; opts?: { jobId?: string } };

describe('LlmRerankScheduler', () => {
  let scheduler: LlmRerankScheduler;
  let db: { signalProfile: { findMany: jest.Mock } };
  let queueService: jest.Mocked<QueueService>;
  let jobs: jest.Mocked<LlmRerankJobService>;
  let config: jest.Mocked<ConfigService>;

  // Shape mirrors what scheduler.fanOutForAllActiveUsers selects out of
  // signal_profiles. Explicit typing keeps the per-test `Partial<…>`
  // overrides honest (boolean | null fields would otherwise narrow to
  // null and reject `true` in overrides).
  type SignalProfileRow = {
    userId: string;
    interestTags: string[];
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
  };

  const baseProfile: SignalProfileRow = {
    userId: 'u-1',
    interestTags: ['housing'],
    housingTenure: 'renter',
    childrenAgeBands: [],
    parentOfStudent: [],
    hasEldercareDependents: null,
    studentLevel: null,
    educator: null,
    employmentStatus: 'w2',
    unionMember: null,
    gigWorker: null,
    primaryTransitMode: null,
    vehicleTypes: [],
    specialLicenses: [],
  };

  beforeEach(async () => {
    db = {
      signalProfile: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmRerankScheduler,
        { provide: DbService, useValue: db },
        { provide: QueueService, useValue: createMock<QueueService>() },
        {
          provide: LlmRerankJobService,
          useValue: createMock<LlmRerankJobService>(),
        },
        { provide: ConfigService, useValue: createMock<ConfigService>() },
      ],
    }).compile();

    scheduler = module.get(LlmRerankScheduler);
    queueService = module.get(QueueService);
    jobs = module.get(LlmRerankJobService);
    config = module.get(ConfigService);

    // Default: cron enabled (env var unset → falls back to "enabled").
    // Individual tests override with `key === 'LLM_RERANK_CRON_ENABLED' ? 'false' : undefined`.
    config.get.mockImplementation(() => undefined);
    queueService.enqueueBulk.mockResolvedValue([]);
  });

  describe('runNightlyFanout gating', () => {
    it('no-ops when LLM_RERANK_CRON_ENABLED=false', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'LLM_RERANK_CRON_ENABLED' ? 'false' : undefined,
      );

      await scheduler.runNightlyFanout();

      expect(db.signalProfile.findMany).not.toHaveBeenCalled();
      expect(queueService.enqueueBulk).not.toHaveBeenCalled();
    });

    it('proceeds to fanout when enabled', async () => {
      db.signalProfile.findMany.mockResolvedValue([baseProfile]);
      jobs.create.mockResolvedValue({ id: 'row-1' });

      await scheduler.runNightlyFanout();

      expect(jobs.create).toHaveBeenCalledTimes(1);
      expect(queueService.enqueueBulk).toHaveBeenCalledTimes(1);
    });

    it('swallows errors in the fanout — a single bad user doesn’t crash the cron', async () => {
      db.signalProfile.findMany.mockRejectedValue(new Error('db down'));

      // Must not throw — the cron handler should log + return.
      await expect(scheduler.runNightlyFanout()).resolves.toBeUndefined();
    });
  });

  describe('fanOutForAllActiveUsers (batched path)', () => {
    it('returns {enqueued:0} when no users have declared interest tags', async () => {
      db.signalProfile.findMany.mockResolvedValue([]);

      const result = await scheduler.fanOutForAllActiveUsers();

      expect(result.enqueued).toBe(0);
      expect(queueService.enqueueBulk).not.toHaveBeenCalled();
    });

    it('creates one lifecycle row per active user and bulk-enqueues all at once', async () => {
      db.signalProfile.findMany.mockResolvedValue([
        { ...baseProfile, userId: 'u-1' },
        { ...baseProfile, userId: 'u-2' },
        { ...baseProfile, userId: 'u-3' },
      ]);
      jobs.create
        .mockResolvedValueOnce({ id: 'row-1' })
        .mockResolvedValueOnce({ id: 'row-2' })
        .mockResolvedValueOnce({ id: 'row-3' });

      const result = await scheduler.fanOutForAllActiveUsers();

      expect(result.enqueued).toBe(3);
      expect(jobs.create).toHaveBeenCalledTimes(3);
      expect(queueService.enqueueBulk).toHaveBeenCalledTimes(1);

      const queueName = queueService.enqueueBulk.mock.calls[0][0] as string;
      const entries = queueService.enqueueBulk.mock.calls[0][1] as BulkEntry[];
      expect(queueName).toBe(LLM_RERANK_QUEUE);
      expect(entries).toHaveLength(3);
      expect(entries[0].data.rerankJobId).toBe('row-1');
      expect(entries[0].data.userId).toBe('u-1');
      expect(entries[0].data.triggerSource).toBe(TRIGGER_SOURCE.CRON);
      expect(entries[0].opts?.jobId).toMatch(/^cron-u-1-\d{8}$/);
    });

    it('uses UTC-anchored yyyymmdd in the dedup jobId (N16)', async () => {
      db.signalProfile.findMany.mockResolvedValue([baseProfile]);
      jobs.create.mockResolvedValue({ id: 'row-1' });

      await scheduler.fanOutForAllActiveUsers();

      const entries = queueService.enqueueBulk.mock.calls[0][1] as BulkEntry[];
      const today = new Date();
      const expected = `cron-u-1-${today.getUTCFullYear()}${String(
        today.getUTCMonth() + 1,
      ).padStart(2, '0')}${String(today.getUTCDate()).padStart(2, '0')}`;
      expect(entries[0].opts?.jobId).toBe(expected);
    });
  });

  describe('deriveT1T2Flags', () => {
    async function fanOutOne(
      profileOverrides: Partial<SignalProfileRow>,
    ): Promise<string[]> {
      db.signalProfile.findMany.mockResolvedValue([
        { ...baseProfile, ...profileOverrides },
      ]);
      jobs.create.mockResolvedValue({ id: 'row-1' });
      await scheduler.fanOutForAllActiveUsers();
      // Use the LATEST enqueueBulk call so tests that fanOut multiple
      // times in one `it()` read the right invocation.
      const latest = queueService.enqueueBulk.mock.calls.at(-1);
      const entries = (latest?.[1] ?? []) as BulkEntry[];
      return entries[0].data.rankingFlags;
    }

    it('emits isRenter for housingTenure="renter"', async () => {
      expect(await fanOutOne({ housingTenure: 'renter' })).toContain(
        'isRenter',
      );
    });

    it('emits isHomeowner for housingTenure="owner"', async () => {
      expect(await fanOutOne({ housingTenure: 'owner' })).toContain(
        'isHomeowner',
      );
    });

    it('emits isParent when childrenAgeBands has entries', async () => {
      expect(await fanOutOne({ childrenAgeBands: ['5-12'] })).toContain(
        'isParent',
      );
    });

    it('emits isCaregiver for hasEldercareDependents=true', async () => {
      expect(await fanOutOne({ hasEldercareDependents: true })).toContain(
        'isCaregiver',
      );
    });

    it('emits isWorker for w2/1099/self_employed/business_owner statuses', async () => {
      expect(await fanOutOne({ employmentStatus: 'w2' })).toContain('isWorker');
      expect(await fanOutOne({ employmentStatus: 'business_owner' })).toEqual(
        expect.arrayContaining(['isWorker', 'isBusinessOwner']),
      );
    });

    it('emits isDriver only when vehicleTypes has at least one non-"none" entry', async () => {
      expect(await fanOutOne({ vehicleTypes: ['car'] })).toContain('isDriver');
      expect(await fanOutOne({ vehicleTypes: ['none', 'none'] })).not.toContain(
        'isDriver',
      );
    });

    it('does NOT emit T3 protected-class flags (intentional — see class docstring)', async () => {
      const flags = await fanOutOne({});
      expect(flags).not.toContain('isVeteran');
      expect(flags).not.toContain('hasImmigrationConcern');
      expect(flags).not.toContain('isLowIncome');
    });
  });
});
