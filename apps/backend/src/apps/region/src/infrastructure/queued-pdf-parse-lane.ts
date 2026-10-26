import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { envInt, laneJobId } from '@opuspopuli/common';
import type { IPdfParseLane } from '@opuspopuli/extraction-provider';
import {
  PDF_PARSE_QUEUE,
  QueueService,
  type PdfParseJobData,
} from '@opuspopuli/queue-provider';
import type { ChildOutcome } from 'src/common/child-jobs/child-job-batch';
import { ChildJobQueues } from 'src/common/child-jobs/child-job-queues';
import {
  ChildJobWaiter,
  isWaitTimeout,
} from 'src/common/child-jobs/child-job-waiter';
import { pdfParseThreadTimeoutMs } from 'src/common/cpu-lane/pdf-parse-thread-file';
import { SourceVersionService } from '../domains/source-version.service';

/** What a pdf-parse job reports (`PdfParseProcessor`). */
export type PdfParseOutcome =
  | 'parsed'
  | 'reused'
  | 'incomplete'
  | 'key_mismatch'
  | 'missing';

/**
 * How long the requester waits for its parse before checking on it
 * (`PDF_PARSE_LANE_TIMEOUT_MS`, default 10 min) — so a lane with no consumer
 * anywhere (every host's `WORKER_QUEUES` excluding `pdf-parse`) costs time,
 * not a stuck sync.
 */
function laneTimeoutMs(): number {
  return envInt('PDF_PARSE_LANE_TIMEOUT_MS', 10 * 60 * 1000);
}

/**
 * The requester's side of the S6 CPU lane, bound to `PDF_PARSE_LANE`
 * (`docs/plans/propositions-phase-b.md`): queues a `pdf-parse` job for an
 * archived PDF, waits for its outcome, and reads the recorded parse back from
 * the source store — neither the bytes nor the text travel through Redis. The
 * job's consumer may run on another host (`WORKER_QUEUES`).
 *
 * When the wait runs out the job is checked, so a backlog does not parse one
 * PDF twice: a job still WAITING is removed before the caller parses in
 * process; a job already RUNNING is waited on once more, for as long as its
 * thread may take.
 *
 * Never throws: anything it cannot deliver is undefined, and the extraction
 * provider then parses in process, as before S6.
 */
@Injectable()
export class QueuedPdfParseLane implements IPdfParseLane, OnModuleDestroy {
  private readonly logger = new Logger(QueuedPdfParseLane.name);
  private readonly waiter?: ChildJobWaiter<PdfParseJobData, string>;

  constructor(
    private readonly sourceVersions: SourceVersionService,
    @Optional() private readonly queues?: ChildJobQueues,
    @Optional() private readonly queueService?: QueueService,
  ) {
    if (queues) {
      this.waiter = new ChildJobWaiter(() =>
        queues.open<PdfParseJobData, string>(PDF_PARSE_QUEUE),
      );
    }
  }

  async parse(
    sourceVersionId: string,
    parserKey: string,
  ): Promise<string | undefined> {
    if (!this.waiter || !this.queues?.enabled(PDF_PARSE_QUEUE))
      return undefined;
    try {
      const jobId = laneJobId(
        sourceVersionId,
        'parse',
        createHash('sha256').update(parserKey).digest('hex').slice(0, 16),
      );
      const outcome = await this.awaitParse(jobId, {
        sourceVersionId,
        parserKey,
      });
      if (
        outcome.ok &&
        outcome.value !== 'parsed' &&
        outcome.value !== 'reused'
      ) {
        this.logger.log(
          `pdf-parse lane: ${sourceVersionId} ${outcome.value}; parsing in process`,
        );
        return undefined;
      }
      // On a timeout too: the parse may have landed between the wait running
      // out and now.
      const recorded = await this.sourceVersions.getParsedText(
        sourceVersionId,
        parserKey,
      );
      if (recorded === undefined && !outcome.ok) {
        this.logger.warn(
          `pdf-parse lane gave up on ${sourceVersionId} (${outcome.reason}); parsing in process`,
        );
      }
      return recorded;
    } catch (error) {
      this.logger.warn(
        `pdf-parse lane failed for ${sourceVersionId}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.waiter?.close();
  }

  /** The job's outcome, with one look at the job when the wait runs out. */
  private async awaitParse(
    jobId: string,
    data: PdfParseJobData,
  ): Promise<ChildOutcome<string>> {
    const waiter = this.waiter!;
    const first = await waiter.run(jobId, data, laneTimeoutMs());
    if (!isWaitTimeout(first) || !this.queueService) return first;

    const job = await this.jobState(jobId);
    if (job !== 'active') {
      // Still waiting: remove it, so the in-process parse is the only one.
      const removed = await this.queueService
        .removeJobIfPending(PDF_PARSE_QUEUE, jobId)
        .catch(() => false);
      // Not removed and still there: a consumer claimed it between the look
      // and the remove — it is running now, so wait for it like any other.
      if (removed || (await this.jobState(jobId)) !== 'active') return first;
    }
    // Running: re-adding the id collapses onto the running job, so this
    // waits for ITS outcome — bounded by the thread's own timeout. That
    // timeout is read from THIS host's env; a consumer host configured
    // higher can outlast it, and then the PDF is parsed twice.
    return waiter.run(jobId, data, pdfParseThreadTimeoutMs() + 60_000);
  }

  private async jobState(jobId: string): Promise<string | undefined> {
    const job = await this.queueService!.getJobInfo(
      PDF_PARSE_QUEUE,
      jobId,
    ).catch(() => null);
    return job?.state;
  }
}
