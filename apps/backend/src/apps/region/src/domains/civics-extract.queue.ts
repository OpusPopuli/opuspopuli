import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type IORedis from 'ioredis';
import {
  CIVICS_EXTRACT_QUEUE,
  QUEUE_CONNECTION,
  QueueService,
  resolveQueuePrefix,
  type CivicsExtractJobData,
} from '@opuspopuli/queue-provider';
import {
  openQueueBatch,
  type ChildJobBatch,
} from 'src/common/child-jobs/child-job-batch';

/**
 * Where the civics sync sends each changed page's extraction (civics S3,
 * `docs/plans/civics-phase-b.md` §3). The consumer is
 * `CivicsExtractProcessor` in region-worker — the process that runs syncs.
 *
 * Off with `BULLMQ_QUEUE_CIVICS_EXTRACT_ENABLED=false`, the same switch that
 * stops the consumer: a sync then extracts in its own process, as before S3,
 * rather than queueing work that nothing will take.
 */
@Injectable()
export class CivicsExtractQueue {
  constructor(
    private readonly queueService: QueueService,
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    @Optional() private readonly config?: ConfigService,
  ) {}

  get enabled(): boolean {
    return process.env.BULLMQ_QUEUE_CIVICS_EXTRACT_ENABLED !== 'false';
  }

  /** A batch for one sync run; the caller closes it. */
  open(): Promise<ChildJobBatch<CivicsExtractJobData, string>> {
    return openQueueBatch({
      queueService: this.queueService,
      connection: this.connection,
      prefix: resolveQueuePrefix(this.config?.get<string>('BULLMQ_PREFIX')),
      queueName: CIVICS_EXTRACT_QUEUE,
    });
  }
}
