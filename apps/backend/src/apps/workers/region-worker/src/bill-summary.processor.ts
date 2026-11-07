import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import {
  BILL_SUMMARY_QUEUE,
  QUEUE_CONNECTION,
} from '@opuspopuli/queue-provider';
import type { BillSummaryJobData } from '@opuspopuli/queue-provider';
import { BillSummaryService } from 'src/apps/region/src/domains/bill-summary.service';
import { ChildJobProcessor } from './child-job.processor';

/**
 * Consumes the bill-summary queue (`docs/plans/bills-phase-b.md` D7): one job
 * per reader-requested summary, written through the batch's own path. A
 * failed attempt is recorded on the bill and waits, as in the batch.
 */
@Injectable()
export class BillSummaryProcessor extends ChildJobProcessor<
  BillSummaryJobData,
  string
> {
  protected readonly logger = new Logger(BillSummaryProcessor.name, {
    timestamp: true,
  });
  protected readonly queueName = BILL_SUMMARY_QUEUE;

  constructor(
    private readonly summaries: BillSummaryService,
    @Inject(QUEUE_CONNECTION) connection: IORedis,
    config: ConfigService,
  ) {
    super(connection, config);
  }

  protected run(job: BillSummaryJobData): Promise<string> {
    return this.summaries.generate(job);
  }

  protected describe(job: BillSummaryJobData): string {
    return job.billId;
  }
}
