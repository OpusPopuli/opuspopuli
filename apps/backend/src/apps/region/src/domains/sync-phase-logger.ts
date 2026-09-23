/**
 * Generic phase-aware observability for data-type syncs.
 *
 * Originally written for bill sync (2026-06-09) — the 2026-06-08
 * diagnosis burned ~30 minutes staring at unlabeled `OllamaLLMProvider`
 * log lines because nothing said "Phase 3 of 6, currently on bill 1234
 * of 2721." Generalized immediately because the same observability gap
 * applies to every data type the region sync touches: representatives,
 * meetings, minutes, propositions, civics, campaign finance.
 *
 * Output format (operator-facing INFO):
 *
 *   [BillSync] Phase 1/6 (discover) starting: 2750 items sources=2
 *   [BillSync] Phase 2/6 [1/2750] AB 1 (202520260AB1): created (LLM)
 *   [BillSync] Phase 2/6 [2/2750] AB 2 (202520260AB2): status-only matched
 *   [BillSync] Phase 2/6 [3/2750] --: skipped: could not extract bill ID
 *   [BillSync] Phase 2/6 (extract_and_upsert) complete: 287 created,
 *                            1942 updated, 521 skipped, 0 errors in 14h23m
 *
 *   [RepSync] Phase 3/5 [12/80] Susan Smith (ca-assembly-12): bio generated
 *   [MeetingSync] Phase 2/3 [5/36] Joint Legislative Audit
 *                            (assembly-...-2026-08-11): updated
 *
 * Same format spec across all data types — operator memorizes one shape
 * and reads any sync interpretably from `docker logs`.
 *
 * Each data type ships its own phase list as a const tuple plus a typed
 * factory function. Call sites use the factory:
 *
 *     const tracker = billSyncTracker(this.logger, 'extract_and_upsert', 2750);
 *
 * The phase name is checked against the data type's phase list at
 * compile time — passing 'analysis' (a proposition phase) to the bill
 * tracker is a TypeScript error.
 */

import type { Logger } from '@nestjs/common';

// ─── Phase lists per data type ──────────────────────────────────────

export const BILL_SYNC_PHASES = [
  'discover',
  'extract_and_upsert',
  'votes_only',
  'stage_backfill',
  'prune_stale',
  'summarize',
] as const;
export type BillSyncPhase = (typeof BILL_SYNC_PHASES)[number];

export const REP_SYNC_PHASES = [
  'discover',
  'extract_and_upsert',
  'detail_crawl',
  'bio_generation',
  'prune_stale',
] as const;
export type RepSyncPhase = (typeof REP_SYNC_PHASES)[number];

export const MEETING_SYNC_PHASES = [
  'discover',
  'extract_and_upsert',
  'minutes_link',
] as const;
export type MeetingSyncPhase = (typeof MEETING_SYNC_PHASES)[number];

export const MINUTES_SYNC_PHASES = ['discover', 'ingest', 'summarize'] as const;
export type MinutesSyncPhase = (typeof MINUTES_SYNC_PHASES)[number];

export const PROPOSITION_SYNC_PHASES = [
  'discover',
  'extract_and_upsert',
  'analysis',
] as const;
export type PropositionSyncPhase = (typeof PROPOSITION_SYNC_PHASES)[number];

export const CIVICS_SYNC_PHASES = ['discover', 'extract_and_upsert'] as const;
export type CivicsSyncPhase = (typeof CIVICS_SYNC_PHASES)[number];

export const CAMPAIGN_FINANCE_SYNC_PHASES = [
  'discover',
  'extract_and_upsert',
] as const;
export type CampaignFinanceSyncPhase =
  (typeof CAMPAIGN_FINANCE_SYNC_PHASES)[number];

// ─── Tracker ───────────────────────────────────────────────────────

/**
 * How many items may fail back-to-back before the phase gives up.
 *
 * CONSECUTIVE, not cumulative, and a single success resets it. A long sync
 * legitimately hits scattered failures — a dead URL, one malformed record —
 * and aborting on a cumulative count would stop healthy runs. Five in a row is
 * a different claim: the run itself is broken, not an item.
 */
const DEFAULT_CONSECUTIVE_FAILURE_LIMIT = 5;

function consecutiveFailureLimit(): number {
  const raw = process.env.SYNC_CONSECUTIVE_FAILURE_LIMIT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CONSECUTIVE_FAILURE_LIMIT;
}

/**
 * Thrown when a phase abandons a run that is failing every item.
 *
 * Thrown rather than returned on purpose: the phase runs inside the
 * processor's try/catch, which marks the `pipeline_jobs` row failed with this
 * message. Returning instead would let the run end as "completed with 24
 * errors", which reads like success in every summary that counts it.
 *
 * On 2026-09-22 a civics sync failed item 1 of 24 after 24.5 minutes and kept
 * going — about ten hours to produce nothing, with nothing noticing that the
 * failure rate was 100%.
 */
export class SyncAbortedError extends Error {
  constructor(
    readonly tag: string,
    readonly consecutiveFailures: number,
    readonly itemsAttempted: number,
    readonly lastFailure: string,
  ) {
    super(
      `[${tag}] Aborted after ${consecutiveFailures} consecutive failures ` +
        `(${itemsAttempted} item(s) attempted). This run is not producing ` +
        `results; the last failure was: ${lastFailure}`,
    );
    this.name = "SyncAbortedError";
  }
}

/**
 * Encapsulated counters for one phase of one data type sync.
 *
 * Aggregating counts in the tracker instead of at each call site means
 * the per-item log line and the phase-complete summary always agree —
 * no risk of the orchestrator forgetting to bump a counter and the
 * summary line lying about totals.
 *
 * Generic over the phase string-literal type so each data type's
 * factory function provides compile-time-checked phase names.
 */
export class SyncPhaseTracker<Phase extends string> {
  private current = 0;
  private created = 0;
  private updated = 0;
  private skipped = 0;
  private errors = 0;
  /** Reset by any created/updated item; see {@link SyncAbortedError}. */
  private consecutiveFailures = 0;
  private lastFailure = '(none)';
  private readonly failureLimit = consecutiveFailureLimit();
  private readonly extras = new Map<string, number>();
  private readonly startedAtMs: number;
  private readonly phaseIdx: number;
  private readonly phaseTotal: number;

  constructor(
    private readonly logger: Logger,
    private readonly tag: string,
    private readonly phases: readonly Phase[],
    private readonly phase: Phase,
    private readonly total: number,
    summaryArgs?: Record<string, string | number>,
  ) {
    this.startedAtMs = Date.now();
    this.phaseTotal = phases.length;
    this.phaseIdx = phases.indexOf(phase) + 1;
    if (this.phaseIdx === 0) {
      throw new Error(
        `[${tag}] Phase "${String(phase)}" not in phases list: ${phases.join(', ')}`,
      );
    }
    const argSuffix = summaryArgs
      ? ' ' +
        Object.entries(summaryArgs)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
      : '';
    this.logger.log(
      `[${this.tag}] Phase ${this.phaseIdx}/${this.phaseTotal} (${String(phase)}) starting: ${total} items${argSuffix}`,
    );
  }

  /**
   * Log a single item's outcome and bump the matching counter.
   *
   * `outcomeLabel` is the operator-facing string ("created (LLM)",
   * "status-only matched", "skipped: schema drift"). Pass verbatim;
   * the tracker does not interpret it. `outcome` is the structured
   * counter the item rolls into.
   */
  item(args: {
    name: string | null;
    externalId: string | null;
    outcomeLabel: string;
    outcome: 'created' | 'updated' | 'skipped' | 'error';
    extraCounters?: string[];
  }): void {
    this.current++;
    const idSlot = this.formatIdSlot(args.name, args.externalId);
    this.logger.log(
      `[${this.tag}] Phase ${this.phaseIdx}/${this.phaseTotal} [${this.current}/${this.total}] ${idSlot}: ${args.outcomeLabel}`,
    );
    if (args.outcome === 'created') this.created++;
    else if (args.outcome === 'updated') this.updated++;
    else if (args.outcome === 'skipped') this.skipped++;
    else this.errors++;
    for (const extra of args.extraCounters ?? []) {
      this.extras.set(extra, (this.extras.get(extra) ?? 0) + 1);
    }

    if (args.outcome === 'error') {
      this.recordFailure(args.outcomeLabel);
    } else {
      // ANY non-error outcome clears the counter, `skipped` included. A skip
      // means the item was handled and needed no work — the pipeline
      // functioning, not failing. Treating it as neutral instead let errors
      // separated by hundreds of skips accumulate into an abort, which on the
      // bills sync (5,019 rows, most of them unchanged and therefore skipped)
      // would stop a perfectly healthy run.
      this.consecutiveFailures = 0;
    }
  }

  /**
   * Count a failure and abandon the phase if they are running back-to-back.
   */
  private recordFailure(label: string): void {
    this.consecutiveFailures++;
    this.lastFailure = label;
    if (this.consecutiveFailures >= this.failureLimit) {
      throw new SyncAbortedError(
        this.tag,
        this.consecutiveFailures,
        this.current,
        this.lastFailure,
      );
    }
  }

  /**
   * Log a degenerate item we couldn't identify — URLs that don't yield
   * an external ID, vote pages with no matching shell, etc. Counts as
   * skipped; does not bump created/updated/error totals.
   */
  itemUnknown(reason: string, externalIdHint?: string | null): void {
    this.current++;
    const idSlot = this.formatIdSlot(null, externalIdHint ?? null);
    this.logger.log(
      `[${this.tag}] Phase ${this.phaseIdx}/${this.phaseTotal} [${this.current}/${this.total}] ${idSlot}: skipped: ${reason}`,
    );
    this.skipped++;
    // Same reasoning as a `skipped` item above: this is a handled item, so it
    // clears the consecutive-failure counter rather than sitting neutral.
    this.consecutiveFailures = 0;
  }

  /**
   * Mid-phase aggregate line that doesn't itself bump the per-item
   * counter. Useful for per-source announcements inside a phase
   * (e.g., "source 1/2: 1234 bills" before the per-item loop starts).
   */
  note(message: string): void {
    this.logger.log(
      `[${this.tag}] Phase ${this.phaseIdx}/${this.phaseTotal} (${String(this.phase)}): ${message}`,
    );
  }

  /**
   * Emit the phase-complete summary and return totals so callers can
   * roll into a sync-wide tally if needed.
   */
  complete(): {
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    durationMs: number;
    extras: Record<string, number>;
  } {
    const durationMs = Date.now() - this.startedAtMs;
    const extrasSuffix =
      this.extras.size > 0
        ? ', ' +
          Array.from(this.extras.entries())
            .map(([k, v]) => `${v} ${k}`)
            .join(', ')
        : '';
    this.logger.log(
      `[${this.tag}] Phase ${this.phaseIdx}/${this.phaseTotal} (${String(this.phase)}) complete: ` +
        `${this.created} created, ${this.updated} updated, ` +
        `${this.skipped} skipped, ${this.errors} errors${extrasSuffix} ` +
        `in ${formatDuration(durationMs)}`,
    );
    return {
      created: this.created,
      updated: this.updated,
      skipped: this.skipped,
      errors: this.errors,
      durationMs,
      extras: Object.fromEntries(this.extras),
    };
  }

  private formatIdSlot(name: string | null, externalId: string | null): string {
    if (name && externalId) return `${name} (${externalId})`;
    if (externalId) return `-- (${externalId})`;
    return '--';
  }
}

// ─── Per-data-type factories ───────────────────────────────────────
//
// Wrap the generic constructor so call sites don't have to thread the
// tag string + phase list. The phase argument is statically-typed per
// data type — `billSyncTracker(logger, 'analysis', ...)` is a TS error
// because 'analysis' is a proposition phase, not a bill phase.

export function billSyncTracker(
  logger: Logger,
  phase: BillSyncPhase,
  total: number,
  summaryArgs?: Record<string, string | number>,
): SyncPhaseTracker<BillSyncPhase> {
  return new SyncPhaseTracker(
    logger,
    'BillSync',
    BILL_SYNC_PHASES,
    phase,
    total,
    summaryArgs,
  );
}

export function repSyncTracker(
  logger: Logger,
  phase: RepSyncPhase,
  total: number,
  summaryArgs?: Record<string, string | number>,
): SyncPhaseTracker<RepSyncPhase> {
  return new SyncPhaseTracker(
    logger,
    'RepSync',
    REP_SYNC_PHASES,
    phase,
    total,
    summaryArgs,
  );
}

export function meetingSyncTracker(
  logger: Logger,
  phase: MeetingSyncPhase,
  total: number,
  summaryArgs?: Record<string, string | number>,
): SyncPhaseTracker<MeetingSyncPhase> {
  return new SyncPhaseTracker(
    logger,
    'MeetingSync',
    MEETING_SYNC_PHASES,
    phase,
    total,
    summaryArgs,
  );
}

export function minutesSyncTracker(
  logger: Logger,
  phase: MinutesSyncPhase,
  total: number,
  summaryArgs?: Record<string, string | number>,
): SyncPhaseTracker<MinutesSyncPhase> {
  return new SyncPhaseTracker(
    logger,
    'MinutesSync',
    MINUTES_SYNC_PHASES,
    phase,
    total,
    summaryArgs,
  );
}

export function propositionSyncTracker(
  logger: Logger,
  phase: PropositionSyncPhase,
  total: number,
  summaryArgs?: Record<string, string | number>,
): SyncPhaseTracker<PropositionSyncPhase> {
  return new SyncPhaseTracker(
    logger,
    'PropositionSync',
    PROPOSITION_SYNC_PHASES,
    phase,
    total,
    summaryArgs,
  );
}

export function civicsSyncTracker(
  logger: Logger,
  phase: CivicsSyncPhase,
  total: number,
  summaryArgs?: Record<string, string | number>,
): SyncPhaseTracker<CivicsSyncPhase> {
  return new SyncPhaseTracker(
    logger,
    'CivicsSync',
    CIVICS_SYNC_PHASES,
    phase,
    total,
    summaryArgs,
  );
}

export function campaignFinanceSyncTracker(
  logger: Logger,
  phase: CampaignFinanceSyncPhase,
  total: number,
  summaryArgs?: Record<string, string | number>,
): SyncPhaseTracker<CampaignFinanceSyncPhase> {
  return new SyncPhaseTracker(
    logger,
    'CampaignFinanceSync',
    CAMPAIGN_FINANCE_SYNC_PHASES,
    phase,
    total,
    summaryArgs,
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Format a millisecond duration as the shortest readable form.
 *
 *   <1s    → "843ms"
 *   <60s   → "23.4s"
 *   <60m   → "14m23s"
 *   else   → "14h23m"
 *
 * Sync phases range from sub-second (discover) to ~15h (the LLM hot
 * path), so we need representable units across that range without
 * leading zeros or scientific notation tripping up grep workflows.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (ms < 60_000) return `${s}s`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (ms < 3_600_000) return `${minutes}m${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return `${hours}h${remainderMinutes}m`;
}

/**
 * Exposed only for unit tests of the formatter — not for runtime
 * callers. Kept in this file rather than a separate utility so the
 * format choices live with the consumer that decided them.
 */
export const __testing = { formatDuration };
