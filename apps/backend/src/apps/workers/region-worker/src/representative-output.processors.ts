import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import {
  ACTIVITY_SUMMARY_QUEUE,
  COMMITTEE_DESCRIPTION_QUEUE,
  COMMITTEE_SUMMARY_QUEUE,
  QUEUE_CONNECTION,
  REPRESENTATIVE_BIO_QUEUE,
} from '@opuspopuli/queue-provider';
import type {
  ActivitySummaryJobData,
  CommitteeDescriptionJobData,
  CommitteeSummaryJobData,
  RepresentativeBioJobData,
} from '@opuspopuli/queue-provider';
import { BioGeneratorService } from 'src/apps/region/src/domains/bio-generator.service';
import { CommitteeSummaryGeneratorService } from 'src/apps/region/src/domains/committee-summary-generator.service';
import { EntityActivitySummaryGeneratorService } from 'src/apps/region/src/domains/entity-activity-summary-generator.service';
import type { GeneratedOutputOutcome } from 'src/apps/region/src/domains/generated-output-key';
import { LegislativeCommitteeDescriptionGeneratorService } from 'src/apps/region/src/domains/legislative-committee-description-generator.service';
import { ChildJobProcessor } from './child-job.processor';

/**
 * The representatives S4 queues' consumers
 * (`docs/plans/representatives-phase-b.md` §4): one job per stale output,
 * queued by the representatives sync, which waits for each outcome. Each job
 * re-checks currency before it generates, and a transient LLM failure throws
 * so the queue retries it. One file: the four differ only in the call.
 */

@Injectable()
export class RepresentativeBioProcessor extends ChildJobProcessor<
  RepresentativeBioJobData,
  GeneratedOutputOutcome
> {
  protected readonly logger = new Logger(RepresentativeBioProcessor.name, {
    timestamp: true,
  });
  protected readonly queueName = REPRESENTATIVE_BIO_QUEUE;

  constructor(
    private readonly bios: BioGeneratorService,
    @Inject(QUEUE_CONNECTION) connection: IORedis,
    config: ConfigService,
  ) {
    super(connection, config);
  }

  protected run(
    job: RepresentativeBioJobData,
  ): Promise<GeneratedOutputOutcome> {
    return this.bios.generateOne(job.representativeId, job.regionName);
  }

  protected describe(job: RepresentativeBioJobData): string {
    return job.representativeId;
  }
}

@Injectable()
export class CommitteeSummaryProcessor extends ChildJobProcessor<
  CommitteeSummaryJobData,
  GeneratedOutputOutcome
> {
  protected readonly logger = new Logger(CommitteeSummaryProcessor.name, {
    timestamp: true,
  });
  protected readonly queueName = COMMITTEE_SUMMARY_QUEUE;

  constructor(
    private readonly summaries: CommitteeSummaryGeneratorService,
    @Inject(QUEUE_CONNECTION) connection: IORedis,
    config: ConfigService,
  ) {
    super(connection, config);
  }

  protected run(job: CommitteeSummaryJobData): Promise<GeneratedOutputOutcome> {
    return this.summaries.generateOne(job.representativeId);
  }

  protected describe(job: CommitteeSummaryJobData): string {
    return job.representativeId;
  }
}

@Injectable()
export class CommitteeDescriptionProcessor extends ChildJobProcessor<
  CommitteeDescriptionJobData,
  GeneratedOutputOutcome
> {
  protected readonly logger = new Logger(CommitteeDescriptionProcessor.name, {
    timestamp: true,
  });
  protected readonly queueName = COMMITTEE_DESCRIPTION_QUEUE;

  constructor(
    private readonly descriptions: LegislativeCommitteeDescriptionGeneratorService,
    @Inject(QUEUE_CONNECTION) connection: IORedis,
    config: ConfigService,
  ) {
    super(connection, config);
  }

  protected run(
    job: CommitteeDescriptionJobData,
  ): Promise<GeneratedOutputOutcome> {
    return this.descriptions.generateOne(job.committeeId);
  }

  protected describe(job: CommitteeDescriptionJobData): string {
    return job.committeeId;
  }
}

@Injectable()
export class ActivitySummaryProcessor extends ChildJobProcessor<
  ActivitySummaryJobData,
  GeneratedOutputOutcome
> {
  protected readonly logger = new Logger(ActivitySummaryProcessor.name, {
    timestamp: true,
  });
  protected readonly queueName = ACTIVITY_SUMMARY_QUEUE;

  constructor(
    private readonly activity: EntityActivitySummaryGeneratorService,
    @Inject(QUEUE_CONNECTION) connection: IORedis,
    config: ConfigService,
  ) {
    super(connection, config);
  }

  protected run(job: ActivitySummaryJobData): Promise<GeneratedOutputOutcome> {
    return this.activity.generateOne(job.entityType, job.entityId);
  }

  protected describe(job: ActivitySummaryJobData): string {
    return `${job.entityType} ${job.entityId}`;
  }
}
