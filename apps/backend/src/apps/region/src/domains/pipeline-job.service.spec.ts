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
});
