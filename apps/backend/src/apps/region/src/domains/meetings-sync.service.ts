import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { METRICS_OBSERVER, type MetricsObserver } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type {
  ArchiveIngestOptions,
  Meeting,
  Minutes,
  MinutesWithActions,
} from '@opuspopuli/common';
import {
  MINUTES_SUMMARY_QUEUE,
  QueueService,
  type MinutesSummaryJobData,
} from '@opuspopuli/queue-provider';
import { LegislativeActionLinkerService } from './legislative-action-linker.service';
import { meetingSyncTracker, minutesSyncTracker } from './sync-phase-logger';
import type { UpsertByExternalId } from './propositions-sync.service';
import { rowProvenance, type RowProvenanceColumns } from './row-provenance';
import { SourceVersionService } from './source-version.service';
import { MinutesSummaryService } from './minutes-summary.service';
import { outputJobId, type OutputTarget } from './output-lane';

/**
 * A meeting's attribution columns (meetings-phase-b.md §3): the run and
 * manifest that produced it (#1280) and the page it came from. Explicit nulls,
 * as in {@link rowProvenance}, so a row rewritten by an untracked run does not
 * keep pointing at the last tracked one.
 *
 * No `sourceVersionId`: meetings come from list pages, which are not archived,
 * and the table has no column for one.
 */
export function meetingAttribution(meeting: Meeting): Omit<
  RowProvenanceColumns,
  'sourceVersionId'
> & {
  sourceUrl: string | null;
} {
  const { pipelineExecutionId, manifestId, manifestVersion } =
    rowProvenance(meeting);
  return {
    pipelineExecutionId,
    manifestId,
    manifestVersion,
    sourceUrl: meeting.sourceUrl ?? null,
  };
}

/**
 * Minimal contract for the provider this service pulls meetings + minutes
 * from. Matches the subset of `RegionProviderService` / `IRegionPlugin` we
 * need; `fetchMeetingMinutes` is optional because regions onboard meetings
 * before minutes (the minutes-link phase #814 lands later).
 */
export interface MeetingsProvider {
  getName?(): string;
  fetchMeetings(pipelineJobId?: string): Promise<Meeting[]>;
  fetchMeetingMinutes?(
    options?: ArchiveIngestOptions,
  ): Promise<MinutesWithActions[]>;
}

/**
 * Owns the meetings + minutes data-type sync. Extracted from
 * RegionSyncService as #828 Step 2.
 *
 * Public surface:
 *   - `sync(provider, jobId, upsertByExternalId)` — orchestrator entry;
 *     handles discover → extract_and_upsert (meetings) → minutes_link
 *     (no-op placeholder for #814) → discover/ingest/summarize (minutes)
 *
 * No stage taxonomy dependency — meetings have no lifecycle stages
 * (cleaner extraction than propositions; no shared-helper coupling).
 */
@Injectable()
export class MeetingsSyncService {
  private readonly logger = new Logger(MeetingsSyncService.name, {
    timestamp: true,
  });

  /**
   * One place where the metrics observer reaches a tracker, rather than a
   * fifth argument on each call below. `Parameters<typeof meetingSyncTracker>`
   * keeps the compile-time phase check — passing another data type's phase
   * name is still a type error.
   */
  private meetingTracker(
    phase: Parameters<typeof meetingSyncTracker>[1],
    total: number,
    summaryArgs?: Record<string, string | number>,
  ): ReturnType<typeof meetingSyncTracker> {
    return meetingSyncTracker(
      this.logger,
      phase,
      total,
      summaryArgs,
      this.metrics,
    );
  }

  /**
   * One place where the metrics observer reaches a tracker, rather than a
   * fifth argument on each call below. `Parameters<typeof minutesSyncTracker>`
   * keeps the compile-time phase check — passing another data type's phase
   * name is still a type error.
   */
  private minutesTracker(
    phase: Parameters<typeof minutesSyncTracker>[1],
    total: number,
    summaryArgs?: Record<string, string | number>,
  ): ReturnType<typeof minutesSyncTracker> {
    return minutesSyncTracker(
      this.logger,
      phase,
      total,
      summaryArgs,
      this.metrics,
    );
  }

  constructor(
    private readonly db: DbService,
    @Optional()
    private readonly legislativeActionLinker?: LegislativeActionLinkerService,
    @Optional()
    private readonly queueService?: QueueService,
    @Optional()
    private readonly sourceVersions?: SourceVersionService,
    /**
     * Where item outcomes go (M1, `docs/plans/ingestion-resource-lanes.md`
     * §2). Optional and last: several specs construct this service by hand,
     * and a sync must run identically with no metrics bound.
     */
    @Optional()
    @Inject(METRICS_OBSERVER)
    private readonly metrics?: MetricsObserver,
    /**
     * Picks which summaries are stale, and their skip keys (meetings-phase-b.md
     * §3). Unbound, every upserted row is queued under a one-off id and the
     * job decides.
     */
    @Optional()
    private readonly minutesSummary?: MinutesSummaryService,
  ) {}

  async sync(
    provider: MeetingsProvider,
    pipelineJobId: string | undefined,
    upsertByExternalId: UpsertByExternalId,
    options?: ArchiveIngestOptions,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const regionId = provider.getName?.() ?? 'unknown';

    // ─── Phase 1/3 — discover ──────────────────────────────────────
    const discoverTracker = this.meetingTracker('discover', 1, {
      region: regionId,
    });
    const meetings = await provider.fetchMeetings(pipelineJobId);
    discoverTracker.item({
      name: 'meetings provider',
      externalId: null,
      outcomeLabel: `${meetings.length} meeting(s) discovered`,
      outcome: 'updated',
    });
    discoverTracker.complete();

    if (meetings.length === 0) {
      // A zero result can be legitimate (recess) OR a degraded extraction. A
      // silent skip previously masked stale-manifest zero-yield (#911), so make
      // it visible. The pipeline now self-heals a stale manifest in-run, so a
      // persistent zero here points at the source itself, not a stale cache.
      this.logger.warn(
        `No meetings extracted for ${regionId} — if this source normally lists ` +
          `meetings, check source/extraction health (see #911). Proceeding to minutes.`,
      );
      // Skip the empty extract+minutes_link phases for clarity.
      return this.syncMinutes(provider, options);
    }

    // ─── Phase 2/3 — extract_and_upsert ────────────────────────────
    // Pre-fetch existing externalIds so the per-item line can report
    // accurate created-vs-updated outcomes. Skip when there's nothing
    // to look up.
    const existingMeetingIds = new Set<string>(
      meetings.length === 0
        ? []
        : (
            await this.db.meeting.findMany({
              where: { externalId: { in: meetings.map((m) => m.externalId) } },
              select: { externalId: true },
            })
          ).map((m: { externalId: string }) => m.externalId),
    );
    const extractTracker = this.meetingTracker(
      'extract_and_upsert',
      meetings.length,
      { region: regionId },
    );
    const result = await upsertByExternalId(
      meetings,
      (ids) =>
        this.db.meeting.findMany({
          where: { externalId: { in: ids } },
          select: { externalId: true },
        }),
      (items): unknown[] =>
        items.map((meeting) => {
          const isNew = !existingMeetingIds.has(meeting.externalId);
          extractTracker.item({
            name: meeting.title,
            externalId: meeting.externalId,
            outcomeLabel: isNew ? 'created' : 'updated',
            outcome: isNew ? 'created' : 'updated',
          });
          const fields = {
            title: meeting.title,
            body: meeting.body,
            scheduledAt: meeting.scheduledAt,
            location: meeting.location,
            agendaUrl: meeting.agendaUrl,
            videoUrl: meeting.videoUrl,
            ...meetingAttribution(meeting),
          };
          return this.db.meeting.upsert({
            where: { externalId: meeting.externalId },
            update: fields,
            create: { externalId: meeting.externalId, ...fields },
          });
        }),
      'meetings:',
    );
    extractTracker.complete();

    // ─── Phase 3/3 — minutes_link ──────────────────────────────────
    // minutes_link is a future phase (#814) that ties minutes rows to
    // their parent meeting via (body, date). Until that lands, this
    // tracker fires as a no-op marker so the operator sees the phase
    // even if it does nothing — and so dashboards / log queries that
    // expect all 3 phases stay correct.
    const linkTracker = this.meetingTracker('minutes_link', 0, {
      region: regionId,
      note: 'not-yet-implemented',
    });
    linkTracker.complete();

    const minutesResult = await this.syncMinutes(provider, options);
    return {
      processed: result.processed + minutesResult.processed,
      created: result.created + minutesResult.created,
      updated: result.updated + minutesResult.updated,
    };
  }

  /**
   * Ingest minutes bundles from the provider. Runs as a sub-phase of the
   * meetings sync so the operator sees a unified view of the meetings
   * lifecycle. Tracker phases: discover → ingest → summarize.
   *
   * The summarize phase is a marker until #813 (MinutesSummaryService)
   * lands; the discover/ingest phases are the real work.
   */
  private async syncMinutes(
    provider: MeetingsProvider,
    options?: ArchiveIngestOptions,
  ): Promise<{ processed: number; created: number; updated: number }> {
    if (!provider.fetchMeetingMinutes) {
      // Emit phase markers even on the early-return path so the
      // operator can distinguish "phase ran and was empty" from
      // "phase never ran." Matches the pattern other syncs use for
      // not-yet-implemented sub-phases.
      const noProvider = this.minutesTracker('discover', 0, {
        note: 'provider does not implement fetchMeetingMinutes',
      });
      noProvider.complete();
      const noIngest = this.minutesTracker('ingest', 0);
      noIngest.complete();
      const noSummarize = this.minutesTracker('summarize', 0);
      noSummarize.complete();
      return { processed: 0, created: 0, updated: 0 };
    }

    // ─── Phase 1/3 — discover ──────────────────────────────────────
    const discoverTracker = this.minutesTracker('discover', 1);
    const bundles = await provider.fetchMeetingMinutes(options);
    discoverTracker.item({
      name: 'minutes provider',
      externalId: null,
      outcomeLabel: `${bundles.length} minutes bundle(s) discovered`,
      outcome: 'updated',
    });
    discoverTracker.complete();

    if (bundles.length === 0) {
      const ingestEmpty = this.minutesTracker('ingest', 0);
      ingestEmpty.complete();
      // Still summarize: no new PDFs is the usual sync, and a summary goes
      // stale by a prompt or model change, not only by new text.
      await this.summarizePhase([]);
      return { processed: 0, created: 0, updated: 0 };
    }

    const externalIds = bundles.map((b) => b.minutes.externalId);
    const existingRecords = await this.db.minutes.findMany({
      where: { externalId: { in: externalIds } },
      select: { externalId: true },
    });
    const existingExternalIds = new Set(
      existingRecords.map((r: { externalId: string }) => r.externalId),
    );

    // ─── Phase 2/3 — ingest ────────────────────────────────────────
    const ingestTracker = this.minutesTracker('ingest', bundles.length);
    const upsertedIds: string[] = [];
    for (const bundle of bundles) {
      // Provenance rides on the bundle, not the inner minutes: items are
      // stamped uniformly at the top level as they leave the pipeline (#1280).
      //
      // `sourceVersionId` is the exception and rides on the minutes, because
      // it identifies the individual PDF this document was parsed from rather
      // than the run that fetched them all (#1306).
      const { minutes } = bundle;
      const provenance = rowProvenance({
        ...bundle,
        sourceVersionId: minutes.sourceVersionId,
      });
      const wasExisting = existingExternalIds.has(minutes.externalId);
      const row = await this.db.minutes.upsert({
        where: { externalId: minutes.externalId },
        update: {
          body: minutes.body,
          date: minutes.date,
          revisionSeq: minutes.revisionSeq,
          isActive: true,
          pageCount: minutes.pageCount,
          sourceUrl: minutes.sourceUrl,
          rawText: minutes.rawText,
          parsedAt: minutes.parsedAt ?? new Date(),
          ...provenance,
        },
        create: {
          externalId: minutes.externalId,
          body: minutes.body,
          date: minutes.date,
          revisionSeq: minutes.revisionSeq,
          isActive: true,
          pageCount: minutes.pageCount,
          sourceUrl: minutes.sourceUrl,
          rawText: minutes.rawText,
          parsedAt: minutes.parsedAt ?? new Date(),
          ...provenance,
        },
        select: { id: true },
      });
      upsertedIds.push(row.id);
      // The TRUNCATED text, which is what `raw_text` holds and therefore what
      // `Evidence.spanStart`/`spanEnd` index into (#1306). Recording the full
      // pdf-parse output instead would give every citation past the 256 kB
      // cut offsets into a string the database never had.
      await this.recordDerivation(minutes);
      ingestTracker.item({
        name: `${minutes.body} ${minutes.date.toISOString().slice(0, 10)}`,
        externalId: minutes.externalId,
        outcomeLabel: wasExisting
          ? `updated (rev=${minutes.revisionSeq})`
          : `created (${minutes.rawText?.length ?? 0} chars)`,
        outcome: wasExisting ? 'updated' : 'created',
      });

      if (minutes.revisionSeq > 0) {
        await this.db.minutes.updateMany({
          where: {
            body: minutes.body,
            date: minutes.date,
            revisionSeq: { lt: minutes.revisionSeq },
          },
          data: { isActive: false },
        });
      }
    }
    ingestTracker.complete();

    if (upsertedIds.length > 0 && this.legislativeActionLinker) {
      await this.legislativeActionLinker.linkMinutes(upsertedIds);
    }

    await this.summarizePhase(upsertedIds);

    const created = bundles.filter(
      (b) => !existingExternalIds.has(b.minutes.externalId),
    ).length;
    const updated = bundles.filter((b) =>
      existingExternalIds.has(b.minutes.externalId),
    ).length;

    return { processed: bundles.length, created, updated };
  }

  /**
   * Operator backfill (#813): enqueue force-summary jobs for existing minutes
   * rows (optionally filtered by chamber `body`, capped by `limit`). Returns
   * the number enqueued. Used by the regenerateMinutesSummaries mutation to
   * (re)generate synopses for already-ingested rows and after prompt tweaks.
   */
  async regenerateSummaries(body?: string, limit?: number): Promise<number> {
    const where = {
      isActive: true,
      rawText: { not: null },
      ...(body ? { body } : {}),
    };
    const rows = await this.db.minutes.findMany({
      where,
      select: { id: true },
      orderBy: { date: 'desc' },
      take: limit && limit > 0 ? limit : undefined,
    });
    return this.enqueueSummaries(
      rows.map((r) => ({ id: r.id, key: null })),
      true,
    );
  }

  /**
   * Store a minutes document's `rawText` against the archived PDF it was
   * parsed from (#1306).
   *
   * Best-effort, like archiving itself: a failure here costs the claims on
   * one document their traceability, where a throw would cost the sync every
   * document after it.
   */
  private async recordDerivation(minutes: Minutes): Promise<void> {
    if (!this.sourceVersions || !minutes.sourceVersionId || !minutes.rawText) {
      return;
    }
    try {
      await this.sourceVersions.attachDerivedText(
        minutes.sourceVersionId,
        minutes.rawText,
      );
    } catch (error) {
      this.logger.warn(
        `Could not record the derivation for ${minutes.externalId}: ` +
          `${(error as Error).message}`,
      );
    }
  }

  /**
   * Enqueue a minutes-summary job per target (#813), under its skip-key job id
   * (a one-off id when the key is unknown). Returns the number enqueued; 0
   * when no QueueService is wired (unit tests, a region service without the
   * worker stack).
   */
  private async enqueueSummaries(
    targets: readonly OutputTarget[],
    force = false,
  ): Promise<number> {
    if (!this.queueService || targets.length === 0) return 0;
    let enqueued = 0;
    for (const target of targets) {
      try {
        // force always gets a one-off id, so an operator re-run is never
        // deduped against a retained job. It can therefore run beside a keyed
        // job for the same row: two calls, the last write wins. An operator
        // action, so accepted rather than coordinated.
        await this.queueService.enqueue<MinutesSummaryJobData>(
          MINUTES_SUMMARY_QUEUE,
          { minutesId: target.id, force },
          {
            jobId: outputJobId(
              force ? { id: target.id, key: null } : target,
              'minutes-summary',
            ),
            // The key collapses only work still in flight. Retained, a job
            // that reported `failed` kept its id for a week and BullMQ
            // dropped every retry as a duplicate (UAT, 2026-10-31). Currency
            // is the row's to say, not the queue's history.
            removeOnFinish: true,
          },
        );
        enqueued++;
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue minutes-summary for ${target.id}: ${(err as Error).message}`,
        );
      }
    }
    return enqueued;
  }

  /**
   * Phase 3/3 — summarize. Enqueue an async AI-synopsis job per stale minutes
   * row (#813), kept out of the ingest path so the sync stays fast. The job id
   * is the skip key (meetings-phase-b.md §3): a repeat sync collapses onto the
   * same job, and a new prompt or model mints a new one. The bare row id it
   * replaced collided with the completed job BullMQ retains for a week, so a
   * prompt change inside that week regenerated nothing.
   */
  private async summarizePhase(upsertedIds: readonly string[]): Promise<void> {
    const enqueued = await this.enqueueSummaries(
      await this.staleSummaries(upsertedIds),
    );
    this.minutesTracker('summarize', enqueued).complete();
  }

  /**
   * Every active row whose summary is stale. With no summarizer bound, or one
   * missing its LLM or prompt client, the rows this sync wrote, under one-off
   * ids, and the job decides.
   */
  private async staleSummaries(
    upsertedIds: readonly string[],
  ): Promise<OutputTarget[]> {
    let stale: Awaited<ReturnType<MinutesSummaryService['selectStale']>>;
    try {
      stale = await this.minutesSummary?.selectStale();
    } catch (error) {
      // The meetings and minutes rows are written; a failed read of summary
      // currency must not fail the sync. Fall back to the rows this sync
      // wrote, under one-off ids — each job re-checks currency, so this costs
      // at most a check per row, and new minutes are not left until tomorrow.
      this.logger.warn(
        `minutes-summary selection failed (queueing this sync's rows): ${(error as Error).message}`,
      );
      return upsertedIds.map((id) => ({ id, key: null }));
    }
    return stale ? stale.pending : upsertedIds.map((id) => ({ id, key: null }));
  }
}
