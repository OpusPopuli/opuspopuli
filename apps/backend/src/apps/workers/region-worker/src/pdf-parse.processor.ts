import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { envInt } from '@opuspopuli/common';
import { pdfParserKeyFor } from '@opuspopuli/extraction-provider';
import { createTesseractOcrServiceFromEnv } from '@opuspopuli/ocr-provider';
import {
  PDF_PARSE_QUEUE,
  QUEUE_CONNECTION,
  queueConcurrency,
} from '@opuspopuli/queue-provider';
import type { PdfParseJobData } from '@opuspopuli/queue-provider';
import { SourceVersionService } from 'src/apps/region/src/domains/source-version.service';
import type { PdfParseOutcome } from 'src/apps/region/src/infrastructure/queued-pdf-parse-lane';
import {
  PDF_PARSE_THREAD_FILE,
  pdfParseThreadTimeoutMs,
  type PdfParseThreadRequest,
  type PdfParseThreadResult,
} from 'src/common/cpu-lane/pdf-parse-thread-file';
import { ThreadPool } from 'src/common/cpu-lane/thread-pool';
import { ChildJobProcessor } from './child-job.processor';

/** The pool a consumer runs its parses on; a seam for the spec. */
export type PdfParsePool = Pick<
  ThreadPool<PdfParseThreadRequest, PdfParseThreadResult>,
  'run' | 'close'
>;

/**
 * Consumes the pdf-parse queue — the S6 CPU lane
 * (`docs/plans/propositions-phase-b.md`). Each job names an archived PDF; the
 * parse runs on a worker thread, so the event loop keeps renewing job locks
 * while a scanned measure is rasterised and OCRed, and the complete result is
 * recorded on the artifact for the requester to read back. One thread per
 * job slot: the pool is `BULLMQ_QUEUE_PDF_PARSE_CONCURRENCY` threads, created
 * on the first job — a process whose `WORKER_QUEUES` leaves this queue to
 * another host never starts one.
 *
 * The parse key is computed here, from this process's own OCR configuration,
 * and must equal the requester's: a parse recorded under a key the requester
 * cannot reuse would cost a parse and save none. On a mismatch the job does
 * nothing and the requester parses in process (`key_mismatch`).
 */
@Injectable()
export class PdfParseProcessor extends ChildJobProcessor<
  PdfParseJobData,
  PdfParseOutcome
> {
  protected readonly logger = new Logger(PdfParseProcessor.name, {
    timestamp: true,
  });
  protected readonly queueName = PDF_PARSE_QUEUE;
  private pool?: PdfParsePool;
  private parserKey?: string;
  /** Requested keys already warned about — one line per key, not per job. */
  private readonly mismatchWarned = new Set<string>();

  constructor(
    private readonly sourceVersions: SourceVersionService,
    @Inject(QUEUE_CONNECTION) connection: IORedis,
    config: ConfigService,
  ) {
    super(connection, config);
  }

  /** The thread pool; overridden by the spec. */
  protected createPool(): PdfParsePool {
    return new ThreadPool<PdfParseThreadRequest, PdfParseThreadResult>({
      file: PDF_PARSE_THREAD_FILE,
      size: queueConcurrency(PDF_PARSE_QUEUE),
      timeoutMs: pdfParseThreadTimeoutMs(),
      maxOldGenerationMb: envInt('PDF_PARSE_THREAD_MAX_MB', 1024),
    });
  }

  protected async run(job: PdfParseJobData): Promise<PdfParseOutcome> {
    this.parserKey ??= pdfParserKeyFor(
      createTesseractOcrServiceFromEnv().getProviderInfo(),
    );
    if (job.parserKey !== this.parserKey) {
      if (!this.mismatchWarned.has(job.parserKey)) {
        this.mismatchWarned.add(job.parserKey);
        this.logger.warn(
          `pdf-parse: requests arrive under ${job.parserKey}, this consumer ` +
            `parses as ${this.parserKey} — check the OCR env matches on every ` +
            `host. Their requesters parse in process (warned once per key).`,
        );
      }
      return 'key_mismatch';
    }
    const artifact = await this.sourceVersions.getForParse(job.sourceVersionId);
    if (!artifact) return 'missing';
    if (
      artifact.parserVersion === job.parserKey &&
      artifact.parsedText !== null
    ) {
      return 'reused';
    }

    // A copy the thread can own: the transfer detaches it here.
    const bytes = new Uint8Array(artifact.content).buffer;
    this.pool ??= this.createPool();
    const parsed = await this.pool.run({ bytes }, [bytes]);
    if (!parsed.complete) return 'incomplete';

    const stored = await this.sourceVersions.attachParsedText(
      job.sourceVersionId,
      job.parserKey,
      parsed.text,
    );
    return stored ? 'parsed' : 'incomplete';
  }

  protected describe(job: PdfParseJobData): string {
    return job.sourceVersionId;
  }

  async onModuleDestroy(): Promise<void> {
    await super.onModuleDestroy();
    await this.pool?.close();
  }
}
