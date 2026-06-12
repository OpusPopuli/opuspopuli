import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { Meeting, MinutesWithActions } from '@opuspopuli/common';
import { LegislativeActionLinkerService } from './legislative-action-linker.service';
import { meetingSyncTracker, minutesSyncTracker } from './sync-phase-logger';
import type { UpsertByExternalId } from './propositions-sync.service';

/**
 * Minimal contract for the provider this service pulls meetings + minutes
 * from. Matches the subset of `RegionProviderService` / `IRegionPlugin` we
 * need; `fetchMeetingMinutes` is optional because regions onboard meetings
 * before minutes (the minutes-link phase #814 lands later).
 */
export interface MeetingsProvider {
  getName?(): string;
  fetchMeetings(pipelineJobId?: string): Promise<Meeting[]>;
  fetchMeetingMinutes?(): Promise<MinutesWithActions[]>;
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

  constructor(
    private readonly db: DbService,
    @Optional()
    private readonly legislativeActionLinker?: LegislativeActionLinkerService,
  ) {}

  async sync(
    provider: MeetingsProvider,
    pipelineJobId: string | undefined,
    upsertByExternalId: UpsertByExternalId,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const regionId = provider.getName?.() ?? 'unknown';

    // ─── Phase 1/3 — discover ──────────────────────────────────────
    const discoverTracker = meetingSyncTracker(this.logger, 'discover', 1, {
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
      // Skip the empty extract+minutes_link phases for clarity.
      return this.syncMinutes(provider);
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
    const extractTracker = meetingSyncTracker(
      this.logger,
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
          return this.db.meeting.upsert({
            where: { externalId: meeting.externalId },
            update: {
              title: meeting.title,
              body: meeting.body,
              scheduledAt: meeting.scheduledAt,
              location: meeting.location,
              agendaUrl: meeting.agendaUrl,
              videoUrl: meeting.videoUrl,
            },
            create: {
              externalId: meeting.externalId,
              title: meeting.title,
              body: meeting.body,
              scheduledAt: meeting.scheduledAt,
              location: meeting.location,
              agendaUrl: meeting.agendaUrl,
              videoUrl: meeting.videoUrl,
            },
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
    const linkTracker = meetingSyncTracker(this.logger, 'minutes_link', 0, {
      region: regionId,
      note: 'not-yet-implemented',
    });
    linkTracker.complete();

    const minutesResult = await this.syncMinutes(provider);
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
  ): Promise<{ processed: number; created: number; updated: number }> {
    if (!provider.fetchMeetingMinutes) {
      // Emit phase markers even on the early-return path so the
      // operator can distinguish "phase ran and was empty" from
      // "phase never ran." Matches the pattern other syncs use for
      // not-yet-implemented sub-phases.
      const noProvider = minutesSyncTracker(this.logger, 'discover', 0, {
        note: 'provider does not implement fetchMeetingMinutes',
      });
      noProvider.complete();
      const noIngest = minutesSyncTracker(this.logger, 'ingest', 0);
      noIngest.complete();
      const noSummarize = minutesSyncTracker(this.logger, 'summarize', 0);
      noSummarize.complete();
      return { processed: 0, created: 0, updated: 0 };
    }

    // ─── Phase 1/3 — discover ──────────────────────────────────────
    const discoverTracker = minutesSyncTracker(this.logger, 'discover', 1);
    const bundles = await provider.fetchMeetingMinutes();
    discoverTracker.item({
      name: 'minutes provider',
      externalId: null,
      outcomeLabel: `${bundles.length} minutes bundle(s) discovered`,
      outcome: 'updated',
    });
    discoverTracker.complete();

    if (bundles.length === 0) {
      const ingestEmpty = minutesSyncTracker(this.logger, 'ingest', 0);
      ingestEmpty.complete();
      const summarizeEmpty = minutesSyncTracker(this.logger, 'summarize', 0);
      summarizeEmpty.complete();
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
    const ingestTracker = minutesSyncTracker(
      this.logger,
      'ingest',
      bundles.length,
    );
    const upsertedIds: string[] = [];
    for (const { minutes } of bundles) {
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
        },
        select: { id: true },
      });
      upsertedIds.push(row.id);
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

    // ─── Phase 3/3 — summarize ─────────────────────────────────────
    // AI synopsis generation is tracked in #813 and not yet wired —
    // tracker fires as a no-op marker so the operator sees the phase.
    const summarizeTracker = minutesSyncTracker(this.logger, 'summarize', 0, {
      note: 'MinutesSummaryService not yet implemented — see #813',
    });
    summarizeTracker.complete();

    const created = bundles.filter(
      (b) => !existingExternalIds.has(b.minutes.externalId),
    ).length;
    const updated = bundles.filter((b) =>
      existingExternalIds.has(b.minutes.externalId),
    ).length;

    return { processed: bundles.length, created, updated };
  }
}
