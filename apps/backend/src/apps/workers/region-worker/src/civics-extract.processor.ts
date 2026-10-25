import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import {
  CIVICS_EXTRACT_QUEUE,
  QUEUE_CONNECTION,
} from '@opuspopuli/queue-provider';
import type { CivicsExtractJobData } from '@opuspopuli/queue-provider';
import {
  CivicsSyncService,
  type CivicsPageOutcome,
} from 'src/apps/region/src/domains/civics-sync.service';
import { ChildJobProcessor } from './child-job.processor';

/**
 * Consumes the civics-extract queue (civics S3,
 * `docs/plans/civics-phase-b.md` §3): one job per changed civics page,
 * queued by the civics sync, which waits for each page's outcome.
 */
@Injectable()
export class CivicsExtractProcessor extends ChildJobProcessor<
  CivicsExtractJobData,
  CivicsPageOutcome
> {
  protected readonly logger = new Logger(CivicsExtractProcessor.name, {
    timestamp: true,
  });
  protected readonly queueName = CIVICS_EXTRACT_QUEUE;

  constructor(
    private readonly civics: CivicsSyncService,
    @Inject(QUEUE_CONNECTION) connection: IORedis,
    config: ConfigService,
  ) {
    super(connection, config);
  }

  protected run(job: CivicsExtractJobData): Promise<CivicsPageOutcome> {
    return this.civics.extractPage(job);
  }

  protected describe(job: CivicsExtractJobData): string {
    return job.sourceUrl;
  }
}
