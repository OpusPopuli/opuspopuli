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
          where: { id: 'job-1', status: { not: JOB_STATUS.SUCCEEDED } },
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
      prisma.pipelineJob.updateMany.mockResolvedValue({ count: 2 });
      const svc = new PipelineJobService(prisma as never);

      const before = Date.now();
      const count = await svc.sweepStaleRunning(600_000);
      const after = Date.now();

      expect(count).toBe(2);
      const call = prisma.pipelineJob.updateMany.mock.calls[0][0];
      expect(call.where.status).toBe(JOB_STATUS.RUNNING);
      // The cutoff Date should be roughly (now - maxAgeMs)
      const cutoffMs = (call.where.startedAt.lt as Date).getTime();
      expect(cutoffMs).toBeGreaterThanOrEqual(before - 600_000 - 5);
      expect(cutoffMs).toBeLessThanOrEqual(after - 600_000 + 5);
      expect(call.data.status).toBe(JOB_STATUS.FAILED);
      expect(call.data.errorMessage).toMatch(/Abandoned/);
    });

    it('returns 0 when no rows match without throwing', async () => {
      const prisma = buildMockPrisma();
      prisma.pipelineJob.updateMany.mockResolvedValue({ count: 0 });
      const svc = new PipelineJobService(prisma as never);

      const count = await svc.sweepStaleRunning(600_000);

      expect(count).toBe(0);
    });
  });
});
