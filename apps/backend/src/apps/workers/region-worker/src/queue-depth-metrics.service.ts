import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Gauge } from 'prom-client';
import { envInt } from '@opuspopuli/common';
import { QueueService } from '@opuspopuli/queue-provider';

const STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

/** Re-read the queue list from Redis every this many samples (~5 min). */
const RESCAN_EVERY = 10;

/**
 * Samples every queue's backlog into `bullmq_queue_jobs` and
 * `bullmq_queue_oldest_waiting_seconds`. Job metrics only see a job once
 * something picks it up, so waiting work — above all a queue nobody consumes,
 * after a `WORKER_QUEUES` slip on a multi-host node — is visible only here.
 *
 * Runs in region-worker. With several region-workers on one Redis each
 * samples the same queues; the dashboard takes the `max` across instances.
 * `QUEUE_DEPTH_SAMPLE_MS` sets the period (default 30s); 0 turns it off.
 *
 * The queue list comes from a Redis SCAN, which walks the whole keyspace, so
 * it is re-read every {@link RESCAN_EVERY} samples, not every one. A queue
 * that drops out of the list has its series removed — a gauge left alone
 * would report its last backlog forever.
 */
@Injectable()
export class QueueDepthMetricsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(QueueDepthMetricsService.name);
  private timer?: NodeJS.Timeout;
  private sampling = false;
  private warned = false;
  private names: string[] = [];
  private samplesSinceScan = RESCAN_EVERY;

  constructor(
    private readonly queues: QueueService,
    @InjectMetric('bullmq_queue_jobs') private readonly jobs: Gauge<string>,
    @InjectMetric('bullmq_queue_oldest_waiting_seconds')
    private readonly oldestWaiting: Gauge<string>,
  ) {}

  onApplicationBootstrap(): void {
    const periodMs = envInt('QUEUE_DEPTH_SAMPLE_MS', 30_000, 0);
    if (periodMs === 0) return;
    this.timer = setInterval(() => void this.sample(), periodMs);
    this.timer.unref();
    void this.sample();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over every queue. Never throws: a missed sample is a gap. */
  async sample(now: number = Date.now()): Promise<void> {
    if (this.sampling) return;
    this.sampling = true;
    try {
      await this.refreshNames();
      for (const queue of this.names) {
        const depth = await this.queues.getDepth(queue, now);
        for (const state of STATES) {
          this.jobs.set({ queue, state }, depth[state]);
        }
        this.oldestWaiting.set({ queue }, depth.oldestWaitingSeconds);
      }
      this.warned = false;
    } catch (error) {
      if (!this.warned) {
        this.logger.warn(
          `Queue depth sample failed: ${(error as Error).message}`,
        );
        this.warned = true;
      }
    } finally {
      this.sampling = false;
    }
  }

  private async refreshNames(): Promise<void> {
    if (++this.samplesSinceScan < RESCAN_EVERY) return;
    const names = await this.queues.listQueueNames();
    for (const gone of this.names.filter((n) => !names.includes(n))) {
      for (const state of STATES) this.jobs.remove({ queue: gone, state });
      this.oldestWaiting.remove({ queue: gone });
    }
    this.names = names;
    this.samplesSinceScan = 0;
  }
}
