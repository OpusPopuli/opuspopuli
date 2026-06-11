import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { Proposition } from '@opuspopuli/common';
import { PropositionAnalysisService } from './proposition-analysis.service';
import { RegionCacheService } from './region-cache.service';
import { propositionSyncTracker } from './sync-phase-logger';

/**
 * Compiled lifecycle-stage matcher. Each entry maps a region-defined stage
 * id to a regex compiled from `civics_blocks.lifecycle_stages[].statusStringPatterns`.
 *
 * Temporarily duplicated from `region-sync.service.ts` so this service can
 * be extracted without first introducing a shared helper module. The
 * orchestrator builds the array (which requires civics-data access it owns)
 * and passes it in — see #828's stage-helper consolidation follow-up.
 */
export interface StagePattern {
  stageId: string;
  regex: RegExp;
}

/**
 * Minimal contract for the provider this service pulls propositions from.
 * Matches the subset of `RegionProviderService` / `IRegionPlugin` we need
 * here, intentionally narrower than `DataFetcher` so the test surface stays
 * tight and a federal-vs-local swap is just "pass a different provider."
 */
export interface PropositionsProvider {
  getName?(): string;
  fetchPropositions(pipelineJobId?: string): Promise<Proposition[]>;
}

/**
 * Cross-method shape from `upsertByExternalId` — local copy to avoid a
 * runtime dependency on the orchestrator's helper while the extraction
 * is in progress. The orchestrator passes its real `upsertByExternalId`
 * in as a callback so the behavior is identical.
 *
 * The 4th arg (`cachePrefix`) is what tells the orchestrator's helper
 * which cache namespace to invalidate after the batch upsert — for
 * propositions that's `'propositions:'`.
 */
export interface UpsertByExternalId {
  <T extends { externalId: string }>(
    items: T[],
    findExisting: (ids: string[]) => Promise<{ externalId: string }[]>,
    upsert: (items: T[]) => unknown[],
    cachePrefix: string,
  ): Promise<{ processed: number; created: number; updated: number }>;
}

/**
 * Owns the propositions data-type sync. Extracted from
 * `RegionSyncService` as the first bounded-context split toward #828.
 *
 * Public API:
 *   - `sync(provider, pipelineJobId, stagePatterns, upsertByExternalId)` —
 *     orchestrator entry point; the orchestrator owns the data-source +
 *     stage-pattern dependencies and passes them in
 *   - `regenerate(id)` — operator-triggered re-analysis of one proposition
 *
 * Intentional non-goal: this service does NOT build stage patterns or
 * read civics_blocks. Those concerns stay in the orchestrator until the
 * shared stage helper extraction lands as a follow-up. The orchestrator
 * builds the patterns once per sync and passes them in.
 */
@Injectable()
export class PropositionsSyncService {
  private readonly logger = new Logger(PropositionsSyncService.name, {
    timestamp: true,
  });

  constructor(
    private readonly db: DbService,
    @Optional()
    private readonly propositionAnalysis?: PropositionAnalysisService,
    @Optional()
    private readonly cacheService?: RegionCacheService,
  ) {}

  async sync(
    provider: PropositionsProvider,
    pipelineJobId: string | undefined,
    stagePatterns: StagePattern[],
    upsertByExternalId: UpsertByExternalId,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const regionId = provider.getName?.() ?? 'unknown';

    // ─── Phase 1/3 — discover ──────────────────────────────────────
    const discoverTracker = propositionSyncTracker(this.logger, 'discover', 1, {
      region: regionId,
    });
    const propositions = await provider.fetchPropositions(pipelineJobId);
    discoverTracker.item({
      name: 'propositions provider',
      externalId: null,
      outcomeLabel: `${propositions.length} proposition(s) discovered`,
      outcome: 'updated',
    });
    discoverTracker.complete();

    // ─── Phase 2/3 — extract_and_upsert ────────────────────────────
    // Pre-fetch existing externalIds so the per-item line can report
    // accurate created-vs-updated outcomes (and the phase-complete
    // counter matches reality). Without this, every row would log as
    // "updated" even though many are new. Costs one extra findMany
    // per sync — acceptable tradeoff for accurate observability.
    // Skip the pre-fetch entirely when there's nothing to look up.
    const existingPropIds = new Set<string>(
      propositions.length === 0
        ? []
        : (
            await this.db.proposition.findMany({
              where: {
                externalId: { in: propositions.map((p) => p.externalId) },
              },
              select: { externalId: true },
            })
          ).map((p: { externalId: string }) => p.externalId),
    );
    const extractTracker = propositionSyncTracker(
      this.logger,
      'extract_and_upsert',
      propositions.length,
      { region: regionId },
    );
    const result = await upsertByExternalId(
      propositions,
      (ids) =>
        this.db.proposition.findMany({
          where: { externalId: { in: ids } },
          select: { externalId: true },
        }),
      (props): unknown[] =>
        props.map((prop) => {
          const lifecycleStageId = resolveStageFromStatus(
            prop.status,
            stagePatterns,
          );
          const isNew = !existingPropIds.has(prop.externalId);
          const verb = isNew ? 'created' : 'updated';
          const stageDesc = lifecycleStageId
            ? `stage=${lifecycleStageId}`
            : 'stage=unresolved';
          extractTracker.item({
            name: prop.externalId,
            externalId: prop.externalId,
            outcomeLabel: `${verb} (${stageDesc})`,
            outcome: verb,
          });
          return this.db.proposition.upsert({
            where: { externalId: prop.externalId },
            update: {
              title: prop.title,
              summary: prop.summary,
              fullText: prop.fullText,
              status: prop.status,
              electionDate: prop.electionDate,
              sourceUrl: prop.sourceUrl,
              lifecycleStageId,
            },
            create: {
              externalId: prop.externalId,
              title: prop.title,
              summary: prop.summary,
              fullText: prop.fullText,
              status: prop.status,
              electionDate: prop.electionDate,
              sourceUrl: prop.sourceUrl,
              lifecycleStageId,
            },
          });
        }),
      'propositions:',
    );
    extractTracker.complete();

    if (stagePatterns.length > 0) {
      await this.backfillStageIds(stagePatterns);
    }

    // ─── Phase 3/3 — analysis ──────────────────────────────────────
    const analysisTracker = propositionSyncTracker(
      this.logger,
      'analysis',
      this.propositionAnalysis ? 1 : 0,
      { region: regionId },
    );
    if (this.propositionAnalysis) {
      try {
        await this.propositionAnalysis.generateMissing();
        analysisTracker.item({
          name: 'propositionAnalysis.generateMissing',
          externalId: null,
          outcomeLabel: 'analysis pass complete',
          outcome: 'updated',
        });
      } catch (error) {
        analysisTracker.item({
          name: 'propositionAnalysis.generateMissing',
          externalId: null,
          outcomeLabel: `failed: ${(error as Error).message}`,
          outcome: 'error',
        });
        this.logger.warn(
          `Proposition analysis post-sync pass failed: ${(error as Error).message}`,
        );
      }
    }
    analysisTracker.complete();

    return result;
  }

  /**
   * Operator-triggered regenerate of a single proposition's analysis.
   * Called from the public `RegionService.regeneratePropositionAnalysis`
   * resolver path.
   */
  async regenerate(id: string): Promise<boolean> {
    if (!this.propositionAnalysis) return false;
    const result = await this.propositionAnalysis.generate(id, true);
    if (result && this.cacheService) {
      await this.cacheService.invalidateCache('propositions:');
    }
    return result;
  }

  /**
   * Resolve `lifecycleStageId` for propositions ingested before civics
   * patterns were available, or whose status matched no pattern at the
   * time of upsert. Mirrors `backfillBillStageIds`. Idempotent.
   *
   * NOT region-scoped because Proposition has no `regionId` column today.
   * Safe for single-region deployments; needs a Proposition.regionId
   * migration before a second region is added — tracked in #731.
   */
  private async backfillStageIds(stagePatterns: StagePattern[]): Promise<void> {
    const unmatched = await this.db.proposition.findMany({
      where: { lifecycleStageId: null, deletedAt: null },
      select: { id: true, status: true },
    });
    if (unmatched.length === 0) return;

    const byStage = new Map<string, string[]>();
    for (const prop of unmatched) {
      const stageId = resolveStageFromStatus(prop.status, stagePatterns);
      if (!stageId) continue;
      if (!byStage.has(stageId)) byStage.set(stageId, []);
      byStage.get(stageId)!.push(prop.id);
    }

    let filled = 0;
    for (const [stageId, ids] of byStage) {
      await this.db.proposition.updateMany({
        where: { id: { in: ids } },
        data: { lifecycleStageId: stageId },
      });
      filled += ids.length;
    }
    if (filled > 0) {
      this.logger.log(
        `Propositions: backfilled lifecycleStageId for ${filled} of ${unmatched.length} proposition(s)`,
      );
    }
  }
}

/**
 * Module-level pure helper duplicated from RegionSyncService — same
 * 4-line shape, no DB access, no logger. Consolidated into a shared
 * helper module in a follow-up step of #828.
 */
function resolveStageFromStatus(
  status: string | null | undefined,
  stagePatterns: StagePattern[],
): string | null {
  if (!status || stagePatterns.length === 0) return null;
  return stagePatterns.find((p) => p.regex.test(status))?.stageId ?? null;
}
