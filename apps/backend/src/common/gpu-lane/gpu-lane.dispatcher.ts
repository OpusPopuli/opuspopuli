import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import {
  LaneMetric,
  laneQueueName,
  LLMError,
  METRICS_OBSERVER,
  type GenerateResult,
  type ILLMProvider,
  type IGpuLaneDispatcher,
  type GpuLaneEndpoint,
  type GpuLaneJob,
  type MetricsObserver,
} from '@opuspopuli/common';
import { createLaneProvider } from '@opuspopuli/llm-provider';
import {
  createWorker,
  QUEUE_CONNECTION,
  withTraceContext,
} from '@opuspopuli/queue-provider';
import { Job, Queue, QueueEvents, type Worker } from 'bullmq';
import type IORedis from 'ioredis';

/** Options resolved from config in `GpuLaneModule.forRoot`. */
export interface GpuLaneOptions {
  /** BullMQ key prefix — the same one every other queue uses. */
  prefix: string;
  /** GPU slots per endpoint, across every process. 1 = `OLLAMA_NUM_PARALLEL`. */
  globalConcurrency: number;
  /** Longest a caller waits for a queued job before giving up loudly. */
  waitTimeoutMs: number;
}

export const GPU_LANE_OPTIONS = 'GPU_LANE_OPTIONS';

/** Builds the provider a consumer runs a job on. Swappable for tests. */
export const GPU_LANE_PROVIDER_FACTORY = 'GPU_LANE_PROVIDER_FACTORY';
export type LaneProviderFactory = (endpoint: GpuLaneEndpoint) => ILLMProvider;

/**
 * What a lane job carries in Redis. The prompt is personal data — a rerank
 * prompt holds a user's interests — so the consumer blanks it as soon as it
 * has read it, and retention below is minutes, not days.
 */
interface LaneJobData {
  lane: string;
  endpoint: Pick<GpuLaneEndpoint, 'url' | 'model'>;
  prompt: string;
  options?: GpuLaneJob['options'];
  /** Epoch ms after which nobody is waiting: the consumer skips the call. */
  deadline: number;
  /** The waiting dispatcher; gone from Redis = its process died. */
  producer: string;
  /** Read by `createWorker` for its job metrics. */
  triggerSource: 'lane';
}

interface LaneHandles {
  queue: Queue;
  events: QueueEvents;
  /** Ours to close: BullMQ never closes a connection it was handed. */
  eventsConnection: IORedis;
  worker: Worker;
}

/** Completed jobs hold the result; failed ones a (truncated) reason. */
const REMOVE_ON_COMPLETE = { age: 300, count: 1000 };
const REMOVE_ON_FAIL = { age: 3600, count: 500 };
/**
 * The events stream carries every job's RESULT — BullMQ writes the return
 * value into the `completed` event — so it is capped by count and, trimmed on
 * every heartbeat, by age. Five minutes is far longer than a live waiter lags.
 */
const EVENTS_MAX_LEN = 500;
const EVENTS_MAX_AGE_MS = 5 * 60_000;
/** A failure's text crosses Redis to the waiter; a stack or a body need not. */
const MAX_REASON_CHARS = 200;
/** Producer liveness: refreshed well inside its TTL. */
const PRODUCER_TTL_SECONDS = 60;
const PRODUCER_REFRESH_MS = 20_000;
/** At most one "calling directly" warning per this interval, with a count. */
const DIRECT_WARN_INTERVAL_MS = 60_000;
/**
 * A lane job's lock: 5 minutes, `createWorker`'s default.
 *
 * BullMQ checks for renewals every quarter of it and renews a lock older than
 * that, so a lock is renewed every ¼–½ of its duration: a pause of the
 * consumer — a blocked event loop, a swapping or sleeping host — survives at
 * least ~150 s here, where the previous 30 s survived as little as ~15 s.
 * Redis expires locks by wall clock, so a pause of the whole host counts.
 *
 * Measured at 30 s, on the 2026-10-23 civics baseline: the host idle-slept
 * (one sleep of 282 s, `pmset -g log`) while swapping hard, two jobs lost
 * their lock, and with `maxStalledCount: 0` both were failed while Ollama went
 * on generating them — 181 s of inference nobody waited for, two pages lost.
 * Five minutes would probably NOT have saved a 282 s sleep; keeping the host
 * awake does (the baseline runbook says so). It does cover stalls of a minute
 * or two, which a loaded host has routinely.
 *
 * The cost: a consumer killed mid-call — every restart or redeploy of a worker
 * during a running LLM call, since its 10 s stop grace is shorter than a call
 * — holds the global slot until its lock lapses and another consumer's stall
 * check fails the job, up to ~5½ min. If it was the only consumer, until one
 * starts.
 */
const LANE_LOCK_MS = 300_000;
/** A missing liveness key is re-checked once after this — see `isAlive`. */
const LIVENESS_GRACE_MS = 5_000;
/** Ceilings on what a job read from Redis may ask of the GPU. */
const MAX_REQUEST_TIMEOUT_MS = 3_700_000; // = llm.module's transport floor
const MAX_TOKENS = 131_072;
const MAX_STOP_SEQUENCES = 16;
const MAX_STOP_SEQUENCE_CHARS = 256;

const endpointKey = (lane: string, url: string, model: string): string =>
  `${lane}|${url}|${model}`;

/**
 * Batch inference through one BullMQ queue per Ollama endpoint (S7,
 * `docs/plans/S7-gpu-lane-queue.md`).
 *
 * `generate` enqueues the call and waits for its result; this process's lane
 * worker — and every other worker process's — consumes the queue, under
 * `setGlobalConcurrency`, so the GPU sees one batch request at a time however
 * many processes are syncing. Interactive inference never comes here: only
 * worker processes bind this dispatcher.
 *
 * A sync job that waits here cannot deadlock against itself: the lane worker
 * is its own BullMQ worker, separate from the queue the sync job runs on, and
 * every process that enqueues here also consumes.
 *
 * A consumer runs only endpoints its own process registered, and clamps the
 * options a job carries (`safeOptions`). Every process that shares a lane
 * must therefore configure it the same way — which they do, from one
 * environment — and one that does not fails the job, naming neither the URL
 * nor the prompt.
 *
 * It owns a duplicate of the queue connection: Nest destroys this global
 * module LAST, after `QueueModule` has quit the shared connection, and the
 * worker, the liveness key and the abandoned-job removals all still need
 * Redis while it shuts down.
 */
@Injectable()
export class GpuLaneDispatcher implements IGpuLaneDispatcher, OnModuleDestroy {
  private readonly logger = new Logger(GpuLaneDispatcher.name);
  private readonly lanes = new Map<string, Promise<LaneHandles>>();
  private readonly endpoints = new Map<string, GpuLaneEndpoint>();
  private readonly providers = new Map<string, ILLMProvider>();
  /** Rejects every caller still waiting, at shutdown. */
  private readonly waiters = new Set<(error: Error) => void>();
  private readonly producerId: string = randomUUID();
  private heartbeat?: NodeJS.Timeout;
  /** Settles once the liveness key exists — awaited before every enqueue. */
  private heartbeatReady?: Promise<void>;
  private directCalls = 0;
  private lastDirectWarn = 0;
  private ownConnection?: IORedis;
  private destroyed = false;
  /** Producers confirmed gone: their remaining jobs skip without the grace. */
  private readonly deadProducers = new Set<string>();
  /** lane|model pairs already warned about — once each, not once per job. */
  private readonly refusalsWarned = new Set<string>();

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    @Inject(GPU_LANE_OPTIONS) private readonly options: GpuLaneOptions,
    @Optional()
    @Inject(METRICS_OBSERVER)
    private readonly metrics?: MetricsObserver,
    @Optional()
    @Inject(GPU_LANE_PROVIDER_FACTORY)
    private readonly providerFactory: LaneProviderFactory = createLaneProvider,
  ) {}

  private get redis(): IORedis {
    this.ownConnection ??= this.connection.duplicate();
    return this.ownConnection;
  }

  register(lane: string, endpoint: GpuLaneEndpoint): void {
    this.endpoints.set(endpointKey(lane, endpoint.url, endpoint.model), {
      ...endpoint,
    });
  }

  /**
   * Queue one generation and wait for it.
   *
   * A Redis outage makes the enqueue WAIT, not throw — BullMQ's connection
   * retries without limit — which is no worse than today: the sync job doing
   * the waiting is itself a BullMQ job, stopped by the same outage. An error
   * that IS thrown before the job is queued falls back to calling the
   * endpoint directly, as every process did before S7.
   */
  async generate(job: GpuLaneJob): Promise<GenerateResult> {
    const name = laneQueueName(job.endpoint.url);
    let lane: LaneHandles;
    let queued: Job<LaneJobData>;
    try {
      lane = await this.laneFor(name);
      await this.ensureHeartbeat();
      queued = await lane.queue.add(name, withTraceContext(this.toData(job)), {
        attempts: 1,
        removeOnComplete: REMOVE_ON_COMPLETE,
        removeOnFail: REMOVE_ON_FAIL,
      });
    } catch (error) {
      this.warnDirect(name, error as Error);
      return this.providerFor(job.lane, job.endpoint).generate(
        job.prompt,
        job.options,
      );
    }
    try {
      return await this.waitFor(queued, lane.events);
    } catch (error) {
      // Nobody will read it now. Still waiting = removable, so it never
      // reaches the GPU; already running = the remove throws and the deadline
      // was the last guard.
      await queued.remove().catch(() => undefined);
      // A removed job never completes or fails, so `waitUntilFinished` would
      // keep its listeners — and the Job, prompt and all — for the life of
      // the process. Its own failure handler is what removes them.
      // (Untyped: BullMQ emits these per-job names itself, outside its types.)
      (lane.events as unknown as EventEmitter).emit(`failed:${queued.id}`, {
        failedReason: 'abandoned',
      });
      // The type callers see today, carrying the consumer's failure once —
      // its message already names the operation.
      throw new LLMError('lane-queue', 'generate', error as Error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    const closing = new Error('GPU lane dispatcher is shutting down');
    for (const reject of this.waiters) reject(closing);
    this.waiters.clear();
    if (this.heartbeat) clearInterval(this.heartbeat);

    const lanes = await Promise.allSettled(this.lanes.values());
    await Promise.allSettled(
      lanes.flatMap((r) =>
        r.status === 'fulfilled' ? closeHandles(r.value) : [],
      ),
    );
    if (this.heartbeat) {
      await this.redis.del(this.producerKey()).catch(() => undefined);
    }
    // After the QueueEvents is closed, its connection — a duplicate this
    // dispatcher made — is ours to release, or it holds shutdown open; and
    // our own connection last of all.
    await Promise.allSettled(
      lanes.flatMap((r) =>
        r.status === 'fulfilled' ? [r.value.eventsConnection.quit()] : [],
      ),
    );
    await this.ownConnection?.quit().catch(() => undefined);
  }

  private toData(job: GpuLaneJob): LaneJobData {
    return {
      lane: job.lane,
      endpoint: { url: job.endpoint.url, model: job.endpoint.model },
      prompt: job.prompt,
      ...(job.options ? { options: job.options } : {}),
      deadline: Date.now() + this.options.waitTimeoutMs,
      producer: this.producerId,
      triggerSource: 'lane',
    };
  }

  /**
   * The job's result, or a rejection — on timeout, or at shutdown.
   *
   * The timeout is ours, not `waitUntilFinished`'s ttl: BullMQ's ttl timer
   * outlives an abandoned wait — once shutdown closes the event stream the
   * job's completion never arrives — and would hold the process open for the
   * rest of `waitTimeoutMs` — until the container's grace period ran out
   * and it was killed mid-shutdown. Ours is cleared on every outcome.
   */
  private waitFor(
    queued: Job<LaneJobData>,
    events: QueueEvents,
  ): Promise<GenerateResult> {
    let abort!: (error: Error) => void;
    let timer: NodeJS.Timeout | undefined;
    const stopped = new Promise<never>((_, reject) => {
      abort = reject;
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `no result within ${this.options.waitTimeoutMs}ms of queueing`,
            ),
          ),
        this.options.waitTimeoutMs,
      );
    });
    this.waiters.add(abort);
    return Promise.race([
      queued.waitUntilFinished(events) as Promise<GenerateResult>,
      stopped,
    ]).finally(() => {
      clearTimeout(timer);
      this.waiters.delete(abort);
    });
  }

  /** The queue, its event stream and this process's worker for an endpoint. */
  private laneFor(name: string): Promise<LaneHandles> {
    let lane = this.lanes.get(name);
    if (!lane) {
      lane = this.openLane(name);
      // A lane that failed to open is retried on the next call, not cached.
      lane.catch(() => this.lanes.delete(name));
      this.lanes.set(name, lane);
    }
    return lane;
  }

  private async openLane(name: string): Promise<LaneHandles> {
    const { prefix, globalConcurrency } = this.options;
    const queue = new Queue(name, {
      connection: this.redis,
      prefix,
      streams: { events: { maxLen: EVENTS_MAX_LEN } },
    });
    // Each waiter adds one 'closing' listener here, removed when it settles;
    // more than ten concurrent waiters on one host is normal, not a leak.
    queue.setMaxListeners(0);
    let events: QueueEvents | undefined;
    let eventsConnection: IORedis | undefined;
    let worker: Worker;
    try {
      await this.applyGlobalConcurrency(queue, name, globalConcurrency);
      eventsConnection = this.redis.duplicate();
      events = new QueueEvents(name, { connection: eventsConnection, prefix });
      await events.waitUntilReady();
      worker = this.openWorker(name);
    } catch (error) {
      // Nothing is cached for a lane that failed to open, so nothing else
      // would ever close what it got as far as opening.
      await Promise.allSettled([events?.close(), queue.close()]);
      await eventsConnection?.quit().catch(() => undefined);
      throw error;
    }
    this.logger.log(
      `Lane queue ${name} open: global concurrency ${globalConcurrency}`,
    );
    return { queue, events, eventsConnection, worker };
  }

  private openWorker(name: string): Worker {
    return createWorker<LaneJobData>(
      name,
      this.redis,
      (job) => this.run(name, job),
      {
        prefix: this.options.prefix,
        // Per-process slots match the global bound, so a bound above 1 is
        // reachable from one process; Redis still caps the total.
        concurrency: this.options.globalConcurrency,
        lockDuration: LANE_LOCK_MS,
        // A stalled job FAILS rather than re-running elsewhere: its first
        // run may still be on the GPU, and a second would be a duplicate
        // call nobody needs. The waiter gets an LLMError, as for any failure.
        maxStalledCount: 0,
        // One job per LLM call: the sync job it serves logs the outcome.
        quiet: true,
      },
    );
  }

  /**
   * Redis-side, so it binds every consumer in every process. Every process
   * sets it at first use; differing values mean the last one to start wins,
   * which is worth saying rather than discovering.
   */
  private async applyGlobalConcurrency(
    queue: Queue,
    name: string,
    wanted: number,
  ): Promise<void> {
    const current = await queue.getGlobalConcurrency();
    if (current !== null && current !== wanted) {
      this.logger.warn(
        `Lane queue ${name}: global concurrency was ${current}, setting ` +
          `${wanted} — every worker process should share ` +
          'GPU_LANE_GLOBAL_CONCURRENCY',
      );
    }
    await queue.setGlobalConcurrency(wanted);
  }

  /** Consumer side: run a job this process is configured for, once. */
  private async run(
    name: string,
    job: Job<LaneJobData>,
  ): Promise<GenerateResult> {
    const { lane, endpoint, prompt, options, deadline, producer } = job.data;
    // Out of Redis before the call, not after the job is reaped.
    await job.updateData({ ...job.data, prompt: '' }).catch(() => {
      this.logger.warn(
        `Lane queue ${name}: could not blank job ${job.id}'s prompt; it ` +
          'stays in Redis until the job is removed',
      );
    });

    const local = this.endpoints.get(
      endpointKey(lane, endpoint.url, endpoint.model),
    );
    try {
      if (!local) {
        this.warnRefusal(name, lane, endpoint.model);
        throw new Error(
          'this process does not configure that lane for that endpoint and ' +
            'model',
        );
      }
      // Labelled only once the lane is known to be ours: a forged job's
      // lane string must not mint metric series.
      const started = job.processedOn ?? Date.now();
      this.observeWait(lane, name, (started - job.timestamp) / 1000);
      await this.assertSomeoneWaiting(deadline, producer);
      return await this.providerFor(lane, local).generate(
        prompt,
        safeOptions(options),
      );
    } catch (error) {
      // The provider's LLMError already names the operation; the waiter wraps
      // once more, so pass on only what went wrong.
      const cause =
        error instanceof LLMError ? error.originalError : (error as Error);
      throw new Error(truncate(cause.message));
    }
  }

  /** A job whose caller timed out or died is not worth a GPU slot. */
  private async assertSomeoneWaiting(
    deadline: number,
    producer: string,
  ): Promise<void> {
    if (Date.now() > deadline) {
      throw new Error('expired before a GPU slot came free');
    }
    if (producer === this.producerId) return;
    if (!(await this.isAlive(producer))) {
      throw new Error('its caller is no longer running');
    }
  }

  /**
   * Whether a producer's liveness key exists. A missing key is re-checked
   * once after a short grace: a host that slept (the UAT Mac pauses its VM)
   * resumes with every TTL expired and the producer's overdue heartbeat not
   * yet run. A producer confirmed gone is remembered, so the rest of a dead
   * sync's backlog skips without each paying the grace on the GPU slot —
   * but still asked once per job, so a live producer that merely missed its
   * window (a stalled event loop, a restored Redis) is served again as soon
   * as its key is back, rather than refused until this process restarts.
   */
  private async isAlive(producer: string): Promise<boolean> {
    const exists = async () =>
      Boolean(
        await this.redis.exists(this.producerKey(producer)).catch(() => 1),
      ); // unknown = assume alive, as before S7
    if (await exists()) {
      this.deadProducers.delete(producer);
      return true;
    }
    if (this.deadProducers.has(producer)) return false;
    await new Promise((r) => setTimeout(r, LIVENESS_GRACE_MS));
    if (await exists()) return true;
    if (this.deadProducers.size > 1000) this.deadProducers.clear();
    this.deadProducers.add(producer);
    this.logger.warn(
      `Lane jobs from producer ${producer.slice(0, 36)} are being skipped: ` +
        'its liveness key is gone, so its process is taken to be dead',
    );
    return false;
  }

  /**
   * Publish this producer's liveness before its first job is queued. Shared
   * as a promise: a second call arriving mid-publish must not enqueue before
   * the key exists, or another consumer would skip its job as orphaned.
   */
  private ensureHeartbeat(): Promise<void> {
    // Reset only by its OWN failure: any other enqueue error leaving the
    // promise in place is what stops a second interval being started.
    this.heartbeatReady ??= this.startHeartbeat().catch((error: unknown) => {
      this.heartbeatReady = undefined;
      throw error;
    });
    return this.heartbeatReady;
  }

  private async startHeartbeat(): Promise<void> {
    const beat = () =>
      this.redis.set(this.producerKey(), '1', 'EX', PRODUCER_TTL_SECONDS);
    // First publish before the interval exists: if it throws, nothing is
    // left running and the next call starts over.
    await beat();
    // Shutdown may have run while the first publish was in flight.
    if (this.destroyed) return;
    this.heartbeat = setInterval(() => {
      beat().catch(() => undefined);
      this.trimEvents(Date.now() - EVENTS_MAX_AGE_MS).catch(() => undefined);
    }, PRODUCER_REFRESH_MS);
    this.heartbeat.unref();
  }

  /** Drop events — and the results they carry — older than `minTime`. */
  private async trimEvents(minTime: number): Promise<void> {
    const lanes = await Promise.allSettled(this.lanes.values());
    await Promise.all(
      lanes.flatMap((r) =>
        r.status === 'fulfilled'
          ? [
              this.redis.xtrim(
                `${this.options.prefix}:${r.value.queue.name}:events`,
                // Exact, not `~`: approximate trimming drops only whole stream
                // nodes, which on a quiet lane keeps results well past the
                // age. At ≤500 entries an exact trim is cheap.
                'MINID',
                String(minTime),
              ),
            ]
          : [],
      ),
    );
  }

  private producerKey(id = this.producerId): string {
    return `${this.options.prefix}:gpu-lane:producer:${id}`;
  }

  private providerFor(lane: string, endpoint: GpuLaneEndpoint): ILLMProvider {
    const key = endpointKey(lane, endpoint.url, endpoint.model);
    let provider = this.providers.get(key);
    if (!provider) {
      provider = this.providerFactory(endpoint);
      this.providers.set(key, provider);
    }
    return provider;
  }

  /**
   * Said once per lane and model, by the process that has the mismatch: a
   * partial redeploy otherwise fails a share of jobs with nobody told why.
   * The model is from Redis — quoted and truncated, never the URL.
   */
  private warnRefusal(name: string, lane: string, model: string): void {
    const key = `${lane}|${model}`;
    if (this.refusalsWarned.has(key) || this.refusalsWarned.size >= 20) return;
    this.refusalsWarned.add(key);
    this.logger.warn(
      `Lane queue ${name}: refusing jobs for lane ` +
        `${JSON.stringify(truncate(lane, 40))} with model ` +
        `${JSON.stringify(truncate(model, 80))} — this process does not ` +
        'configure it. Do all worker processes share their LLM_* settings?',
    );
  }

  /** Rate-limited: an outage would otherwise warn once per prompt. */
  private warnDirect(name: string, error: Error): void {
    this.directCalls += 1;
    const now = Date.now();
    if (now - this.lastDirectWarn < DIRECT_WARN_INTERVAL_MS) return;
    this.logger.warn(
      `Lane queue ${name} unavailable, calling the endpoint directly ` +
        `(${this.directCalls} call(s) since the last warning): ` +
        truncate(error.message),
    );
    this.lastDirectWarn = now;
    this.directCalls = 0;
  }

  /** Never throws: a metric is not worth failing an inference over. */
  private observeWait(lane: string, endpoint: string, seconds: number): void {
    try {
      this.metrics?.observe(LaneMetric.WaitSeconds, Math.max(0, seconds), {
        lane,
        endpoint,
      });
    } catch {
      // the observer warns on its own
    }
  }
}

function closeHandles(lane: LaneHandles): Promise<void>[] {
  return [lane.worker.close(), lane.events.close(), lane.queue.close()];
}

function truncate(message: string, max = MAX_REASON_CHARS): string {
  return message.length > max ? `${message.slice(0, max)}…` : message;
}

/**
 * The options a job carries, rebuilt from known fields and clamped: they are
 * read from Redis, and an unbounded `maxTokens` (Ollama treats -1 as no
 * limit) with a huge timeout would hold the only GPU slot indefinitely.
 * Nothing legitimate exceeds these — civics, the largest, asks 64,000 tokens
 * within 60 minutes.
 */
export function safeOptions(
  options: GpuLaneJob['options'],
): GpuLaneJob['options'] {
  if (!options) return undefined;
  const { temperature, topP, topK, think, seed } = options;
  return {
    ...positiveCapped('maxTokens', options.maxTokens, MAX_TOKENS),
    ...positiveCapped(
      'requestTimeoutMs',
      options.requestTimeoutMs,
      MAX_REQUEST_TIMEOUT_MS,
    ),
    ...(Number.isFinite(temperature) ? { temperature } : {}),
    ...(Number.isFinite(topP) ? { topP } : {}),
    ...(Number.isFinite(topK) ? { topK } : {}),
    ...(typeof think === 'boolean' ? { think } : {}),
    ...(Number.isInteger(seed) ? { seed } : {}),
    ...stopSequences(options.stopSequences),
  };
}

function positiveCapped<K extends string>(
  key: K,
  value: unknown,
  max: number,
): Partial<Record<K, number>> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return {};
  }
  return { [key]: Math.min(Math.floor(value), max) } as Record<K, number>;
}

function stopSequences(value: unknown): { stopSequences?: string[] } {
  if (!Array.isArray(value)) return {};
  return {
    stopSequences: value
      .filter((s): s is string => typeof s === 'string')
      .slice(0, MAX_STOP_SEQUENCES)
      .map((s) => s.slice(0, MAX_STOP_SEQUENCE_CHARS)),
  };
}
