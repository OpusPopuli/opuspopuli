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
    it('enqueues a region-sync job with a manifest-scoped deduplication jobId', async () => {
      const queueService = { enqueue: jest.fn().mockResolvedValue(undefined) };
      const svc = buildProcessor({ queueService });

      // Access private method via prototype
      await (
        svc as unknown as Record<string, (...args: unknown[]) => Promise<void>>
      ).enqueueFollowUpSync('california', 'BILLS', 'mf-abc', 1);

      expect(queueService.enqueue).toHaveBeenCalledWith(
        'region-sync',
        expect.objectContaining({
          regionId: 'california',
          dataTypes: ['BILLS'],
        }),
        { jobId: 'manifest-ready:california:BILLS:mf-abc:v1' },
      );
    });

    // #1172. The id used to be `manifest-ready:${regionId}:${dataType}`, so a
    // completed job held it for the 7-day `removeOnComplete.age` and every
    // later follow-up was silently dropped by BullMQ. A new manifest must be
    // able to enqueue its own follow-up.
    it('produces a different jobId for a different manifest', async () => {
      const queueService = { enqueue: jest.fn().mockResolvedValue(undefined) };
      const svc = buildProcessor({ queueService });
      const call = (
        svc as unknown as Record<string, (...args: unknown[]) => Promise<void>>
      ).enqueueFollowUpSync.bind(svc);

      await call('california-sonoma', 'PROPOSITIONS', 'mf-hub', 2);
      await call('california-sonoma', 'PROPOSITIONS', 'mf-leaf', 1);

      const ids = queueService.enqueue.mock.calls.map((c) => c[2].jobId);
      expect(new Set(ids).size).toBe(2);
    });

    // A version bump is a new reason to sync, even for the same manifest row.
    it('produces a different jobId when the manifest version changes', async () => {
      const queueService = { enqueue: jest.fn().mockResolvedValue(undefined) };
      const svc = buildProcessor({ queueService });
      const call = (
        svc as unknown as Record<string, (...args: unknown[]) => Promise<void>>
      ).enqueueFollowUpSync.bind(svc);

      await call('california', 'BILLS', 'mf-abc', 1);
      await call('california', 'BILLS', 'mf-abc', 2);

      const ids = queueService.enqueue.mock.calls.map((c) => c[2].jobId);
      expect(new Set(ids).size).toBe(2);
    });

    // The original dedupe intent survives: two concurrent analyses of the
    // same manifest still collapse to one follow-up.
    it('reuses the jobId for the same manifest and version', async () => {
      const queueService = { enqueue: jest.fn().mockResolvedValue(undefined) };
      const svc = buildProcessor({ queueService });
      const call = (
        svc as unknown as Record<string, (...args: unknown[]) => Promise<void>>
      ).enqueueFollowUpSync.bind(svc);

      await call('california', 'BILLS', 'mf-abc', 3);
      await call('california', 'BILLS', 'mf-abc', 3);

      const ids = queueService.enqueue.mock.calls.map((c) => c[2].jobId);
      expect(new Set(ids).size).toBe(1);
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
        ).enqueueFollowUpSync('california', 'BILLS', 'mf-abc', 1),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to enqueue follow-up sync'),
      );
    });
  });
});
