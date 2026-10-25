import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { METRICS_OBSERVER, type MetricsObserver } from '@opuspopuli/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  batchTransaction,
  buildSkipKey,
  extractJsonObjectSlice,
  htmlToReadableText,
  laneJobId,
  stableHash,
  type DataSourceConfig,
  type ILLMProvider,
  type JsonRepairClass,
  parseJsonWithRepair,
} from '@opuspopuli/common';
import {
  CIVICS_EXTRACT_QUEUE,
  type CivicsExtractJobData,
} from '@opuspopuli/queue-provider';
import { DataType } from '@opuspopuli/region-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';
import {
  abandonChildJobs,
  inlineBatch,
  laneIdleTimeoutMs,
  settleChildJobs,
  type ChildJobBatch,
  type ChildOutcome,
  type SettleEnd,
} from 'src/common/child-jobs/child-job-batch';
import { ChildJobQueues } from 'src/common/child-jobs/child-job-queues';
import { groundMeasureTypes } from './civics-grounding';
import { LlmGeneratorBase } from './llm-generator.base';
import { PipelineJobService } from './pipeline-job.service';
import { decodeFetchedText, type FetchedBytes } from './resilient-fetch';
import { SourceVersionService } from './source-version.service';
import { civicsSyncTracker } from './sync-phase-logger';

/**
 * The fields a civics extraction may carry. `unknown` because the model's
 * output is validated downstream, not here — this exists so the parse helper
 * and its caller agree on a name instead of repeating the shape twice.
 */
type CivicsBlockDraft = Partial<{
  chambers: unknown;
  measureTypes: unknown;
  lifecycleStages: unknown;
  sessionScheme: unknown;
  glossary: unknown;
}>;

/** Log-facing names for the repair classes, kept out of the util. */
const REPAIR_LABELS: Record<JsonRepairClass, string> = {
  quotes: 'unescaped quote(s)',
  commas: 'trailing comma(s)',
};

/**
 * Output token budget for one civics extraction.
 *
 * Raised from 32,000 after it silently cut off a good extraction. Measured
 * 2026-09-24 on `assembly.ca.gov/resources/glossary`, captured in full:
 *
 *   prompt          71,750 chars (~18K tokens)
 *   response       141,786 chars of well-formed JSON, 211 complete glossary
 *                  terms, then cut mid-string inside term 211
 *   finishReason   'length'  (i.e. the ceiling, not the model stopping)
 *
 * At ~4.4 chars/token that response was already at the 32,000 ceiling with the
 * page unfinished, so the budget has to roughly double to hold it: 64,000
 * tokens is ~280,000 chars, comfortably past the ~250 terms that page carries.
 *
 * REQUIRES a context window that can hold prompt + output. 18K in plus 64K out
 * is 82K, which fits the 131,072 a deployment should set via
 * LLM_INGESTION_CONTEXT_TOKENS — but NOTHING TRACKED SETS IT (see
 * .env.example, where it is commented out). With the window unset the deployed
 * GGUF build defaults to ~16K, the prompt alone already exceeds it, and a
 * bigger output budget just buys more degraded generation. Set the window and
 * this budget together; neither is much use alone.
 *
 * Per-source `llmMaxTokens` OVERRIDES this. California's three civics sources
 * carry 64,000 as of @opuspopuli/regions 1.0.97 (opuspopuli-regions#87); note
 * `packages/region-provider` pins that version SEPARATELY from
 * `apps/backend`, and region-provider's is the one the service resolves
 * from — see #1328.
 *
 * The cost is only paid when the model actually generates that much; a small
 * page stops on its own long before the ceiling. What a full budget COSTS in
 * time was measured wrong at first and is worth stating correctly:
 *
 *   short civics calls   ~63 tok/s   (38 tokens in 10s — the empty pages)
 *   the 253-term glossary 22.5 tok/s  (36,972 tokens in 27m52s)
 *
 * Long generations run ~3x slower per token than short ones, so sizing a
 * timeout from the short-call rate underestimates by that factor. A FULL
 * 64,000-token run is therefore ~47 min, not the ~15 min first estimated.
 *
 * Which means no timeout currently in play bounds this budget: the sources set
 * 22 min and `LLM_HEADERS_TIMEOUT_FLOOR_MS` is 22.5 min. The 27m52s run above
 * completed anyway, past its own 22-minute deadline without aborting — see
 * #1329, which is unresolved. Treat the bound as unenforced until it is.
 */
export const CIVICS_MAX_OUTPUT_TOKENS = 64000;

/**
 * Optional sampling seed — OFF by default, and deliberately so.
 *
 * Civics extraction is non-deterministic: two identical syncs on 2026-09-24
 * disagreed about two of 24 pages. `how-qualify-initiative` returned nothing on
 * the first run and 10,871 bytes on the second; `information-help-you-follow-process`
 * did the reverse. Same model, same prompt, same content, `temperature: 0.1`,
 * no seed.
 *
 * The obvious response is to pin a seed. That would be wrong here, and the
 * review of this change caught it: `QueueService` gives every job 3 attempts
 * with backoff, and the civics cron runs weekly. A page that currently
 * extracts on roughly half its attempts would, with a fixed seed, fail on all
 * three attempts and on every run thereafter — the same roll, forever. Pinning
 * would trade flakiness for permanent, silent coverage loss.
 *
 * So variance stays in production, where a retry is a second chance, and
 * determinism is opt-in for the place that actually needs it: measuring whether
 * a prompt change helped. Set CIVICS_EXTRACTION_SEED to pin a run.
 *
 * Attestation does not need this either — the output row already carries
 * `promptHash`, `promptVersion`, `llmModel` and `llmDigest`.
 *
 * Not in K1's skip key: an unchanged page is skipped whatever the seed. To
 * reproduce a run with a pinned seed, sync with `resetWatermark`, which
 * extracts every page.
 */
function civicsSeed(): number | undefined {
  const raw = process.env.CIVICS_EXTRACTION_SEED?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Measured output rate for a LONG civics generation, tokens per second.
 *
 * 22.5 tok/s — the 253-term glossary page, 36,972 tokens in 27m52s. Short calls
 * measure ~63 tok/s (38 tokens in 10s), and sizing anything from that number
 * underestimates by ~3x. That is exactly how a 22-minute timeout came to be
 * paired with a budget needing ~47 (#1329).
 */
const CIVICS_LONG_GEN_TOKENS_PER_SEC = 22.5;

/**
 * Warn when a source's own two limits cannot both be satisfied.
 *
 * `llmMaxTokens` and `llmRequestTimeoutMs` are independent numbers in region
 * config and nothing has ever related them. When the budget implies a longer
 * generation than the timeout allows, a big page does not truncate — it ABORTS,
 * on a path that captures neither prompt nor response, which is strictly harder
 * to diagnose than the truncation it replaced. That pairing shipped on
 * 2026-09-24 and went unnoticed only because a laptop suspended and stalled the
 * timer that would have fired.
 *
 * Reported, not enforced: a deployment may know something this estimate does not
 * — a faster host, or pages that never approach the budget. The point is that the
 * contradiction can no longer be silent.
 */
function warnIfBudgetExceedsTimeout(
  logger: Logger,
  sourceUrl: string,
  maxTokens: number,
  requestTimeoutMs: number | undefined,
): void {
  if (!requestTimeoutMs) return;
  const worstCaseMs = (maxTokens / CIVICS_LONG_GEN_TOKENS_PER_SEC) * 1000;
  if (worstCaseMs <= requestTimeoutMs) return;
  logger.warn(
    `Civics config for ${sourceUrl} cannot satisfy both of its own limits: ` +
      `llmMaxTokens ${maxTokens} is ~${Math.round(worstCaseMs / 60000)} min at ` +
      `${CIVICS_LONG_GEN_TOKENS_PER_SEC} tok/s, but llmRequestTimeoutMs is ` +
      `${Math.round(requestTimeoutMs / 60000)} min. A page using the full budget ` +
      `will ABORT rather than truncate, and the abort path captures no prompt or ` +
      `response. Raise the timeout, lower the budget, or chunk the page.`,
  );
}

/**
 * Minimal provider contract for civics ingestion. Civics consumes
 * declarative `dataSources` registered by the region plugin — the
 * orchestrator owns the plugin lookup, civics consumes the resulting
 * list. `getDataSources` is intentionally typed loosely (matches the
 * declarative-plugin signature) to avoid a hard import dependency.
 */
export interface CivicsProvider {
  getName?(): string;
  /** Optional because some legacy / mock providers don't expose the
   *  declarative dataSource registry. The sync short-circuits early
   *  when this is absent. */
  getDataSources?(filter?: DataType): DataSourceConfig[];
}

/**
 * The version of the code that turns the model's answer into stored rows —
 * JSON repair, `groundTypes`, the empty check, the normalisers, and the
 * generation constants (`temperature`, `topK`). It is in the skip key
 * (K1) because a skipped page skips that code too: **bump this whenever
 * any of it changes what an extraction stores**, or the fix never reaches
 * an unchanged page. (The prompt TEMPLATE is versioned by its own hash.)
 */
export const CIVICS_EXTRACTOR_VERSION = 'civics-extractor-1';

/**
 * The data-source config that changes a civics page's extraction — the
 * fields that reach the prompt (`contentGoal`, `category`, `hints`) or bound
 * its output (`llmMaxTokens`) — hashed for the skip key (K1,
 * `docs/plans/civics-phase-b.md`). Region config moves this output more than
 * the prompt does (the civics iteration measured it), so a skip that ignored
 * it would serve stale extractions after a hint edit. `crawlDepth`, `url`
 * and the like change WHICH pages run, not what one page extracts to.
 *
 * A new input to `getCivicsExtractionPrompt` must be added here; a test
 * pins the list against the prompt's inputs. The token budget is the
 * EFFECTIVE one, so changing the code default re-extracts too.
 */
export function civicsConfigHash(ds: CivicsSourceFields): string {
  return stableHash({
    extractor: CIVICS_EXTRACTOR_VERSION,
    contentGoal: ds.contentGoal,
    category: ds.category,
    hints: ds.hints,
    llmMaxTokens: ds.llmMaxTokens ?? CIVICS_MAX_OUTPUT_TOKENS,
  });
}

/**
 * The data-source fields one page's extraction reads — what a
 * `civics-extract` job carries (civics S3), so the worker needs no plugin.
 */
export type CivicsSourceFields = CivicsExtractJobData['source'];

export function civicsSourceFields(ds: DataSourceConfig): CivicsSourceFields {
  return {
    url: ds.url,
    contentGoal: ds.contentGoal,
    category: ds.category,
    hints: ds.hints,
    llmMaxTokens: ds.llmMaxTokens,
    llmRequestTimeoutMs: ds.llmRequestTimeoutMs,
  };
}

/** What a completed extraction yielded, recorded with its skip key. */
type PageExtractionOutcome = 'block' | 'empty';

/**
 * How each page outcome is counted: the operator-facing label, the tracker's
 * fixed outcome union, and a bounded metric reason where one exists.
 */
const PAGE_OUTCOME: Record<
  'created' | 'updated' | 'failed' | 'skipped' | 'stale' | 'unchanged',
  {
    outcomeLabel: string;
    outcome: 'created' | 'updated' | 'skipped' | 'error';
    reason?: string;
  }
> = {
  created: { outcomeLabel: 'created', outcome: 'created' },
  updated: { outcomeLabel: 'updated', outcome: 'updated' },
  failed: { outcomeLabel: 'failed', outcome: 'error' },
  // The only path to `skipped`: a page with no civic content (#874).
  skipped: {
    outcomeLabel: 'skipped (no civic content)',
    outcome: 'skipped',
    reason: 'no_content',
  },
  // Counted as `skipped` structurally — nothing was written — but with a
  // label that says WHY, so the phase log distinguishes a page with no civic
  // content from one whose existing extraction just failed to refresh
  // (#1335), and a slug so the metric does too.
  stale: {
    outcomeLabel: 'skipped (empty over existing — row kept, now stale)',
    outcome: 'skipped',
    reason: 'empty_over_existing',
  },
  // K1: the same text, prompt, model, config and extractor as the last
  // completed extraction — no LLM call.
  unchanged: {
    outcomeLabel: 'skipped (unchanged since its last extraction)',
    outcome: 'skipped',
    reason: 'unchanged',
  },
};

/** One page's result, as the sync counts it. */
export type CivicsPageOutcome = keyof typeof PAGE_OUTCOME;

function isPageOutcome(value: unknown): value is CivicsPageOutcome {
  return typeof value === 'string' && Object.hasOwn(PAGE_OUTCOME, value);
}

/** Everything a page's extraction is keyed and prompted by. */
interface PageInputs {
  promptText: string;
  promptHash: string;
  promptVersion: string;
  sourceTextHash: string;
  configHash: string;
  skipKey: string | null;
}

/** A page ready for the extract queue. */
interface QueuedPage {
  jobId: string;
  data: CivicsExtractJobData;
}

/**
 * Shared HTTP / HTML helpers passed in by the orchestrator (#828 follow-up
 * will consolidate these into a shared module after the bills extraction
 * in Step 7 lands). Bills also uses these — until that consolidation,
 * passing them as callbacks keeps CivicsSyncService free of an
 * orchestrator-class dependency that would create a circular DI graph.
 */
export interface CivicsCrawlHelpers {
  /**
   * Bytes, not text (civics S3): the page is archived in `source_versions`
   * before its extraction is queued, and the worker reloads it from there.
   */
  fetchUrlBytes(url: string): Promise<FetchedBytes>;
  crawlCivicsUrls(
    ds: DataSourceConfig,
    registeredHosts: Set<string>,
  ): Promise<string[]>;
}

/**
 * Owns civics-data ingestion (extracted from RegionSyncService as #828
 * Step 5). Phases: discover → extract_and_upsert. Each declarative
 * civics data source is crawled within scope, then each discovered URL
 * is LLM-extracted into a `CivicsBlock` row plus the per-region
 * glossary upserts.
 */
@Injectable()
export class CivicsSyncService extends LlmGeneratorBase {
  private readonly logger = new Logger(CivicsSyncService.name, {
    timestamp: true,
  });

  /**
   * One place where the metrics observer reaches a tracker, rather than a
   * fifth argument on each call below. `Parameters<typeof civicsSyncTracker>`
   * keeps the compile-time phase check — passing another data type's phase
   * name is still a type error.
   */
  private civicsTracker(
    phase: Parameters<typeof civicsSyncTracker>[1],
    total: number,
    summaryArgs?: Record<string, string | number>,
  ): ReturnType<typeof civicsSyncTracker> {
    return civicsSyncTracker(
      this.logger,
      phase,
      total,
      summaryArgs,
      this.metrics,
    );
  }

  constructor(
    db: DbService,
    @Optional() promptClient?: PromptClientService,
    // ILLMProvider is an interface (erased at runtime), so there is no
    // implicit injection token — NestJS resolves it by the explicit token
    // LLMModule provides. Without @Inject here, @Optional() silently yields
    // `undefined` and civics sync no-ops. See #869.
    //
    // The INGESTION lane (roadmap §6.4), unlike every other generator on this
    // base: civics extraction pulls structured facts out of scraped pages —
    // chambers, measure types, lifecycle, glossary — which is an extraction
    // job rather than a synthesis one. It is the other half of the workload
    // measured as job-1, alongside structural analysis.
    @Optional() @Inject('LLM_INGESTION_PROVIDER') llm?: ILLMProvider,
    /**
     * Where item outcomes go (M1, `docs/plans/ingestion-resource-lanes.md`
     * §2). Optional and last: several specs construct this service by hand,
     * and a sync must run identically with no metrics bound.
     */
    @Optional()
    @Inject(METRICS_OBSERVER)
    private readonly metrics?: MetricsObserver,
    /** Where each page is archived, and reloaded from by the worker (S3). */
    @Optional() private readonly sourceVersions?: SourceVersionService,
    /** Absent (or disabled): extraction runs in this process, as before S3. */
    @Optional() private readonly childQueues?: ChildJobQueues,
    /** Read for an operator's cancel while the run waits on its pages. */
    @Optional() private readonly pipelineJobs?: PipelineJobService,
  ) {
    // This class used to only *mirror* LlmGeneratorBase's constructor. It now
    // inherits it (#1281), so civics extraction goes through the same
    // attribution write path as every other generator instead of assembling
    // its own — which is how `llm_model` came to be stamped here but the
    // digest would not have been.
    super(undefined, promptClient, llm, db);
  }

  /**
   * @param options.reextract - Ignore K1's skip records and extract every
   *   page — the operator's way to force a fresh run (the sync's
   *   `resetWatermark`), rather than deleting rows by hand.
   * @param options.pipelineJobId - The run's `pipeline_jobs` row, read for a
   *   cancel between pages.
   */
  async sync(
    plugin: CivicsProvider,
    helpers: CivicsCrawlHelpers,
    options: { reextract?: boolean; pipelineJobId?: string } = {},
  ): Promise<{
    processed: number;
    created: number;
    updated: number;
    skipped?: number;
  }> {
    // `db` joins this guard because LlmGeneratorBase declares it optional —
    // a generator can legitimately be constructed without one. Civics sync
    // cannot, so it refuses here rather than asserting its way through.
    if (!this.promptClient || !this.llm || !this.db || !this.sourceVersions) {
      this.logger.warn(
        'Civics sync requires PromptClient, LLM provider, DbService and ' +
          'SourceVersionService; skipping',
      );
      return { processed: 0, created: 0, updated: 0 };
    }

    if (!plugin?.getDataSources) {
      this.logger.warn(
        'Region plugin does not expose getDataSources(); skipping civics sync',
      );
      return { processed: 0, created: 0, updated: 0 };
    }

    const dataSources = plugin.getDataSources!(DataType.CIVICS);
    if (dataSources.length === 0) {
      this.logger.log('No civics data sources configured for this region');
      return { processed: 0, created: 0, updated: 0 };
    }

    const registeredHosts = new Set(
      plugin.getDataSources!().flatMap((s) => {
        try {
          return [new URL(s.url).hostname];
        } catch {
          return [];
        }
      }),
    );

    const regionId = plugin.getName?.() ?? 'unknown';
    // Pages by outcome. `stale` — extracted empty over an existing row, kept
    // and now staler than its siblings (#1335) — is counted apart from
    // `skipped`, the benign "this page has no civic content" case, and from
    // `unchanged`, the K1 skip.
    const counts: Record<keyof typeof PAGE_OUTCOME, number> = {
      created: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      stale: 0,
      unchanged: 0,
    };

    // ─── Phase 1/2 — discover ──────────────────────────────────────
    const discoverTracker = this.civicsTracker('discover', dataSources.length, {
      region: regionId,
    });
    const allUrls: Array<{ url: string; ds: DataSourceConfig }> = [];
    for (const ds of dataSources) {
      // Once per source, before any inference is spent: say so if this source's
      // budget and timeout contradict each other (#1329).
      warnIfBudgetExceedsTimeout(
        this.logger,
        ds.url,
        ds.llmMaxTokens ?? CIVICS_MAX_OUTPUT_TOKENS,
        ds.llmRequestTimeoutMs,
      );
      const urls = await helpers.crawlCivicsUrls(ds, registeredHosts);
      discoverTracker.item({
        name: ds.url,
        externalId: null,
        outcomeLabel: `${urls.length} page(s) at depth ${ds.crawlDepth ?? 0}`,
        outcome: 'updated',
      });
      for (const url of urls) allUrls.push({ url, ds });
    }
    discoverTracker.complete();

    // ─── Phase 2/2 — extract_and_upsert ────────────────────────────
    const end = await this.extractPages(
      regionId,
      allUrls,
      helpers,
      options,
      counts,
    );
    const { created, updated, stale } = counts;
    if (end !== 'settled') {
      this.logger.warn(
        { regionId, end },
        end === 'cancelled'
          ? 'Civics sync cancelled: pages not yet started were dropped; ' +
              'those already running finished first'
          : 'Civics sync gave up on pages that never reported — counted as failed',
      );
    }

    // Surfaced once per run at `warn`, because the per-page warnings are easy
    // to lose in a long sync and the aggregate is the thing worth noticing: a
    // job that reports `succeeded` while N pages silently failed to refresh is
    // exactly how one California page sat three syncs behind on prompt v5
    // while the other eleven moved to v6 (#1335).
    if (stale > 0) {
      this.logger.warn(
        { regionId, stale, written: created + updated },
        `Civics sync kept ${stale} existing block(s) that extracted empty ` +
          `this run, against ${created + updated} written. Those pages are ` +
          `now staler than the rest and their prompt provenance no longer ` +
          `matches the live prompt. The run still reports success.`,
      );
    }

    // Once per run, not per page: a term can lose a source on one page and
    // gain one on the next, and pruning mid-run would churn rows that the
    // same sync is about to re-source. After `extractPages`, which returns
    // only once every queued page has reported (S3).
    await this.pruneUnsourcedGlossaryEntries(regionId);

    // `skipped` reaches the job's result (`itemsSkipped`): with K1 a normal
    // run skips most pages, and "0 items" alone reads as a sync that did
    // nothing rather than one that found nothing new.
    return {
      processed: created + updated,
      created,
      updated,
      skipped: counts.skipped + counts.stale + counts.unchanged,
    };
  }

  /**
   * Ground the emitted measure types against the page and the source's hints,
   * reporting what changed.
   *
   * Extracted for the same reason as `parseBlockWithRepair`: the calling
   * function carried four concerns and exceeded the complexity gate. This one
   * is also the piece most likely to need changing again — grounding currently
   * covers `measureTypes` only, and the held-out gold page still shows
   * ungrounded items in `lifecycleStages` and `glossary`.
   */
  private groundTypes(
    measureTypes: unknown,
    content: string,
    ds: CivicsSourceFields,
    sourceUrl: string,
    promptVersion: string | undefined,
    promptHash: string | undefined,
  ): unknown {
    // Both warrants: the page, AND the source's own contentGoal + hints —
    // the same rule the eval harness prints on every run ("warrant: page
    // text OR the source's curated hints"). Passing only the page is what
    // deleted eleven hint-instructed measure types on 2026-10-06.
    const grounded = groundMeasureTypes(
      measureTypes as Parameters<typeof groundMeasureTypes>[0],
      content,
      [ds.contentGoal ?? '', ...(ds.hints ?? [])].join('\n'),
    );
    if (
      grounded.canonicalised.length > 0 ||
      grounded.dropped.length > 0 ||
      grounded.duplicatesRemoved > 0
    ) {
      this.logger.warn(
        {
          sourceUrl,
          canonicalised: grounded.canonicalised,
          dropped: grounded.dropped,
          duplicatesRemoved: grounded.duplicatesRemoved,
          // Non-empty means the model emitted the same type twice with
          // different content, and the first copy won. Worth seeing.
          conflicting: grounded.conflicting,
          kept: grounded.types.length,
          promptVersion,
          promptHash,
        },
        // "page or hints", not "page": the rule takes either warrant, and
        // the earlier wording here described the page-only version that
        // deleted eleven hint-instructed types.
        `Civics grounding on ${sourceUrl}: ` +
          `${grounded.canonicalised.length} code(s) replaced with the name ` +
          `the source uses, ${grounded.duplicatesRemoved} duplicate(s) ` +
          `collapsed, ${grounded.dropped.length} dropped as supported by ` +
          `neither the page nor the source hints.`,
      );
    }
    return grounded.types;
  }

  /**
   * Parse the model's JSON, repairing the two malformations that are both
   * common and recoverable before giving up.
   *
   * Carved out of `extractAndUpsertPage` because that function had grown to
   * four concerns and tripped the cognitive-complexity gate at 31 against a
   * limit of 15. The parse-and-repair decision is self-contained and reads
   * better alone; the caller only needs "a block, or nothing".
   *
   * Returns `undefined` when the response cannot be salvaged, having already
   * logged and captured — the caller turns that into a failed page.
   */
  private async parseBlockWithRepair(
    candidate: string,
    sourceUrl: string,
    promptText: string,
    result: { text: string; finishReason?: string },
    promptVersion: string | undefined,
    promptHash: string | undefined,
  ): Promise<CivicsBlockDraft | undefined> {
    let originalError: Error;
    try {
      return JSON.parse(candidate) as CivicsBlockDraft;
    } catch (e) {
      originalError = e as Error;
    }

    // The THIRD failure class, and until now the only one that captured
    // nothing. A slice with balanced braces that still will not parse is
    // almost always a bad escape inside a string — a raw control character,
    // or a `\x`/`\'` the model invented — some thousands of characters into
    // otherwise perfect output. The message alone cannot be acted on: the
    // offending bytes are the whole question, and they are not in the log.
    //
    // Observed twice on 2026-09-24, on different pages each time, and not
    // reproducible on a re-run because extraction is unseeded. A failure that
    // moves between runs and leaves no artifact cannot be fixed, which is
    // exactly the position the output-ceiling failure was in for two days.
    //
    // So before giving up: one repair pass for the malformations that are
    // both common and recoverable. A `verbatim` field exists to quote the
    // page, so a page that writes `referred to as a "full check."` produces
    // exactly this, and 22,162 characters of correct extraction were
    // discarded over it on 2026-10-06.
    const repair = parseJsonWithRepair(candidate);
    if (repair) {
      // At `warn`, not silently: the model emitting invalid JSON is a defect
      // worth seeing even when it is survivable, and a prompt fix for the
      // same thing is in flight.
      this.logger.warn(
        {
          sourceUrl,
          parseError: originalError.message,
          candidateChars: candidate.length,
          repairedChars: repair.repairedChars,
          // Which classes fired, so the log says what the model did wrong
          // rather than only that something was fixed.
          repaired: repair.applied,
          promptVersion,
          promptHash,
        },
        `Civics extraction: recovered ${sourceUrl} — the model's JSON was ` +
          `invalid, the content was intact. Repaired: ` +
          `${repair.applied.map((c) => REPAIR_LABELS[c]).join(' and ')}.`,
      );
      // The empty check, the upsert and the glossary write all apply
      // unchanged downstream. Nothing there needs to know the JSON arrived
      // bent.
      return repair.value as CivicsBlockDraft;
    }

    await this.reportUnsalvageableJson(
      candidate,
      sourceUrl,
      promptText,
      result,
      originalError,
      promptVersion,
      promptHash,
    );
    return undefined;
  }

  /**
   * Log and capture a response whose JSON could not be salvaged.
   *
   * Separate from the decision above so that neither the repair path nor the
   * complexity gate has to carry it: this is all reporting, and the thing it
   * reports — the bytes either side of the offending position — is the only
   * part a human can actually act on.
   */
  private async reportUnsalvageableJson(
    candidate: string,
    sourceUrl: string,
    promptText: string,
    result: { text: string; finishReason?: string },
    error: Error,
    promptVersion: string | undefined,
    promptHash: string | undefined,
  ): Promise<void> {
    const at = /position (\d+)/.exec(error.message)?.[1];
    const around = at
      ? candidate.slice(Math.max(0, Number(at) - 60), Number(at) + 60)
      : undefined;
    this.logger.warn(
      {
        sourceUrl,
        parseError: error.message,
        // Scraped civic text, like the rest of the prompt — same disclosure
        // as the capture below.
        around,
        candidateChars: candidate.length,
        responseChars: result.text.length,
        finishReason: result.finishReason,
        promptVersion,
        promptHash,
      },
      `Civics extraction: JSON.parse failed for ${sourceUrl} at position ` +
        `${at ?? 'unknown'} — the response had a complete JSON object that ` +
        `is not valid JSON, usually a bad escape inside a string. Not a ` +
        `budget problem and not a missing object.`,
    );
    await this.captureFailedExtraction(sourceUrl, promptText, result.text);
  }

  /**
   * Write the exact prompt and response of a failed extraction to disk, so the
   * failure can be reproduced offline instead of guessed at.
   *
   * **Opt-in, via `CIVICS_CAPTURE_DIR`.** Off by default and deliberately not
   * a log line: the prompt embeds scraped civic text, which under #1263 can
   * carry proponent contact details. Logs are shipped, indexed and retained;
   * a file written only when an operator asks for it is not. The `warn` above
   * carries sizes, hashes and `finishReason` — enough to triage — and none of
   * the text.
   *
   * Never throws. A diagnostic that can fail a sync is worse than no
   * diagnostic, and this runs on the path that is already failing.
   */
  private async captureFailedExtraction(
    sourceUrl: string,
    promptText: string,
    responseText: string,
  ): Promise<void> {
    const dir = process.env.CIVICS_CAPTURE_DIR;
    if (!dir) return;

    try {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { createHash } = await import('node:crypto');
      const stamp = createHash('sha256')
        .update(sourceUrl)
        .digest('hex')
        .slice(0, 12);
      await mkdir(dir, { recursive: true });
      await writeFile(
        `${dir}/civics-${stamp}.prompt.txt`,
        `# ${sourceUrl}\n# promptChars=${promptText.length}\n\n${promptText}`,
        'utf8',
      );
      await writeFile(
        `${dir}/civics-${stamp}.response.txt`,
        responseText,
        'utf8',
      );
      this.logger.warn(
        `Captured the failing civics prompt and response to ${dir}/civics-${stamp}.* ` +
          `— contains scraped civic text; delete it when the investigation is done`,
      );
    } catch (error) {
      this.logger.warn(
        `Could not capture the failing civics extraction: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Fetch, archive and key every page, queue the changed ones, and wait for
   * them all (civics S3). Each outcome is counted as it arrives, so the
   * consecutive-failure abort can fire mid-run; on an abort (or any error)
   * the pages not yet started are dropped and the running ones waited out
   * before it propagates.
   */
  private async extractPages(
    regionId: string,
    pages: Array<{ url: string; ds: DataSourceConfig }>,
    helpers: CivicsCrawlHelpers,
    options: { reextract?: boolean; pipelineJobId?: string },
    counts: Record<CivicsPageOutcome, number>,
  ): Promise<SettleEnd> {
    const tracker = this.civicsTracker('extract_and_upsert', pages.length, {
      region: regionId,
    });
    const record = (url: string, result: CivicsPageOutcome): void => {
      tracker.item({ name: url, externalId: null, ...PAGE_OUTCOME[result] });
      counts[result]++;
    };
    // jobId → the pages it stands for: two sources that reach one page with
    // identical inputs share a job, and both are counted.
    const queued = new Map<string, string[]>();
    const onOutcome = (outcome: ChildOutcome<string>): void => {
      const urls = queued.get(outcome.jobId) ?? [];
      queued.delete(outcome.jobId);
      for (const url of urls) record(url, this.outcomeOf(url, outcome));
    };
    const isCancelled = () => this.isCancelled(options.pipelineJobId);
    const idleTimeoutMs = laneIdleTimeoutMs();

    const batch = await this.openExtractBatch();
    try {
      for (const { url, ds } of pages) {
        if (await isCancelled()) break;
        const prepared = await this.preparePage(
          regionId,
          url,
          ds,
          helpers,
          options.reextract,
        );
        // Counted now: a page settled without a job (unchanged, or failed
        // before one was queued); otherwise its job's outcome counts it.
        const settledNow =
          'outcome' in prepared
            ? prepared.outcome
            : await this.queuePage(batch, queued, url, prepared);
        if (settledNow) record(url, settledNow);
        batch.take().forEach(onOutcome);
      }
      const end = await settleChildJobs(batch, {
        onOutcome,
        isCancelled,
        idleTimeoutMs,
      });
      tracker.complete();
      return end;
    } catch (error) {
      await abandonChildJobs(batch, idleTimeoutMs);
      throw error;
    } finally {
      await batch.close();
    }
  }

  /** The extract queue when one is bound and on; otherwise this process. */
  private openExtractBatch(): Promise<
    ChildJobBatch<CivicsExtractJobData, string>
  > {
    if (this.childQueues?.enabled(CIVICS_EXTRACT_QUEUE)) {
      return this.childQueues.open(CIVICS_EXTRACT_QUEUE);
    }
    return Promise.resolve(inlineBatch((job) => this.extractPage(job)));
  }

  /**
   * Queue a page, or count it with the job already queued for the same
   * inputs. A failure to queue is the page's failure, not the run's.
   */
  private async queuePage(
    batch: ChildJobBatch<CivicsExtractJobData, string>,
    queued: Map<string, string[]>,
    url: string,
    page: QueuedPage,
  ): Promise<CivicsPageOutcome | undefined> {
    const sharing = queued.get(page.jobId);
    if (sharing) {
      sharing.push(url);
      return undefined;
    }
    queued.set(page.jobId, [url]);
    try {
      await batch.add(page.data, page.jobId);
      return undefined;
    } catch (error) {
      queued.delete(page.jobId);
      this.logger.error(
        `Civics extraction could not be queued for ${url}: ${(error as Error).message}`,
      );
      return 'failed';
    }
  }

  /** A job's report as a page outcome; anything unrecognised is a failure. */
  private outcomeOf(
    url: string,
    outcome: ChildOutcome<string>,
  ): CivicsPageOutcome {
    if (!outcome.ok) {
      this.logger.error(
        `Civics extraction failed for ${url}: ${outcome.reason}`,
      );
      return 'failed';
    }
    return isPageOutcome(outcome.value) ? outcome.value : 'failed';
  }

  private async isCancelled(pipelineJobId?: string): Promise<boolean> {
    if (!pipelineJobId || !this.pipelineJobs) return false;
    try {
      return await this.pipelineJobs.isCancelled(pipelineJobId);
    } catch (error) {
      this.logger.warn(
        `Could not read cancellation for ${pipelineJobId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * The fetch half of a page: fetch its bytes, derive the text and key it
   * (K1). Unchanged → counted here, no job, nothing archived. Otherwise
   * archive the bytes and return the job to queue: keyed by `laneJobId` so a
   * page still in flight from an earlier run collapses onto that job; an
   * unknown digest (no key) gets a one-off id and never collapses.
   *
   * Archived only once it is going to be extracted: the archive dedupes on
   * the BYTES and K1 on the TEXT, so a page whose markup changes every
   * request (a token, a timestamp) would otherwise add an unreferenced row
   * every run while K1 skipped it.
   */
  private async preparePage(
    regionId: string,
    sourceUrl: string,
    ds: DataSourceConfig,
    helpers: CivicsCrawlHelpers,
    reextract = false,
  ): Promise<{ outcome: CivicsPageOutcome } | QueuedPage> {
    try {
      const fetched = await helpers.fetchUrlBytes(sourceUrl);
      const source = civicsSourceFields(ds);
      const content = htmlToReadableText(decodeFetchedText(fetched.body));
      const { skipKey } = await this.pageInputs(
        regionId,
        sourceUrl,
        source,
        content,
      );
      if (
        !reextract &&
        (await this.isUnchanged(regionId, sourceUrl, skipKey))
      ) {
        return { outcome: 'unchanged' };
      }
      const sourceVersionId = await this.archivePage(
        regionId,
        sourceUrl,
        fetched,
      );
      if (!sourceVersionId) return { outcome: 'failed' };
      return {
        jobId: extractJobId(regionId, sourceUrl, skipKey, reextract),
        data: { regionId, sourceUrl, sourceVersionId, source, reextract },
      };
    } catch (e) {
      // Fetch, prompt-service or model digest: anything before the job.
      this.logger.error(
        `Civics page could not be prepared for extraction (${sourceUrl}): ${(e as Error).message}`,
      );
      return { outcome: 'failed' };
    }
  }

  /**
   * Archive a fetched page; its row id is what the extraction job carries.
   * A page the archive refuses (empty, or over its size cap) cannot be
   * queued — there is nothing for the worker to reload.
   */
  private async archivePage(
    regionId: string,
    sourceUrl: string,
    fetched: FetchedBytes,
  ): Promise<string | undefined> {
    const archived = await this.sourceVersions!.record({
      content: fetched.body,
      contentHash: createHash('sha256').update(fetched.body).digest('hex'),
      sourceUrl,
      contentType: fetched.contentType,
      fetchedAt: fetched.fetchedAt,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      regionId,
      dataType: DataType.CIVICS,
    });
    if (!archived.sourceVersionId) {
      this.logger.warn(
        `Civics page ${sourceUrl} not archived (${archived.skippedReason ?? 'unknown'}); ` +
          `it cannot be extracted this run`,
      );
    }
    return archived.sourceVersionId;
  }

  /**
   * The prompt and the K1 skip key for one page's text. The parent and the
   * worker both call this — from the same bytes, through the same decode —
   * so they agree on the key.
   */
  private async pageInputs(
    regionId: string,
    sourceUrl: string,
    source: CivicsSourceFields,
    content: string,
  ): Promise<PageInputs> {
    const { promptText, promptHash, promptVersion } =
      await this.promptClient!.getCivicsExtractionPrompt({
        regionId,
        sourceUrl,
        contentGoal: source.contentGoal,
        category: source.category,
        hints: source.hints,
        html: content,
      });
    // K1: skip a page whose every input is unchanged since its last
    // completed extraction. Checked before the LLM call — which is the
    // whole cost: the 2026-10-23 baseline spent 97% of its run there.
    const sourceTextHash = sha256(content);
    const configHash = civicsConfigHash(source);
    const skipKey = buildSkipKey({
      sourceHash: sourceTextHash,
      promptHash,
      modelDigest: (await this.llm!.getModelDigest()) ?? '',
      configHash,
    });
    return {
      promptText,
      promptHash,
      promptVersion,
      sourceTextHash,
      configHash,
      skipKey,
    };
  }

  /**
   * One page's extraction — the `civics-extract` worker's job (S3), or run
   * inline when no queue is bound. Reloads the page from the archive and
   * re-checks its key: an earlier run may have finished it since it was
   * queued.
   *
   * A thrown error (a runner killed, the lane unreachable) is retried by the
   * queue; a deterministic failure — no JSON, JSON beyond repair — returns
   * `failed` and is not, because greedy decoding would reproduce it.
   */
  async extractPage(job: CivicsExtractJobData): Promise<CivicsPageOutcome> {
    if (!this.promptClient || !this.llm || !this.db || !this.sourceVersions) {
      throw new Error(
        'Civics extraction requires PromptClient, LLM provider, DbService and SourceVersionService',
      );
    }
    const version = await this.sourceVersions.getById(job.sourceVersionId);
    if (!version) {
      this.logger.warn(
        `Civics extraction: archived page ${job.sourceVersionId} for ` +
          `${job.sourceUrl} is gone; the next sync re-fetches it`,
      );
      return 'failed';
    }
    const content = htmlToReadableText(
      decodeFetchedText(Buffer.from(version.content)),
    );
    const page = await this.pageInputs(
      job.regionId,
      job.sourceUrl,
      job.source,
      content,
    );
    if (
      !job.reextract &&
      (await this.isUnchanged(job.regionId, job.sourceUrl, page.skipKey))
    ) {
      return 'unchanged';
    }
    return this.extractContent(job, content, page);
  }

  /**
   * Send a page's text through the civics-extraction prompt and upsert the
   * resulting `CivicsBlock` and glossary entries.
   */
  private async extractContent(
    job: CivicsExtractJobData,
    content: string,
    page: PageInputs,
  ): Promise<CivicsPageOutcome> {
    const { regionId, sourceUrl, source: ds } = job;
    const {
      promptText,
      promptHash,
      promptVersion,
      sourceTextHash,
      configHash,
      skipKey,
    } = page;
    const maxTokens = ds.llmMaxTokens ?? CIVICS_MAX_OUTPUT_TOKENS;
    const result = await this.llm!.generate(promptText, {
      maxTokens,
      // GREEDY. `temperature: 0.1` alone does not make this deterministic,
      // which cost three runs to work out: temperature sharpens the
      // DIFFERENCE between candidate probabilities and does nothing to a
      // genuine tie. The model appears near-50/50 on one decision — "does
      // this page carry civic content?" — and a 0.5/0.5 split stays 0.5/0.5
      // at any temperature above zero. Three runs on 2026-10-02 bore that
      // out: `failed-qualify` returned an empty block on all three while the
      // eval harness extracted it at three fixed seeds, and the Assembly
      // glossary page (55 terms, the largest contributor in the corpus)
      // landed on two runs and not the third.
      //
      // `topK: 1` takes the argmax even when the argmax wins 0.501 to
      // 0.499, which makes the output a function of the input. If a page
      // then extracts to nothing, that is a fact about the page or the
      // prompt — diagnosable — rather than a roll of the dice.
      //
      // This does NOT reintroduce the risk the seed comment below warns
      // about. A pinned seed freezes one arbitrary draw out of many; greedy
      // takes the model's single best answer, which is the branch a sampler
      // lands on most often anyway.
      //
      // `temperature: 0` would be the honest way to say this, but #1325
      // makes `||` coerce an explicit 0 to the default 0.7 — the exact
      // opposite of determinism. 0.1 is kept because it is harmless once
      // only one candidate survives top-k, and `topK: 1` is truthy so it
      // passes through that same `||` intact.
      temperature: 0.1,
      topK: 1,
      ...(civicsSeed() !== undefined ? { seed: civicsSeed() } : {}),
      requestTimeoutMs: ds.llmRequestTimeoutMs,
    });

    // A prompt cut short on input (num_ctx) is not pinned: its answer came
    // from part of the page, and the context window is not in the key —
    // raising it must reach this page, so it runs again next time.
    const pinKey = result.promptTruncated ? null : skipKey;

    const candidate = extractJsonObjectSlice(result.text);
    if (!candidate) {
      // The old line said only "no JSON object" and a character count, which
      // is why this cost a day: it cannot distinguish "the model wrote prose
      // instead of JSON" from "the model was still writing valid JSON when
      // it hit the token ceiling". `finishReason` answers that outright and
      // was already on the result, discarded.
      //
      // Adding `hitTokenCeiling` to the structured fields was not enough:
      // the MESSAGE still said "no JSON object", and that is the part a human
      // reads. It was written up as a "32,000-token runaway producing no
      // JSON" — three descriptions of the ceiling doing its job — and stayed
      // an open mystery for two days. So the message itself now names the
      // cause and the fix.
      const ceilingHit = result.finishReason === 'length';
      this.logger.warn(
        {
          sourceUrl,
          finishReason: result.finishReason,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          maxTokens,
          hitTokenCeiling: ceilingHit,
          // The INPUT side of the same question. Both were already on the
          // result and neither was logged, which is how "the prompt was
          // silently truncated" stays invisible at this exact moment.
          promptTruncated: result.promptTruncated,
          promptTokensEstimated: result.promptTokensEstimated,
          promptChars: promptText.length,
          contentChars: content.length,
          promptVersion,
          promptHash,
          responseChars: result.text.length,
          responseHead: result.text.slice(0, 160),
        },
        ceilingHit
          ? `Civics extraction: output TRUNCATED at the ${maxTokens}-token ` +
              `ceiling for ${sourceUrl} — the model was still writing valid ` +
              `JSON (${result.text.length} chars) when it was cut off. This is ` +
              `a budget problem, not a model or prompt problem: raise ` +
              `llmMaxTokens for this data source.`
          : // NOT "so it must be the prompt". There is a third cause this
            // cannot see from here: a prompt cut on the way IN. With num_ctx
            // unset the model may never reach the JSON-format instructions at
            // the tail of the prompt, answer in prose, and report 'stop' — and
            // #1322's detector misses an overflow this mild, because 16,386
            // tokens read of ~17,937 sent is 91% coverage, well above the 50%
            // threshold. Naming the candidates beats asserting one of them.
            `Civics extraction: no JSON object for ${sourceUrl} — the model ` +
              `stopped on its own (${result.finishReason ?? 'reason unreported'}) ` +
              `without producing one. Not a budget problem. Check, in order: ` +
              `whether the prompt was cut on input (promptTruncated below, and ` +
              `tokensIn vs promptTokensEstimated), then the prompt, then the model.`,
      );
      await this.captureFailedExtraction(sourceUrl, promptText, result.text);
      return 'failed';
    }

    const block = await this.parseBlockWithRepair(
      candidate,
      sourceUrl,
      promptText,
      result,
      promptVersion,
      promptHash,
    );
    if (!block) return 'failed';

    // Ground the measure types against the page before anything persists.
    // Deliberately BEFORE the empty check below: a block whose only types
    // were fabrications becomes empty here, and an empty block is a skip,
    // not a row. See civics-grounding.ts for the measured case this exists
    // for — three real types filed under initialisms the page never uses,
    // plus two invented outright, on one page of one run.
    block.measureTypes = this.groundTypes(
      block.measureTypes,
      content,
      ds,
      sourceUrl,
      promptVersion,
      promptHash,
    );

    // Looked up BEFORE the empty check, not after, which is the fix for
    // #1335. "This page has no civic content" and "this page used to have
    // civic content and now extracts none" are different events, and only
    // the second one is a problem — but they were indistinguishable while
    // the empty check returned before anything knew a row existed.
    const existing = await this.db!.civicsBlock.findUnique({
      where: { regionId_sourceUrl: { regionId, sourceUrl } },
      select: { id: true, promptVersion: true, extractedAt: true },
    });

    // A page the crawler reached under the source's scope but that holds no
    // civic content (e.g. dining services, records-request) extracts to a
    // well-formed but entirely empty block. Persisting it creates a noise
    // CivicsBlock, so skip the upsert entirely. See #874.
    if (isEmptyCivicsExtraction(block)) {
      if (!existing) {
        this.logger.log(
          `Civics extraction: no civic content on ${sourceUrl} — skipping empty block`,
        );
        // Recorded, so an unchanged empty page is not re-extracted every
        // run — 13 of 24 pages in the baseline. The empty-over-existing
        // case below records nothing: that page must retry.
        await this.recordExtraction(regionId, sourceUrl, pinKey, 'empty');
        return 'skipped';
      }

      // An empty extraction over an EXISTING row. The row is kept — serving
      // the last good extraction beats serving nothing — but keeping it
      // silently is what #1335 is about: measured on 2026-10-07, one of
      // twelve California pages sat on prompt v5 while the other eleven were
      // v6, because two later successful syncs passed over it and said
      // nothing. The job reported `succeeded` both times.
      //
      // So this is a `warn`, and it names the drift explicitly: a reader
      // comparing pages otherwise has no signal that one of them is several
      // syncs behind, and the stored promptHash/promptVersion no longer
      // describe what the region is being served elsewhere.
      this.logger.warn(
        {
          sourceUrl,
          storedPromptVersion: existing.promptVersion,
          livePromptVersion: promptVersion,
          storedExtractedAt: existing.extractedAt,
          promptVersionDrifted: existing.promptVersion !== promptVersion,
        },
        `Civics extraction: ${sourceUrl} extracted EMPTY over an existing ` +
          `block, so the previous extraction is being kept. It was stored ` +
          `by prompt ${existing.promptVersion ?? 'unknown'} and the live ` +
          `prompt is ${promptVersion ?? 'unknown'} — this row is now ` +
          `staler than its siblings and its provenance no longer matches.`,
      );
      // Cleared, so the page retries next run even when this was a forced
      // run (`reextract`) whose old record still matches the key.
      await this.db!.civicsPageExtraction.deleteMany({
        where: { regionId, sourceUrl },
      });
      return 'stale';
    }

    const fields = {
      chambers: toJsonField(block.chambers),
      measureTypes: toJsonField(block.measureTypes),
      lifecycleStages: toJsonField(block.lifecycleStages),
      sessionScheme: toJsonField(block.sessionScheme),
      glossary: toJsonField(block.glossary),
    };

    // Through the shared write path (#1281): the attribution columns are
    // assembled in one place. The digest identifies WHICH weights produced
    // the block, because `ollama pull` can move a tag; the two input
    // hashes say what it was produced FROM (K1).
    const data = await this.withProvenance(
      {
        ...fields,
        sourceTextHash,
        configHash,
        sourceVersionId: job.sourceVersionId,
        extractedAt: new Date(),
      },
      { promptHash, promptVersion },
      (p) => ({
        promptHash: p.promptHash,
        promptVersion: p.promptVersion,
        llmModel: p.llmModel,
        llmDigest: p.llmModelDigest,
      }),
    );

    await this.db!.civicsBlock.upsert({
      where: { regionId_sourceUrl: { regionId, sourceUrl } },
      create: { regionId, sourceUrl, ...data },
      update: data,
    });
    // The text the block was extracted from, on the archived bytes it came
    // from (#1306) — what `source_text_hash` is a hash of.
    await this.sourceVersions!.attachDerivedText(job.sourceVersionId, content);

    const glossaryUpserted = await this.upsertGlossaryEntries(
      regionId,
      sourceUrl,
      block.glossary,
      {
        promptHash: data.promptHash,
        promptVersion: data.promptVersion,
        llmModel: data.llmModel,
        llmDigest: data.llmDigest,
      },
    );
    // Last: a key is recorded only once everything it stands for is written.
    await this.recordExtraction(regionId, sourceUrl, pinKey, 'block');

    const outcome = existing ? 'updated' : 'created';
    this.logger.log(
      `Civics extracted from ${sourceUrl} (${outcome}, ${glossaryUpserted} glossary terms)`,
    );
    return outcome;
  }

  /**
   * Upsert per-term glossary entries from a civics page's `glossary[]`
   * payload. Malformed entries (missing term / slug / definition) are
   * dropped with a debug log; valid entries land in `glossary_entries`
   * keyed by `(regionId, slug)`.
   */
  private async upsertGlossaryEntries(
    regionId: string,
    sourceUrl: string,
    glossary: unknown,
    attribution: {
      promptHash: string | undefined;
      promptVersion: string | undefined;
      llmModel: string | null;
      llmDigest: string;
    },
  ): Promise<number> {
    if (!Array.isArray(glossary) || glossary.length === 0) return 0;
    const valid = glossary.filter(
      (
        e,
      ): e is { term: string; slug: string; definition: unknown } & Record<
        string,
        unknown
      > =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as Record<string, unknown>).term === 'string' &&
        typeof (e as Record<string, unknown>).slug === 'string' &&
        !!(e as Record<string, unknown>).definition,
    );
    if (valid.length < glossary.length) {
      this.logger.debug(
        `Glossary upsert: dropped ${glossary.length - valid.length} malformed entries from ${sourceUrl}`,
      );
    }
    const now = new Date();
    await batchTransaction(
      this.db!,
      valid.map((entry) => {
        // Shared fields are identical between create and update — extract
        // once to keep the upsert body deduplicated.
        const shared = {
          term: entry.term,
          definition: entry.definition as Prisma.InputJsonValue,
          longDefinition: toJsonField(entry.longDefinition),
          relatedTerms: Array.isArray(entry.relatedTerms)
            ? (entry.relatedTerms as string[]).filter(
                (t) => typeof t === 'string',
              )
            : [],
          sourceUrl,
          // The block's attribution, model included: a definition could not
          // say which model wrote it (K1 attribution step).
          ...attribution,
          extractedAt: now,
        };
        return this.db!.glossaryEntry.upsert({
          where: { regionId_slug: { regionId, slug: entry.slug } },
          create: { regionId, slug: entry.slug, ...shared },
          update: shared,
        });
      }),
    );

    // Provenance, written AFTER the canonical rows and in its own batch
    // because `glossary_entry_sources` has a foreign key to them — a source
    // row for a term that does not exist yet is rejected, correctly.
    //
    // `glossary_entries` is keyed (regionId, slug) and last-write-wins, so its
    // own `sourceUrl` only ever records the most recent writer. That is why
    // deleting a block cannot be allowed to cascade from it: 23 of 137 terms
    // in the 2026-10-02 California corpus were defined on more than one page.
    // One row per (term, page) here is what lets the cascade be correct.
    await batchTransaction(
      this.db!,
      valid.map((entry) =>
        this.db!.glossaryEntrySource.upsert({
          where: {
            regionId_slug_sourceUrl: { regionId, slug: entry.slug, sourceUrl },
          },
          create: { regionId, slug: entry.slug, sourceUrl, extractedAt: now },
          update: { extractedAt: now },
        }),
      ),
    );

    return valid.length;
  }

  /**
   * Whether this page can be skipped (K1): its last completed extraction had
   * this exact key, and what that extraction produced is still there.
   *
   * An `empty` record needs nothing to exist. A `block` record needs the
   * block: one deleted to force a fresh run, or lost to a restore, must be
   * re-extracted — a skip would leave it gone, and the glossary prune would
   * then retire its terms. The check is stamped on the record, so
   * `checked_at` says when the page was last looked at.
   */
  private async isUnchanged(
    regionId: string,
    sourceUrl: string,
    skipKey: string | null,
  ): Promise<boolean> {
    if (!skipKey) return false;
    const where = { regionId_sourceUrl: { regionId, sourceUrl } };
    const record = await this.db!.civicsPageExtraction.findUnique({
      where,
      select: { skipKey: true, outcome: true },
    });
    if (record?.skipKey !== skipKey) return false;
    if (record.outcome === 'block') {
      const block = await this.db!.civicsBlock.findUnique({
        where,
        select: { id: true },
      });
      if (!block) return false;
    }
    await this.db!.civicsPageExtraction.update({
      where,
      data: { checkedAt: new Date() },
    });
    return true;
  }

  /**
   * Record a completed extraction's skip key (K1). Nothing to record when the
   * key is null — an unresolved model digest — because a null key never
   * skips: that page simply runs every time, as before K1.
   */
  private async recordExtraction(
    regionId: string,
    sourceUrl: string,
    skipKey: string | null,
    outcome: PageExtractionOutcome,
  ): Promise<void> {
    if (!skipKey) return;
    await this.db!.civicsPageExtraction.upsert({
      where: { regionId_sourceUrl: { regionId, sourceUrl } },
      // One clock for every `checked_at`: the skip path stamps it too.
      create: { regionId, sourceUrl, skipKey, outcome, checkedAt: new Date() },
      update: { skipKey, outcome, checkedAt: new Date() },
    });
  }

  /**
   * Retire glossary terms whose defining page is gone.
   *
   * The cascade on `glossary_entry_sources` removes a page's contributions
   * when its `CivicsBlock` is deleted, but "delete the canonical term when its
   * FINAL source disappears" is not expressible as a constraint — so it runs
   * here, explicitly, rather than in a trigger nobody would find.
   *
   * **Keyed on blocks, not on provenance — and that distinction is the whole
   * correctness of this method.** The first version deleted any term with no
   * source rows, which cost 81 glossary entries on the 2026-10-05 run: three
   * pages did not re-extract that run, so their blocks survived from 10-02
   * with no provenance, and their terms were retired as though the pages were
   * gone. A term is only unreachable when NOTHING defines it — no provenance
   * AND no block at the page it came from.
   *
   * That version also carried a guard that was useless by construction: it
   * skipped the prune when a region had zero source rows, but provenance is
   * written earlier in the same run, so by the time this ran there was always
   * some and the guard never fired during the one transition it was meant to
   * cover. The second condition below replaces it properly — a term whose page
   * still has a block is safe whether or not provenance exists yet.
   *
   * Known limitation, deliberately accepted: a term that a still-present page
   * has STOPPED emitting is not retired, because this cannot tell "the page
   * dropped the term" from "the page did not re-extract this run". Catching
   * that needs per-run tracking of which pages were actually visited. Keeping
   * a stale term is the cheaper error — it is visible and overwritable, where
   * deleting a live one is neither.
   */
  private async pruneUnsourcedGlossaryEntries(
    regionId: string,
  ): Promise<number> {
    // `$executeRaw` resolves to a row count in production. Coerced rather
    // than trusted because a mocked DbService resolves to a jest object, and
    // comparing that to a number throws — which is how this broke 12 unit
    // tests that never mocked a method that did not exist when they were
    // written. Nothing is logged unless a real count comes back.
    const rawPruned = await this.db!.$executeRaw`
      DELETE FROM glossary_entries g
      WHERE g.region_id = ${regionId}
        AND NOT EXISTS (
          SELECT 1 FROM glossary_entry_sources s
          WHERE s.region_id = g.region_id AND s.slug = g.slug
        )
        AND NOT EXISTS (
          SELECT 1 FROM civics_blocks c
          WHERE c.region_id = g.region_id AND c.source_url = g.source_url
        )`;
    const pruned = typeof rawPruned === 'number' ? rawPruned : 0;
    if (pruned > 0) {
      this.logger.log(
        `Glossary prune: retired ${pruned} term(s) in ${regionId} with no ` +
          `provenance and no block at their source page`,
      );
    }
    return pruned;
  }
}

/**
 * Module-level helper for civics-block JSONB column writes. Maps
 * `undefined`/`null` to `Prisma.DbNull` (which Prisma needs to clear a
 * JSONB column) and passes anything else through unchanged.
 */
function toJsonField(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined || value === null
    ? Prisma.DbNull
    : (value as Prisma.InputJsonValue);
}

/**
 * True when an extracted civics block carries no civic content at all — every
 * list field empty/absent and no session scheme. The crawler reaches non-civic
 * utility pages under a source's scope (dining services, records requests),
 * and the model faithfully returns an empty shell for them; persisting those
 * as `civics_blocks` rows is pure noise. Callers skip the upsert. See #874.
 */
function isEmptyCivicsExtraction(block: {
  chambers?: unknown;
  measureTypes?: unknown;
  lifecycleStages?: unknown;
  sessionScheme?: unknown;
  glossary?: unknown;
}): boolean {
  const isEmptyList = (v: unknown): boolean =>
    !Array.isArray(v) || v.length === 0;
  const isEmptyScheme =
    block.sessionScheme == null ||
    (typeof block.sessionScheme === 'object' &&
      Object.keys(block.sessionScheme as Record<string, unknown>).length === 0);
  return (
    isEmptyList(block.chambers) &&
    isEmptyList(block.measureTypes) &&
    isEmptyList(block.lifecycleStages) &&
    isEmptyList(block.glossary) &&
    isEmptyScheme
  );
}

/**
 * The `civics-extract` job id for a page: its region + URL, the stage, and
 * the skip key — so a page still in flight collapses onto its job. A forced
 * run gets its own stage, so it never collapses onto an unforced job in
 * flight and inherits that job's `reextract: false`. No key (an unknown
 * digest) → a one-off id that never collapses.
 */
function extractJobId(
  regionId: string,
  sourceUrl: string,
  skipKey: string | null,
  reextract: boolean,
): string {
  if (!skipKey) return `civics-${randomUUID()}`;
  return laneJobId(
    sha256(`${regionId}\n${sourceUrl}`).slice(0, 32),
    reextract ? 'reextract' : 'extract',
    skipKey,
  );
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
