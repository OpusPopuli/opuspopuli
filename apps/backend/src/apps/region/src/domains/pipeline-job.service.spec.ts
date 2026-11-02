import { PipelineJobService } from './pipeline-job.service';
import { JOB_STATUS } from '@opuspopuli/queue-provider';

function buildMockPrisma() {
  return {
    pipelineJob: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('PipelineJobService', () => {
  describe('markRunning', () => {
    it('issues an updateMany that excludes SUCCEEDED records', async () => {
      const prisma = buildMockPrisma();
      const svc = new PipelineJobService(prisma as never);

      await svc.markRunning('job-1', 'bullmq-1');

      expect(prisma.pipelineJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'job-1',
            status: { notIn: [JOB_STATUS.SUCCEEDED, JOB_STATUS.CANCELLED] },
          },
        }),
      );
    });

    it('does not overwrite a SUCCEEDED record when BullMQ retries a stalled job', async () => {
      const prisma = buildMockPrisma();
      // Simulate Prisma returning count:0 when the where-clause excludes the row
      prisma.pipelineJob.updateMany.mockResolvedValue({ count: 0 });

      const svc = new PipelineJobService(prisma as never);
      // Should resolve without throwing even when no rows are updated
      await expect(
        svc.markRunning('job-1', 'bullmq-2'),
      ).resolves.toBeUndefined();
    });

    it('increments attempts on each call for legitimate retries', async () => {
      const prisma = buildMockPrisma();
      const svc = new PipelineJobService(prisma as never);

      await svc.markRunning('job-1', 'bullmq-1');

      expect(prisma.pipelineJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ attempts: { increment: 1 } }),
        }),
      );
    });
  });

  describe('sweepStaleRunning (#730)', () => {
    it('marks RUNNING rows older than maxAgeMs as FAILED with cutoff in where clause', async () => {
      const prisma = buildMockPrisma();
      prisma.pipelineJob.findMany.mockResolvedValue([
        { id: 'a', parentJobId: null },
        { id: 'b', parentJobId: null },
      ]);
      prisma.pipelineJob.updateMany.mockResolvedValue({ count: 2 });
      const svc = new PipelineJobService(prisma as never);

      const before = Date.now();
      const count = await svc.sweepStaleRunning(600_000);
      const after = Date.now();

      expect(count).toBe(2);
      const found = prisma.pipelineJob.findMany.mock.calls[0][0];
      expect(found.where.status).toBe(JOB_STATUS.RUNNING);
      const call = prisma.pipelineJob.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        id: { in: ['a', 'b'] },
        status: JOB_STATUS.RUNNING,
      });
      // The cutoff Date should be roughly (now - maxAgeMs)
      const cutoffMs = (found.where.startedAt.lt as Date).getTime();
      expect(cutoffMs).toBeGreaterThanOrEqual(before - 600_000 - 5);
      expect(cutoffMs).toBeLessThanOrEqual(after - 600_000 + 5);
      expect(call.data.status).toBe(JOB_STATUS.FAILED);
      expect(call.data.errorMessage).toMatch(/Abandoned/);
    });

    it('returns 0 when no rows match without throwing', async () => {
      const prisma = buildMockPrisma();
      prisma.pipelineJob.findMany.mockResolvedValue([]);
      const svc = new PipelineJobService(prisma as never);

      const count = await svc.sweepStaleRunning(600_000);

      expect(count).toBe(0);
      expect(prisma.pipelineJob.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('sweepOrphanedQueued (§4g)', () => {
    it('fails old queued rows whose queue job is gone, and only those', async () => {
      const prisma = buildMockPrisma();
      prisma.pipelineJob.findMany.mockResolvedValue([
        { id: 'orphan', bullmqJobId: 'gone', parentJobId: null },
        { id: 'waiting', bullmqJobId: 'still-there', parentJobId: null },
      ]);
      const svc = new PipelineJobService(prisma as never);
      const jobExists = jest.fn(async (id: string) => id === 'still-there');

      const before = Date.now();
      const count = await svc.sweepOrphanedQueued(86_400_000, jobExists);

      expect(count).toBe(1);
      const found = prisma.pipelineJob.findMany.mock.calls[0][0];
      expect(found.where.status).toBe(JOB_STATUS.QUEUED);
      const cutoff = (found.where.enqueuedAt.lt as Date).getTime();
      expect(cutoff).toBeGreaterThanOrEqual(before - 86_400_000);
      expect(cutoff).toBeLessThanOrEqual(Date.now() - 86_400_000);
      const call = prisma.pipelineJob.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        id: { in: ['orphan'] },
        status: JOB_STATUS.QUEUED,
      });
      expect(call.data.status).toBe(JOB_STATUS.FAILED);
      expect(call.data.errorMessage).toMatch(/no pending queue job/);
    });

    it('settles each orphan parent once', async () => {
      const prisma = buildMockPrisma();
      prisma.pipelineJob.findMany.mockResolvedValue([
        { id: 'a', bullmqJobId: 'gone-a', parentJobId: 'req-1' },
        { id: 'b', bullmqJobId: 'gone-b', parentJobId: 'req-1' },
        { id: 'c', bullmqJobId: 'gone-c', parentJobId: null },
      ]);
      const svc = new PipelineJobService(prisma as never);
      const settle = jest
        .spyOn(svc, 'settleParent')
        .mockResolvedValue(undefined as never);

      await svc.sweepOrphanedQueued(86_400_000, async () => false);

      expect(settle).toHaveBeenCalledTimes(1);
      expect(settle).toHaveBeenCalledWith('req-1');
    });

    it('writes nothing when every old row still has its job', async () => {
      const prisma = buildMockPrisma();
      prisma.pipelineJob.findMany.mockResolvedValue([
        { id: 'waiting', bullmqJobId: 'still-there', parentJobId: null },
      ]);
      const svc = new PipelineJobService(prisma as never);

      await expect(
        svc.sweepOrphanedQueued(86_400_000, async () => true),
      ).resolves.toBe(0);
      expect(prisma.pipelineJob.updateMany).not.toHaveBeenCalled();
    });
  });
});
