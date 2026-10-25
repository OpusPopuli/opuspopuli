import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  METRICS_OBSERVER,
  QueueMetric,
  type MetricsObserver,
} from '@opuspopuli/common';
import {
  setDefaultWorkerMetrics,
  type WorkerMetrics,
} from '@opuspopuli/queue-provider';

/** `WorkerMetrics` over the metrics seam — the adapter it never had. */
export function observerWorkerMetrics(
  observer: MetricsObserver,
): WorkerMetrics {
  return {
    incrementJobAttempts: (queue, trigger, outcome) =>
      observer.increment(QueueMetric.JobAttemptsTotal, 1, {
        queue,
        trigger,
        outcome,
      }),
    recordJobDuration: (queue, trigger, durationMs) =>
      observer.observe(QueueMetric.JobDurationSeconds, durationMs / 1000, {
        queue,
        trigger,
      }),
  };
}

/**
 * Points every BullMQ worker in this process at the metrics seam. Module
 * init runs before any processor's `onApplicationBootstrap` opens its worker,
 * so no queue starts unmeasured.
 */
@Injectable()
export class WorkerMetricsBinding implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(METRICS_OBSERVER) private readonly observer: MetricsObserver,
  ) {}

  onModuleInit(): void {
    setDefaultWorkerMetrics(observerWorkerMetrics(this.observer));
  }

  onModuleDestroy(): void {
    setDefaultWorkerMetrics(undefined);
  }
}
