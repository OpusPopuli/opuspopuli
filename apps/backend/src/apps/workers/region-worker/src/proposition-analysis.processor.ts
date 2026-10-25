import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import {
  PROPOSITION_ANALYSIS_QUEUE,
  QUEUE_CONNECTION,
} from '@opuspopuli/queue-provider';
import type { PropositionAnalysisJobData } from '@opuspopuli/queue-provider';
import {
  PropositionAnalysisService,
  type PropositionAnalysisOutcome,
} from 'src/apps/region/src/domains/proposition-analysis.service';
import { ChildJobProcessor } from './child-job.processor';

/**
 * Consumes the proposition-analysis queue (propositions S4,
 * `docs/plans/propositions-phase-b.md` §3): one job per stale measure, queued
 * by the propositions sync, which waits for each outcome. A transient failure
 * throws and is retried; a deterministic one is returned as `failed` (see
 * `PropositionAnalysisService.analyseOne`).
 */
@Injectable()
export class PropositionAnalysisProcessor extends ChildJobProcessor<
  PropositionAnalysisJobData,
  PropositionAnalysisOutcome
> {
  protected readonly logger = new Logger(PropositionAnalysisProcessor.name, {
    timestamp: true,
  });
  protected readonly queueName = PROPOSITION_ANALYSIS_QUEUE;

  constructor(
    private readonly analysis: PropositionAnalysisService,
    @Inject(QUEUE_CONNECTION) connection: IORedis,
    config: ConfigService,
  ) {
    super(connection, config);
  }

  protected run(
    job: PropositionAnalysisJobData,
  ): Promise<PropositionAnalysisOutcome> {
    return this.analysis.analyseOne(job.propositionId);
  }

  protected describe(job: PropositionAnalysisJobData): string {
    return job.propositionId;
  }
}
