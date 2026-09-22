import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { PipelineJobService } from './pipeline-job.service';

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
});
