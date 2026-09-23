import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { PipelineJobService } from './pipeline-job.service';
import { SyncJobStatus } from './models/pipeline-job.model';

/**
 * Cancelling has to survive a worker restart.
 *
 * BullMQ re-delivers a stalled job when a worker comes back, so a marker that
 * lives only in the queue is not a cancellation — it is a pause. On
 * 2026-09-22 that difference meant a run failing every item for ten hours
 * could only be stopped by hand-editing Redis.
 */
describe('PipelineJobService — cancellation', () => {
  let service: PipelineJobService;
  let prisma: { pipelineJob: { updateMany: jest.Mock; findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      pipelineJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ status: 'running' }),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PipelineJobService,
        { provide: DbService, useValue: prisma },
      ] as never[],
    }).compile();
    service = moduleRef.get(PipelineJobService);
  });

  it('cancels only a job that has not finished', async () => {
    await service.cancel('job-1', 'operator stopped it');

    const where = prisma.pipelineJob.updateMany.mock.calls[0][0].where;
    // A late click must not rewrite the history of a finished run.
    expect(where.status).toEqual({ in: ['queued', 'running'] });
    expect(where.id).toBe('job-1');
  });

  it('records why, not just that', async () => {
    await service.cancel('job-1', 'failing every item');

    const data = prisma.pipelineJob.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe('cancelled');
    expect(data.errorMessage).toContain('failing every item');
    expect(data.finishedAt).toBeInstanceOf(Date);
  });

  it('reports false when the job had already finished', async () => {
    prisma.pipelineJob.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.cancel('job-1', 'too late')).resolves.toBe(false);
  });

  it('reads cancellation back, which is what survives a restart', async () => {
    prisma.pipelineJob.findUnique.mockResolvedValue({ status: 'cancelled' });
    await expect(service.isCancelled('job-1')).resolves.toBe(true);

    prisma.pipelineJob.findUnique.mockResolvedValue({ status: 'running' });
    await expect(service.isCancelled('job-1')).resolves.toBe(false);
  });

  it('treats a missing row as not cancelled', async () => {
    prisma.pipelineJob.findUnique.mockResolvedValue(null);

    // A job with no row is a cron/manifest job the processor creates itself;
    // refusing to run it would break that path entirely.
    await expect(service.isCancelled('nope')).resolves.toBe(false);
  });

  /**
   * The write path gained `cancelled` before the read model knew about it.
   * `toModel` cast with `as SyncJobStatus`, so that typechecked and then
   * failed GraphQL serialization on a NON-NULLABLE field at read time —
   * breaking the very query an operator uses to confirm a cancel took effect.
   *
   * Caught by the pre-push AI review gate, not by the type system, because the
   * cast silenced the type system.
   */
  describe('cancelled is readable, not just writable (#1319)', () => {
    it('exposes CANCELLED on the GraphQL enum', () => {
      expect(Object.values(SyncJobStatus)).toContain('CANCELLED');
    });

    it('maps a cancelled row onto the model without throwing', async () => {
      prisma.pipelineJob.findUnique.mockResolvedValue({
        id: 'job-1',
        status: 'cancelled',
        triggerSource: 'manual',
        regionId: 'california',
        dataTypes: ['civics'],
        enqueuedAt: new Date(),
        startedAt: new Date(),
        finishedAt: new Date(),
        errorMessage: 'Cancelled: failing every item',
        result: null,
      });

      const model = await service.findById('job-1');

      expect(model?.status).toBe(SyncJobStatus.CANCELLED);
    });

    it('refuses a status the enum cannot name, rather than guessing', async () => {
      prisma.pipelineJob.findUnique.mockResolvedValue({
        id: 'job-1',
        status: 'paused',
        triggerSource: 'manual',
        regionId: null,
        dataTypes: [],
        enqueuedAt: new Date(),
        startedAt: null,
        finishedAt: null,
        errorMessage: null,
        result: null,
      });

      // A job whose status we cannot name is not one to describe with a
      // plausible-looking guess.
      await expect(service.findById('job-1')).rejects.toThrow(/SyncJobStatus/);
    });
  });
});
