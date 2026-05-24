import { StructuralAnalysisProcessor } from './structural-analysis.processor';

function buildProcessor(
  overrides: Record<string, unknown> = {},
): StructuralAnalysisProcessor {
  const svc = Object.create(
    StructuralAnalysisProcessor.prototype,
  ) as StructuralAnalysisProcessor;
  Object.assign(svc, {
    logger: {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    pipeline: {},
    jobService: {},
    queueService: { enqueue: jest.fn().mockResolvedValue(undefined) },
    connection: {},
    config: { get: jest.fn() },
    worker: undefined,
    ...overrides,
  });
  return svc;
}

describe('StructuralAnalysisProcessor', () => {
  describe('enqueueFollowUpSync', () => {
    it('enqueues a region-sync job with a deterministic deduplication jobId', async () => {
      const queueService = { enqueue: jest.fn().mockResolvedValue(undefined) };
      const svc = buildProcessor({ queueService });

      // Access private method via prototype
      await (
        svc as unknown as Record<string, (...args: unknown[]) => Promise<void>>
      ).enqueueFollowUpSync('california', 'BILLS');

      expect(queueService.enqueue).toHaveBeenCalledWith(
        'region-sync',
        expect.objectContaining({
          regionId: 'california',
          dataTypes: ['BILLS'],
        }),
        { jobId: 'manifest-ready:california:BILLS' },
      );
    });

    it('logs a warning and does not throw when enqueue fails', async () => {
      const queueService = {
        enqueue: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      };
      const logger = {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };
      const svc = buildProcessor({ queueService, logger });

      await expect(
        (
          svc as unknown as Record<
            string,
            (...args: unknown[]) => Promise<void>
          >
        ).enqueueFollowUpSync('california', 'BILLS'),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to enqueue follow-up sync'),
      );
    });
  });
});
