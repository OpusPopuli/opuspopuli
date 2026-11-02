/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from '@nestjs/config';
import { DelayedError, Job } from 'bullmq';

import { RegionSyncProcessor } from './region-sync.processor';
import { RegionDomainService } from 'src/apps/region/src/domains/region.service';
import { PipelineJobService } from 'src/apps/region/src/domains/pipeline-job.service';
import { BoundaryLoaderService } from 'src/apps/region/src/domains/boundary-loader.service';
import {
  QUEUE_CONNECTION,
  QueueService,
  createWorker,
} from '@opuspopuli/queue-provider';
import { DataType } from '@opuspopuli/region-provider';

jest.mock('@opuspopuli/queue-provider', () => ({
  ...jest.requireActual('@opuspopuli/queue-provider'),
  createWorker: jest.fn().mockReturnValue({
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  }),
}));

describe('RegionSyncProcessor', () => {
  let processor: RegionSyncProcessor;
  let regionService: jest.Mocked<RegionDomainService>;
  let pipelineJobService: jest.Mocked<PipelineJobService>;
  let boundaryLoader: jest.Mocked<BoundaryLoaderService>;
  let queueService: jest.Mocked<QueueService>;
  /** The lock's Redis calls: SET NX answers 'OK' (taken) unless a test says otherwise. */
  let redis: { quit: jest.Mock; set: jest.Mock; eval: jest.Mock };

  const mockSyncResults = [
    {
      regionId: 'california',
      dataType: DataType.PROPOSITIONS,
      itemsProcessed: 10,
      itemsCreated: 5,
      itemsUpdated: 5,
      itemsSkipped: 0,
      errors: [],
      syncedAt: new Date(),
    },
  ];

  function buildJob(overrides: Partial<Job> = {}): Job<any> {
    return {
      id: 'job-123',
      data: {
        pipelineJobId: 'pipeline-uuid-1',
        triggerSource: 'manual',
        regionId: undefined,
        // One type — what every cron is; a job with none or several is a
        // parent that fans out (S2), tested on its own below.
        dataTypes: ['propositions'],
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as Job<any>;
  }

  beforeEach(async () => {
    redis = {
      quit: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionSyncProcessor,
        {
          provide: RegionDomainService,
          useValue: createMock<RegionDomainService>(),
        },
        {
          provide: PipelineJobService,
          useValue: createMock<PipelineJobService>(),
        },
        {
          provide: BoundaryLoaderService,
          useValue: createMock<BoundaryLoaderService>(),
        },
        { provide: QUEUE_CONNECTION, useValue: redis },
        { provide: ConfigService, useValue: createMock<ConfigService>() },
        { provide: QueueService, useValue: createMock<QueueService>() },
      ],
    }).compile();

    processor = module.get<RegionSyncProcessor>(RegionSyncProcessor);
    regionService = module.get(RegionDomainService);
    pipelineJobService = module.get(PipelineJobService);
    boundaryLoader = module.get(BoundaryLoaderService);
    queueService = module.get(QueueService);

    regionService.syncAll.mockResolvedValue(mockSyncResults);
    boundaryLoader.loadAll.mockResolvedValue({
      ok: true,
      counts: { existing: 6200, upserted: 5, failed: 0, missingKey: 0 },
    });
    pipelineJobService.markRunning.mockResolvedValue(undefined);
    pipelineJobService.markSucceeded.mockResolvedValue(undefined);
    pipelineJobService.markFailed.mockResolvedValue(undefined);
    pipelineJobService.sweepStaleRunning.mockResolvedValue(0);
    pipelineJobService.sweepOrphanedQueued.mockResolvedValue(0);
    // #1319: read before any work, so a cancelled job cannot be restarted
    // forever by BullMQ's stalled-job re-delivery.
    pipelineJobService.isCancelled.mockResolvedValue(false);

    const configMock = module.get<jest.Mocked<ConfigService>>(ConfigService);
    configMock.get.mockReturnValue('600000');
  });

  it('is defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process (via onApplicationBootstrap + private process)', () => {
    function getHandler() {
      return (createWorker as jest.Mock).mock.calls.at(-1)[2];
    }

    it('marks job running then succeeded on success', async () => {
      await processor.onApplicationBootstrap();

      await getHandler()(buildJob());

      expect(pipelineJobService.markRunning).toHaveBeenCalledWith(
        'pipeline-uuid-1',
        'job-123',
      );
      expect(pipelineJobService.markSucceeded).toHaveBeenCalledWith(
        'pipeline-uuid-1',
        expect.any(Array),
      );
      expect(pipelineJobService.markFailed).not.toHaveBeenCalled();
    });

    it('marks job failed on final failure (retries exhausted)', async () => {
      regionService.syncAll.mockRejectedValue(new Error('Scrape failed'));
      await processor.onApplicationBootstrap();
      const job = buildJob({ attemptsMade: 2, opts: { attempts: 3 } } as any);

      await expect(getHandler()(job)).rejects.toThrow('Scrape failed');

      expect(pipelineJobService.markFailed).toHaveBeenCalledWith(
        'pipeline-uuid-1',
        'Scrape failed',
      );
    });

    it('does not mark failed on intermediate retry', async () => {
      regionService.syncAll.mockRejectedValue(new Error('Transient'));
      await processor.onApplicationBootstrap();
      const job = buildJob({ attemptsMade: 0, opts: { attempts: 3 } } as any);

      await expect(getHandler()(job)).rejects.toThrow('Transient');

      expect(pipelineJobService.markFailed).not.toHaveBeenCalled();
    });
  });

  describe('startup sweep of stale RUNNING rows (#730)', () => {
    it('calls sweepStaleRunning with the configured threshold on bootstrap', async () => {
      await processor.onApplicationBootstrap();

      expect(pipelineJobService.sweepStaleRunning).toHaveBeenCalledTimes(1);
      expect(pipelineJobService.sweepStaleRunning).toHaveBeenCalledWith(600000);
    });

    it('fails day-old queued rows whose queue job is gone or finished (§4g)', async () => {
      pipelineJobService.sweepOrphanedQueued.mockResolvedValue(1);
      const states: Record<string, string> = {
        live: 'waiting',
        retrying: 'delayed',
        done: 'completed',
        dead: 'failed',
      };
      queueService.getJobInfo.mockImplementation(async (_q, id) =>
        states[id] ? ({ id, state: states[id], progress: 0 } as never) : null,
      );

      await processor.onApplicationBootstrap();

      const [age, jobPending] =
        pipelineJobService.sweepOrphanedQueued.mock.calls[0];
      expect(age).toBe(24 * 60 * 60 * 1000);
      await expect(jobPending('live')).resolves.toBe(true);
      await expect(jobPending('retrying')).resolves.toBe(true);
      await expect(jobPending('gone')).resolves.toBe(false);
      // Retained after finishing, but never run again.
      await expect(jobPending('done')).resolves.toBe(false);
      await expect(jobPending('dead')).resolves.toBe(false);
    });

    it('also closes requests whose jobs have all finished (S2)', async () => {
      // A last child whose own settle failed leaves its request `running`.
      pipelineJobService.settleFinishedParents.mockResolvedValue(1);

      await processor.onApplicationBootstrap();

      expect(pipelineJobService.settleFinishedParents).toHaveBeenCalledTimes(1);
    });

    it('still settles parents and starts the worker when the orphan sweep throws', async () => {
      pipelineJobService.sweepOrphanedQueued.mockRejectedValueOnce(
        new Error('redis down'),
      );

      await expect(processor.onApplicationBootstrap()).resolves.toBeUndefined();

      expect(pipelineJobService.settleFinishedParents).toHaveBeenCalledTimes(1);
      expect(createWorker).toHaveBeenCalled();
    });

    it('continues starting the worker even if the sweep throws', async () => {
      pipelineJobService.sweepStaleRunning.mockRejectedValueOnce(
        new Error('DB connection lost'),
      );

      // Should not throw — the catch path swallows the error.
      await expect(processor.onApplicationBootstrap()).resolves.toBeUndefined();

      // Worker was still created.
      expect(createWorker).toHaveBeenCalled();
    });

    it('falls back to the default when PIPELINE_JOB_STALE_AGE_MS is malformed', async () => {
      const configMock = (
        processor as unknown as { config: jest.Mocked<ConfigService> }
      ).config;
      configMock.get.mockReturnValue('not-a-number');

      await processor.onApplicationBootstrap();

      expect(pipelineJobService.sweepStaleRunning).toHaveBeenCalledWith(600000);
    });

    it('falls back to the default when PIPELINE_JOB_STALE_AGE_MS is non-positive', async () => {
      const configMock = (
        processor as unknown as { config: jest.Mocked<ConfigService> }
      ).config;
      configMock.get.mockReturnValue('-100');

      await processor.onApplicationBootstrap();

      expect(pipelineJobService.sweepStaleRunning).toHaveBeenCalledWith(600000);
    });

    it('honors a valid override', async () => {
      const configMock = (
        processor as unknown as { config: jest.Mocked<ConfigService> }
      ).config;
      configMock.get.mockReturnValue('30000');

      await processor.onApplicationBootstrap();

      expect(pipelineJobService.sweepStaleRunning).toHaveBeenCalledWith(30000);
    });
  });
  describe('cancellation (#1319)', () => {
    /**
     * BullMQ re-delivers a stalled job when a worker restarts. Without a
     * durable marker read BEFORE any work, a cancelled job begins again from
     * item 1 on every boot — which is what left hand-edited Redis as the only
     * way to stop a run that was failing every item for ten hours.
     */
    it('does no work when the job row says cancelled', async () => {
      pipelineJobService.isCancelled.mockResolvedValue(true);

      await processor.onApplicationBootstrap();
      const handler = (createWorker as jest.Mock).mock.calls.at(-1)[2];

      const result = await handler(buildJob());

      expect(result).toEqual([]);
      expect(regionService.syncAll).not.toHaveBeenCalled();
      // Must not flip the row back to running, or the next restart undoes it.
      expect(pipelineJobService.markRunning).not.toHaveBeenCalled();
    });

    it('proceeds when the cancellation check itself fails', async () => {
      // Fail OPEN: a check that takes down the queue when the database
      // hiccups is worse than the thing it guards against.
      pipelineJobService.isCancelled.mockRejectedValue(new Error('db down'));

      await processor.onApplicationBootstrap();
      const handler = (createWorker as jest.Mock).mock.calls.at(-1)[2];

      await handler(buildJob());

      expect(regionService.syncAll).toHaveBeenCalled();
    });
  });

  describe('boundary refresh dispatch (#1122)', () => {
    function getHandler() {
      return (createWorker as jest.Mock).mock.calls.at(-1)[2];
    }

    function boundaryJob() {
      return {
        id: 'job-b1',
        data: {
          pipelineJobId: 'pipeline-b1',
          triggerSource: 'manual',
          regionId: undefined,
          dataTypes: ['boundaries'],
          force: true,
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;
    }

    it('runs the boundary loader, not syncAll, and threads force through', async () => {
      await processor.onApplicationBootstrap();

      await getHandler()(boundaryJob());

      expect(boundaryLoader.loadAll).toHaveBeenCalledWith({ force: true });
      expect(regionService.syncAll).not.toHaveBeenCalled();
    });

    it('fans a job mixing boundaries with civic types out into BOTH, dropping nothing', async () => {
      // Guards the #1122 footgun: boundaries is a valid DataTypeGQL, so a
      // syncRegionData([representatives, boundaries]) call must sync
      // representatives AND load boundaries — not silently drop the former.
      // Since S2 that is one child job each.
      pipelineJobService.findChild.mockResolvedValue(null);
      pipelineJobService.create.mockImplementation(async (input) => ({
        id: `row-${input.dataTypes![0]}`,
      }));
      const job = {
        id: 'job-mix',
        data: {
          pipelineJobId: 'pipeline-mix',
          triggerSource: 'manual',
          dataTypes: ['representatives', 'boundaries'],
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<any>;

      await processor.onApplicationBootstrap();
      await getHandler()(job);

      const enqueued = queueService.enqueue.mock.calls.map(
        ([, data]) => (data as { dataTypes: string[] }).dataTypes,
      );
      expect(enqueued).toEqual([['representatives'], ['boundaries']]);
      // The parent itself runs neither.
      expect(boundaryLoader.loadAll).not.toHaveBeenCalled();
      expect(regionService.syncAll).not.toHaveBeenCalled();
    });

    it('maps boundary counts into the succeeded result (upserted→created, missingKey→skipped)', async () => {
      boundaryLoader.loadAll.mockResolvedValue({
        ok: false,
        counts: { existing: 6200, upserted: 5, failed: 2, missingKey: 1 },
      });

      await processor.onApplicationBootstrap();
      await getHandler()(boundaryJob());

      const [, results] = pipelineJobService.markSucceeded.mock.calls.at(-1)!;
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({
          dataType: 'boundaries',
          itemsProcessed: 8,
          itemsCreated: 5,
          itemsSkipped: 1,
        }),
      );
      expect(results[0].errors).toHaveLength(1);
    });
  });

  describe('one job per data type (S2)', () => {
    function getHandler() {
      return (createWorker as jest.Mock).mock.calls.at(-1)[2];
    }
    const parentJob = (dataTypes?: string[]) =>
      ({
        id: 'startup-20261023',
        data: {
          pipelineJobId: 'parent-1',
          triggerSource: 'startup',
          dataTypes,
        },
        attemptsMade: 0,
        opts: { attempts: 1 },
      }) as unknown as Job<any>;

    beforeEach(() => {
      pipelineJobService.findChild.mockResolvedValue(null);
      pipelineJobService.markParentRunning.mockResolvedValue({
        enqueuedBy: 'admin-1',
      });
      pipelineJobService.create.mockImplementation(async (input) => ({
        id: `row-${input.dataTypes![0]}`,
      }));
      regionService.syncableDataTypes.mockResolvedValue([
        'propositions',
        'bills',
        'meetings',
      ]);
    });

    it('fans a request for every type out into one child each, bills first, and syncs nothing itself', async () => {
      await processor.onApplicationBootstrap();

      await getHandler()(parentJob());

      expect(
        queueService.enqueue.mock.calls.map(([, d, o]) => [
          (d as { dataTypes: string[] }).dataTypes[0],
          (d as { parentJobId: string }).parentJobId,
          o?.jobId,
        ]),
      ).toEqual([
        ['bills', 'parent-1', 'parent-1-bills'],
        ['propositions', 'parent-1', 'parent-1-propositions'],
        ['meetings', 'parent-1', 'parent-1-meetings'],
      ]);
      expect(regionService.syncAll).not.toHaveBeenCalled();
      expect(pipelineJobService.markParentRunning).toHaveBeenCalledWith(
        'parent-1',
        'startup-20261023',
      );
      // Children carry who asked, like the request.
      expect(pipelineJobService.create).toHaveBeenCalledWith(
        expect.objectContaining({ enqueuedBy: 'admin-1' }),
      );
    });

    it('fans out nothing for a request already closed or cancelled', async () => {
      // A redelivery after it settled, or a cancel since its own check.
      pipelineJobService.markParentRunning.mockResolvedValue(null);
      await processor.onApplicationBootstrap();

      await getHandler()(parentJob());

      expect(pipelineJobService.create).not.toHaveBeenCalled();
      expect(queueService.enqueue).not.toHaveBeenCalled();
    });

    it('re-runs no child that already ran, and settles the parent itself', async () => {
      pipelineJobService.findChild.mockImplementation(async (_p, type) => ({
        id: `row-${type}`,
        bullmqJobId: `parent-1-${type}`,
        status: type === 'bills' ? 'queued' : 'succeeded',
      }));
      await processor.onApplicationBootstrap();

      await getHandler()(parentJob());

      expect(
        queueService.enqueue.mock.calls.map(([, d]) => (d as any).dataTypes[0]),
      ).toEqual(['bills']);
      expect(pipelineJobService.settleParent).toHaveBeenCalledWith('parent-1');
    });

    it('fails the children it never enqueued — only those — when its last attempt fails', async () => {
      queueService.enqueue
        .mockResolvedValueOnce('ok' as never)
        .mockRejectedValueOnce(new Error('redis gone'));
      await processor.onApplicationBootstrap();

      await expect(getHandler()(parentJob())).rejects.toThrow('redis gone');

      // bills was enqueued and is waiting for a slot: not failed.
      expect(pipelineJobService.failChildren).toHaveBeenCalledWith(
        ['row-propositions', 'row-meetings'],
        expect.stringContaining('redis gone'),
      );
      expect(pipelineJobService.markFailed).toHaveBeenCalledWith(
        'parent-1',
        expect.stringContaining('redis gone'),
      );
    });

    it('leaves a failed fan-out for its retry when attempts remain', async () => {
      queueService.enqueue.mockRejectedValue(new Error('redis gone'));
      await processor.onApplicationBootstrap();
      const job = parentJob();
      (job as any).opts = { attempts: 3 };

      await expect(getHandler()(job)).rejects.toThrow('redis gone');

      expect(pipelineJobService.failChildren).not.toHaveBeenCalled();
    });

    it('gives each child a job id BullMQ accepts', async () => {
      const validate = (
        Job.prototype as unknown as {
          validateOptions: (this: unknown, json: { data: string }) => void;
        }
      ).validateOptions;
      await processor.onApplicationBootstrap();

      await getHandler()(parentJob());

      for (const [, , opts] of queueService.enqueue.mock.calls) {
        expect(() =>
          validate.call(
            { opts: { jobId: opts?.jobId }, name: 'x' },
            {
              data: '{}',
            },
          ),
        ).not.toThrow();
      }
    });

    it('creates every child row before enqueuing any child', async () => {
      // A child that finished while its siblings did not exist yet would
      // settle the parent early.
      await processor.onApplicationBootstrap();

      await getHandler()(parentJob());

      const lastCreate = Math.max(
        ...pipelineJobService.create.mock.invocationCallOrder,
      );
      const firstEnqueue = Math.min(
        ...queueService.enqueue.mock.invocationCallOrder,
      );
      expect(lastCreate).toBeLessThan(firstEnqueue);
    });

    it('reuses the children a previous delivery created', async () => {
      pipelineJobService.findChild.mockImplementation(async (_p, type) => ({
        id: `row-${type}`,
        bullmqJobId: `parent-1-${type}`,
        status: 'queued',
      }));
      await processor.onApplicationBootstrap();

      await getHandler()(parentJob());

      expect(pipelineJobService.create).not.toHaveBeenCalled();
      expect(queueService.enqueue).toHaveBeenCalledTimes(3);
    });

    it('closes a request with nothing to sync at once', async () => {
      regionService.syncableDataTypes.mockResolvedValue([]);
      await processor.onApplicationBootstrap();

      await getHandler()(parentJob());

      expect(pipelineJobService.markSucceeded).toHaveBeenCalledWith(
        'parent-1',
        [],
      );
      expect(queueService.enqueue).not.toHaveBeenCalled();
    });

    it('waits, without running or using an attempt, while another sync of its type runs', async () => {
      redis.set.mockResolvedValue(null); // SET NX: held
      await processor.onApplicationBootstrap();
      const job = buildJob();

      await expect(getHandler()(job, 'token-1')).rejects.toBeInstanceOf(
        DelayedError,
      );

      expect(job.moveToDelayed).toHaveBeenCalledWith(
        expect.any(Number),
        'token-1',
      );
      expect(regionService.syncAll).not.toHaveBeenCalled();
      expect(pipelineJobService.markRunning).not.toHaveBeenCalled();
    });

    it('releases its type lock and settles its parent when it finishes', async () => {
      await processor.onApplicationBootstrap();
      const job = buildJob();
      job.data.parentJobId = 'parent-1';

      await getHandler()(job);

      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('DEL'),
        1,
        expect.stringContaining('locks:region-sync:propositions'),
        expect.any(String),
      );
      expect(pipelineJobService.settleParent).toHaveBeenCalledWith('parent-1');
    });

    it('settles its parent when it fails, too', async () => {
      regionService.syncAll.mockRejectedValue(new Error('Scrape failed'));
      await processor.onApplicationBootstrap();
      const job = buildJob({ opts: { attempts: 1 } } as any);
      job.data.parentJobId = 'parent-1';

      await expect(getHandler()(job)).rejects.toThrow('Scrape failed');

      expect(pipelineJobService.markFailed).toHaveBeenCalled();
      expect(pipelineJobService.settleParent).toHaveBeenCalledWith('parent-1');
    });

    it('closes its own row and settles its parent when its request was cancelled', async () => {
      // A child created just after the cancel escaped its fan-out; it must
      // not wait `queued` for ever.
      pipelineJobService.isCancelled.mockResolvedValue(true);
      await processor.onApplicationBootstrap();
      const job = buildJob();
      job.data.parentJobId = 'parent-1';

      await getHandler()(job);

      expect(pipelineJobService.cancel).toHaveBeenCalledWith(
        'pipeline-uuid-1',
        expect.any(String),
      );
      expect(pipelineJobService.settleParent).toHaveBeenCalledWith('parent-1');
    });

    it('fails its row when the type lock cannot be taken on its last attempt', async () => {
      redis.set.mockRejectedValue(new Error('redis gone'));
      await processor.onApplicationBootstrap();
      const job = buildJob({ opts: { attempts: 1 } } as any);
      job.data.parentJobId = 'parent-1';

      await expect(getHandler()(job)).rejects.toThrow('redis gone');

      expect(pipelineJobService.markFailed).toHaveBeenCalledWith(
        'pipeline-uuid-1',
        expect.stringContaining('redis gone'),
      );
      expect(pipelineJobService.settleParent).toHaveBeenCalledWith('parent-1');
    });

    it('reuses the row a previous delivery of a cron job created', async () => {
      // A cron job carries no row id; its redelivery must not become a
      // second request that fans out again.
      pipelineJobService.findByBullmqJobId.mockResolvedValue({ id: 'row-1' });
      await processor.onApplicationBootstrap();
      const job = buildJob();
      delete job.data.pipelineJobId;

      await getHandler()(job);

      expect(pipelineJobService.create).not.toHaveBeenCalled();
      expect(pipelineJobService.markRunning).toHaveBeenCalledWith(
        'row-1',
        'job-123',
      );
    });
  });
});
