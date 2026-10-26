import { setDefaultWorkerMetrics } from '@opuspopuli/queue-provider';
import {
  WorkerMetricsBinding,
  observerWorkerMetrics,
} from './worker-metrics-binding';

jest.mock('@opuspopuli/queue-provider', () => ({
  setDefaultWorkerMetrics: jest.fn(),
}));

describe('observerWorkerMetrics', () => {
  it('reports attempts and durations (in seconds) through the seam', () => {
    const observer = { increment: jest.fn(), observe: jest.fn() };
    const metrics = observerWorkerMetrics(observer);

    metrics.incrementJobAttempts('pdf-parse', 'unknown', 'retry');
    metrics.recordJobDuration('pdf-parse', 'unknown', 2500);

    expect(observer.increment).toHaveBeenCalledWith(
      'bullmq_job_attempts_total',
      1,
      { queue: 'pdf-parse', trigger: 'unknown', outcome: 'retry' },
    );
    expect(observer.observe).toHaveBeenCalledWith(
      'bullmq_job_duration_seconds',
      2.5,
      { queue: 'pdf-parse', trigger: 'unknown' },
    );
  });
});

describe('WorkerMetricsBinding', () => {
  it('binds the process default on init and clears it on destroy', () => {
    const binding = new WorkerMetricsBinding({
      increment: jest.fn(),
      observe: jest.fn(),
    });
    binding.onModuleInit();
    expect(setDefaultWorkerMetrics).toHaveBeenLastCalledWith(
      expect.objectContaining({ incrementJobAttempts: expect.any(Function) }),
    );
    binding.onModuleDestroy();
    expect(setDefaultWorkerMetrics).toHaveBeenLastCalledWith(undefined);
  });
});
