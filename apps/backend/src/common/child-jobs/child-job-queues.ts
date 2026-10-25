import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type IORedis from 'ioredis';
import {
  QUEUE_CONNECTION,
  QueueService,
  resolveQueuePrefix,
} from '@opuspopuli/queue-provider';
import { openQueueBatch, type ChildJobBatch } from './child-job-batch';

/**
 * Where a per-type sync sends its per-item jobs — `civics-extract` (civics
 * S3), `proposition-analysis` (propositions S4), and the types after them —
 * one helper for every queue, so the second type does not copy the first.
 * Each queue's consumer runs in region-worker, the process that runs syncs.
 *
 * A queue switched off with `BULLMQ_QUEUE_<NAME>_ENABLED=false` — the same
 * switch that stops its consumer — reports itself disabled, and the sync runs
 * that work in its own process rather than queue work nothing will take.
 */
@Injectable()
export class ChildJobQueues {
  constructor(
    private readonly queueService: QueueService,
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    @Optional() private readonly config?: ConfigService,
  ) {}

  enabled(queueName: string): boolean {
    const envPrefix = queueName.toUpperCase().replace(/-/g, '_');
    return process.env[`BULLMQ_QUEUE_${envPrefix}_ENABLED`] !== 'false';
  }

  /** A batch on `queueName` for one sync run; the caller closes it. */
  open<T, R>(queueName: string): Promise<ChildJobBatch<T, R>> {
    return openQueueBatch<T, R>({
      queueService: this.queueService,
      connection: this.connection,
      prefix: resolveQueuePrefix(this.config?.get<string>('BULLMQ_PREFIX')),
      queueName,
    });
  }
}
