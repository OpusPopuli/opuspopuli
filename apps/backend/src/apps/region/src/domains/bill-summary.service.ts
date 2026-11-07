import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import IORedis from 'ioredis';
import {
  type ILLMProvider,
  LazyAnalysisMetric,
  METRICS_OBSERVER,
  type MetricsObserver,
  NOOP_METRICS_OBSERVER,
} from '@opuspopuli/common';
import { PromptClientService } from '@opuspopuli/prompt-client';
import {
  BILL_SUMMARY_QUEUE,
  type BillSummaryJobData,
  QUEUE_CONNECTION,
  QueueService,
  resolveQueuePrefix,
} from '@opuspopuli/queue-provider';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  BillSummaryState,
  type LiveSummary,
  summaryStateOf,
} from './bill-summary-state';
import { BillSummaryStatus } from './models/bill.model';
import { RegionSyncService } from './region-sync.service';
import { shortError } from './short-error';

/** The summary template, as the batch names it (K6). */
const BILL_SUMMARY_TEMPLATE = 'bill-status-summary';

/** Days a failed attempt waits, as the batch's `summaryRetryDue` (K6). */
const RETRY_AFTER_DAYS = 7;

/** BullMQ states in which a job is still to run or running. */
const IN_FLIGHT = new Set([
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children',
]);

/** The statuses a reader may ask to change. */
const REQUESTABLE: ReadonlySet<BillSummaryStatus> = new Set([
  BillSummaryStatus.MISSING,
  BillSummaryStatus.STALE,
]);

/** A cap counter outlives its UTC day, so a late request still counts. */
const CAP_TTL_SECONDS = 2 * 86_400;

/**
 * Who asked: a signed-in user, or an anonymous browser's session (D18), and
 * the client IP the gateway forwarded.
 */
export interface SummaryReader {
  userId?: string;
  session?: string;
  ip?: string;
}

/**
 * Daily caps on reader-requested summaries (D7): 200 a day across all
 * readers and 10 a day per reader. Env-tunable; the dashboard's row 6 shows
 * whether readers hit them.
 */
function capsFromEnv(): { global: number; perReader: number; perIp: number } {
  const read = (name: string, fallback: number): number => {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  };
  return {
    global: read('BILL_SUMMARY_LAZY_DAILY_CAP', 200),
    perReader: read('BILL_SUMMARY_LAZY_READER_DAILY_CAP', 10),
    // A client chooses its own CSRF cookie, so a script can mint a fresh
    // session per request; the IP bounds that. Above the per-reader cap, as a
    // household or school shares one address.
    perIp: read('BILL_SUMMARY_LAZY_IP_DAILY_CAP', 30),
  };
}

/**
 * Summaries on first read (`bills-phase-b.md` D7, `ingestion-resource-lanes.md`
 * §5.2). The batch summarizes hot bills; a reader opening any other bill can
 * ask for one. The request enqueues a job on the `bill-summary` queue; the
 * worker writes it through the batch's own path; the page polls the status.
 *
 * Fails closed: without a reader identity, or with the cap counters
 * unreachable, nothing is generated lazily.
 */
@Injectable()
export class BillSummaryService {
  private readonly logger = new Logger(BillSummaryService.name);
  private readonly caps = capsFromEnv();
  private readonly keyPrefix: string;

  constructor(
    private readonly db: DbService,
    private readonly queue: QueueService,
    private readonly regionSync: RegionSyncService,
    @Inject(QUEUE_CONNECTION) private readonly redis: IORedis,
    @Optional() private readonly promptClient?: PromptClientService,
    @Optional()
    @Inject('LLM_ANALYSIS_PROVIDER')
    private readonly llm?: ILLMProvider,
    @Optional()
    @Inject(METRICS_OBSERVER)
    private readonly metrics: MetricsObserver = NOOP_METRICS_OBSERVER,
  ) {
    this.keyPrefix = `${resolveQueuePrefix(process.env.BULLMQ_PREFIX)}:lazy:bill-summary`;
  }

  /**
   * The status a reader's page shows for one bill. Never throws: a Redis or
   * database failure reads as UNAVAILABLE, so the page around it still
   * renders.
   */
  async status(billId: string): Promise<BillSummaryStatus> {
    try {
      const served = await this.servedTemplate();
      if (!served) return BillSummaryStatus.UNAVAILABLE;
      if (await this.inFlight(billId)) return BillSummaryStatus.PENDING;
      return await this.judge(billId, served);
    } catch (e) {
      this.logger.warn(`Bill summary status unavailable: ${shortError(e)}`);
      return BillSummaryStatus.UNAVAILABLE;
    }
  }

  /**
   * The bill's own state, without looking at the queue: what the worker
   * re-checks, where `status` would only see its own running job.
   */
  private async judge(
    billId: string,
    served: { promptHash: string; fallback: boolean },
  ): Promise<BillSummaryStatus> {
    const bill = await this.loadProvenance(billId);
    if (!bill) return BillSummaryStatus.UNAVAILABLE;
    const state = summaryStateOf(bill, await this.live(bill, served));
    if (state === BillSummaryState.CURRENT) return BillSummaryStatus.CURRENT;
    if (this.waitingAfterFailure(bill.aiSummaryFailedAt)) {
      return BillSummaryStatus.UNAVAILABLE;
    }
    // Under a local fallback a stale summary is shown, not refreshed (K6).
    if (state === BillSummaryState.STALE && served.fallback) {
      return BillSummaryStatus.CURRENT;
    }
    return state === BillSummaryState.STALE
      ? BillSummaryStatus.STALE
      : BillSummaryStatus.MISSING;
  }

  /**
   * A reader asks for a bill's summary. Enqueues when it is missing or stale
   * and both caps allow; returns the status the page shows next.
   */
  async request(
    billId: string,
    reader: SummaryReader,
  ): Promise<BillSummaryStatus> {
    try {
      return await this.tryRequest(billId, reader);
    } catch (e) {
      // As `status`: a failed lookup is UNAVAILABLE, not an error.
      this.logger.warn(`Bill summary request unavailable: ${shortError(e)}`);
      return BillSummaryStatus.UNAVAILABLE;
    }
  }

  private async tryRequest(
    billId: string,
    reader: SummaryReader,
  ): Promise<BillSummaryStatus> {
    const served = await this.servedTemplate();
    if (!served) return BillSummaryStatus.UNAVAILABLE;
    if (await this.inFlight(billId)) {
      this.count('deduped');
      return BillSummaryStatus.PENDING;
    }
    const status = await this.judge(billId, served);
    if (!REQUESTABLE.has(status)) {
      this.count('current');
      return status;
    }
    const keys = this.capKeys(reader);
    if (!keys) {
      this.count('no_reader');
      return BillSummaryStatus.UNAVAILABLE;
    }
    if (!(await this.takeFromCaps(keys))) {
      this.count('capped');
      return BillSummaryStatus.UNAVAILABLE;
    }
    const data: BillSummaryJobData = {
      billId,
      requestedAt: new Date().toISOString(),
    };
    try {
      await this.queue.enqueue(BILL_SUMMARY_QUEUE, data, {
        jobId: summaryJobId(billId),
        // Gone once done, so a later request is never mistaken for this one.
        removeOnFinish: true,
      });
    } catch (e) {
      await this.giveBack(
        [keys.global, keys.reader, keys.ip].filter((k): k is string => !!k),
      );
      this.logger.warn(`Bill summary enqueue failed: ${shortError(e)}`);
      return BillSummaryStatus.UNAVAILABLE;
    }
    this.count('enqueued');
    return BillSummaryStatus.PENDING;
  }

  /**
   * The worker's side: re-check the bill (not the queue, which holds this
   * very job), then write through the batch path. A bill a sync summarized,
   * or one waiting after a failed attempt, is left alone.
   */
  async generate(job: BillSummaryJobData): Promise<string> {
    const served = await this.servedTemplate();
    if (!served) return 'unavailable';
    const status = await this.judge(job.billId, served);
    if (!REQUESTABLE.has(status)) return 'current';
    const outcome = await this.regionSync.summarizeOne(job.billId);
    if (outcome === 'enriched') {
      const seconds = (Date.now() - Date.parse(job.requestedAt)) / 1000;
      if (Number.isFinite(seconds)) {
        this.metrics.observe(LazyAnalysisMetric.ReadySeconds, seconds, {
          data_type: 'bills',
        });
      }
    }
    return outcome;
  }

  private async servedTemplate(): Promise<
    { promptHash: string; fallback: boolean } | undefined
  > {
    if (!this.promptClient) return undefined;
    try {
      return await this.promptClient.getServedPromptHash(BILL_SUMMARY_TEMPLATE);
    } catch (e) {
      this.logger.warn(`Bill summary template unavailable: ${shortError(e)}`);
      return undefined;
    }
  }

  private async inFlight(billId: string): Promise<boolean> {
    const info = await this.queue.getJobInfo(
      BILL_SUMMARY_QUEUE,
      summaryJobId(billId),
    );
    return info !== null && IN_FLIGHT.has(info.state);
  }

  private loadProvenance(billId: string) {
    return this.db.bill.findUnique({
      where: { id: billId },
      select: {
        externalId: true,
        statusSource: true,
        aiSummary: true,
        aiSummaryPromptHash: true,
        aiSummaryLlmDigest: true,
        aiSummarySourceVersion: true,
        aiSummaryFailedAt: true,
      },
    });
  }

  /** What a summary written now would carry, for this bill. */
  private async live(
    bill: { externalId: string; statusSource: string | null },
    served: { promptHash: string },
  ): Promise<LiveSummary> {
    const modelDigest = (await this.llm?.getModelDigest()) ?? undefined;
    if (bill.statusSource !== 'official') {
      return { promptHash: served.promptHash, modelDigest };
    }
    // The current version as the batch picks it (lowest number, ties by id),
    // and only when it has text.
    const [current] = await this.db.$queryRaw<
      { external_id: string; has_text: boolean }[]
    >`
      SELECT external_id, bill_xml IS NOT NULL AS has_text
      FROM pubinfo_bill_versions
      WHERE bill_id = ${bill.externalId}
      ORDER BY version_num ASC, external_id ASC
      LIMIT 1`;
    return {
      promptHash: served.promptHash,
      modelDigest,
      currentVersion: current?.has_text ? current.external_id : undefined,
    };
  }

  private waitingAfterFailure(failedAt: Date | null): boolean {
    return (
      failedAt !== null &&
      Date.now() - failedAt.getTime() < RETRY_AFTER_DAYS * 86_400_000
    );
  }

  /**
   * The Redis keys today's request counts against: global, the reader's and
   * the IP's. Reader and IP are keyed by an HMAC under a server secret, so a
   * key cannot be linked back to a user, a browser or an address by anyone
   * holding Redis and the user table. Undefined without a reader identity.
   */
  private capKeys(reader: SummaryReader): CapKeys | undefined {
    // Without the secret the HMAC would be a plain hash, linkable again.
    const secret = process.env.GATEWAY_HMAC_SECRET;
    if (!secret) return undefined;
    let id: string | undefined;
    if (reader.userId) id = `user:${reader.userId}`;
    else if (reader.session) id = `session:${reader.session}`;
    if (!id) return undefined;
    const day = new Date().toISOString().slice(0, 10);
    const keyed = (value: string) =>
      createHmac('sha256', secret).update(value).digest('hex');
    const ipKey = reader.ip ? keyed('ip:' + reader.ip) : undefined;
    return {
      global: `${this.keyPrefix}:global:${day}`,
      reader: `${this.keyPrefix}:reader:${keyed(id)}:${day}`,
      ip: ipKey ? `${this.keyPrefix}:ip:${ipKey}:${day}` : undefined,
    };
  }

  /**
   * One request off every daily cap, or none: a refused request gives back
   * what it took. The global count is checked first, so a request refused
   * there creates no per-reader key. Unreachable counters refuse (fail
   * closed).
   */
  private async takeFromCaps(keys: CapKeys): Promise<boolean> {
    // Only what was taken is given back: a counter must never go negative.
    const taken: string[] = [];
    try {
      const total = await this.bump(keys.global);
      taken.push(keys.global);
      if (total > this.caps.global) {
        await this.giveBack(taken);
        return false;
      }
      const mine = await this.bump(keys.reader);
      taken.push(keys.reader);
      let fromIp = 0;
      if (keys.ip) {
        fromIp = await this.bump(keys.ip);
        taken.push(keys.ip);
      }
      if (mine <= this.caps.perReader && fromIp <= this.caps.perIp) {
        return true;
      }
      await this.giveBack(taken);
      return false;
    } catch (e) {
      await this.giveBack(taken);
      this.logger.warn(`Bill summary caps unavailable: ${shortError(e)}`);
      return false;
    }
  }

  /** INCR with the day's expiry, in one MULTI. */
  private async bump(key: string): Promise<number> {
    const results = (await this.redis
      .multi()
      .incr(key)
      .expire(key, CAP_TTL_SECONDS)
      .exec()) as [unknown, number][];
    return results[0][1];
  }

  private async giveBack(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const undo = this.redis.multi();
    for (const key of keys) undo.decr(key);
    await undo.exec().catch(() => undefined);
  }

  private count(result: string): void {
    this.metrics.increment(LazyAnalysisMetric.RequestsTotal, 1, {
      data_type: 'bills',
      result,
    });
  }
}

/**
 * One job per bill: concurrent first readers collapse onto it, whatever the
 * template, and the worker re-checks what the summary must be written under.
 * `__`-joined, as BullMQ rejects `:` in a custom id.
 */
export function summaryJobId(billId: string): string {
  return `bill-summary__${billId}`;
}

/** The counters one request is taken from. */
interface CapKeys {
  global: string;
  reader: string;
  ip?: string;
}
