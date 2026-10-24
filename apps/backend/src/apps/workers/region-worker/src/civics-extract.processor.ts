import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  CIVICS_EXTRACT_QUEUE,
  QUEUE_CONNECTION,
  createWorker,
  resolveQueuePrefix,
} from '@opuspopuli/queue-provider';
import type { CivicsExtractJobData } from '@opuspopuli/queue-provider';
import {
  CivicsSyncService,
  type CivicsPageOutcome,
} from 'src/apps/region/src/domains/civics-sync.service';

/**
 * Consumes the civics-extract queue (civics S3,
 * `docs/plans/civics-phase-b.md` §3): one job per changed civics page,
 * queued by the civics sync, which waits for each job's outcome on the
 * queue's event stream. The return value IS that outcome, so this returns
 * it rather than a flag.
 *
 * Concurrency is `BULLMQ_QUEUE_CIVICS_EXTRACT_CONCURRENCY`, default 1: the
 * overlap S3 buys is fetch against GPU, which one slot already gives, and
 * the LLM lane queue (S7) decides GPU concurrency on its own.
 */
@Injectable()
export class CivicsExtractProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CivicsExtractProcessor.name, {
    timestamp: true,
  });
  private worker?: Worker<CivicsExtractJobData>;

  constructor(
    private readonly civics: CivicsSyncService,
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const prefix = resolveQueuePrefix(this.config.get<string>('BULLMQ_PREFIX'));
    this.worker = createWorker<CivicsExtractJobData>(
      CIVICS_EXTRACT_QUEUE,
      this.connection,
      (job) => this.process(job),
      { prefix },
    );
    this.logger.log('CivicsExtractProcessor worker started');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('CivicsExtractProcessor worker closed');
    }
  }

  private async process(
    job: Job<CivicsExtractJobData>,
  ): Promise<CivicsPageOutcome> {
    const outcome = await this.civics.extractPage(job.data);
    this.logger.debug(`civics-extract ${job.data.sourceUrl}: ${outcome}`);
    return outcome;
  }
}
