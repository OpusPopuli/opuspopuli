import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { Proposition } from '@opuspopuli/common';
import { PropositionAnalysisService } from './proposition-analysis.service';
import { PropositionEmbeddingService } from './proposition-embedding.service';
import { RegionCacheService } from './region-cache.service';
import { propositionSyncTracker } from './sync-phase-logger';
import {
  detectSummaryEcho,
  extractLegislativeDigest,
} from '@opuspopuli/scraping-pipeline';

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
    @Optional()
    private readonly propositionEmbedding?: PropositionEmbeddingService,
  ) {}

  /**
   * @param regionPluginName - the jurisdiction these rows belong to. Half of
   *   the proposition upsert key (#1164), so it must be definite. The
   *   orchestrator passes the plugin it is syncing; falls back to the
   *   provider's own name when it can give one.
   */
  async sync(
    provider: PropositionsProvider,
    pipelineJobId: string | undefined,
    stagePatterns: StagePattern[],
    upsertByExternalId: UpsertByExternalId,
    regionPluginName?: string,
  ): Promise<{ processed: number; created: number; updated: number }> {
    // The jurisdiction is half of the upsert key (#1164), so it must be
    // known before anything is written. An unnamed provider previously fell
    // back to the DB default 'california' — for a county sync that is exactly
    // the wrong label, and under the compound key it would collide county
    // measures with statewide ones. DeclarativeRegionPlugin.getName() always
    // returns its regionId, so an absent name means something is broken:
    // fail before writing rather than mislabel civic data.
    const pluginName = regionPluginName ?? provider.getName?.();
    if (!pluginName) {
      throw new Error(
        'Propositions sync requires a named region plugin — ' +
          'no jurisdiction was supplied and the provider could not name itself, ' +
          'so rows cannot be attributed',
      );
    }
    const regionId = pluginName;

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
                regionPluginName: pluginName,
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
          // Jurisdiction-scoped: another county owning the same measure
          // letter must not make this one report as an update.
          where: { regionPluginName: pluginName, externalId: { in: ids } },
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
            // Keyed on (jurisdiction, externalId) so a county measure can
            // never match — and overwrite — another jurisdiction's row.
            where: {
              regionPluginName_externalId: {
                regionPluginName: pluginName,
                externalId: prop.externalId,
              },
            },
            update: {
              title: prop.title,
              // `summary` is NOT NULL with no database default, so the write
              // must always supply a string (#1219).
              //
              // Until #1252 the domain schema guaranteed one by backfilling
              // the title into an empty summary — which was itself the defect
              // that issue removed, because it embedded the title twice and
              // looked like content. Removing it made `undefined` reachable
              // here, and because these upserts run inside a batch
              // transaction, ONE record without a summary rolled back every
              // other row in the run: 46 correctly-extracted Attorney General
              // measures discarded because an unrelated SOS measure had none.
              //
              // Empty string, never the title. An absent summary should look
              // absent.
              summary: prop.summary ?? '',
              fullText: prop.fullText,
              status: prop.status,
              electionDate: prop.electionDate,
              sourceUrl: prop.sourceUrl,
              lifecycleStageId,
            },
            create: {
              externalId: prop.externalId,
              title: prop.title,
              summary: prop.summary ?? '',
              fullText: prop.fullText,
              status: prop.status,
              electionDate: prop.electionDate,
              sourceUrl: prop.sourceUrl,
              lifecycleStageId,
              regionPluginName: pluginName,
            },
          });
        }),
      'propositions:',
    );
    extractTracker.complete();

    // A source that extracted rows and wrote none is a FAILURE, not a quiet
    // no-op (#1219, E-27).
    //
    // This has now cost two rounds of debugging. These upserts run in a batch
    // transaction, so a single invalid record rolls back every other row —
    // and the run still reported success. On 2026-09-14 that discarded 46
    // correctly-extracted Attorney General measures, along with the 44
    // summaries that had just taken seven minutes of PDF fetching, because one
    // unrelated measure was missing a required field. The only trace was a
    // `0 created, 0 updated` line among thousands.
    //
    // Deliberately WARN and not throw. The write already failed; the sync's
    // remaining phases (stage backfill, embedding, analysis) are still worth
    // running for whatever else succeeded, and turning a data problem into a
    // crashed job loses the diagnostics with it. The point is that the number
    // stops being silent.
    if (propositions.length > 0 && result.created + result.updated === 0) {
      this.logger.error(
        `[PropositionSync] WROTE NOTHING: ${propositions.length} proposition(s) ` +
          `extracted for ${pluginName}, 0 created and 0 updated. The batch ` +
          `write was rolled back — look for a PrismaClientValidationError ` +
          `above; one invalid record aborts the whole transaction.`,
      );
    }

    if (stagePatterns.length > 0) {
      await this.backfillStageIds(stagePatterns, pluginName);
    }

    // Keep the retrieval corpus in step with what was just written (#1074).
    //
    // No change-tracking needed here: `embedMissing` compares a hash of the
    // text it embeds, so a sync that rewrote 52 rows with identical title and
    // summary re-embeds none of them. That is the whole reason the hash column
    // exists — sync runs often and this text rarely moves.
    //
    // Deliberately does not fail the sync. A stale vector degrades retrieval
    // for one measure; an aborted sync loses the civic data for all of them.
    if (this.propositionEmbedding) {
      try {
        const embedResult = await this.propositionEmbedding.embedMissing();
        this.logger.log(
          `Retrieval corpus: embedded=${embedResult.embedded} unchanged=${embedResult.unchanged} failed=${embedResult.failed}`,
        );
      } catch (error) {
        this.logger.warn(
          `Retrieval corpus refresh failed (sync continues): ${(error as Error).message}`,
        );
      }
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
   * Backfill `summary` from the Legislative Counsel's Digest already stored
   * on `fullText` (#1261).
   *
   * ── Why the sync path is not enough ──────────────────────────────────────
   *
   * A sync can only repair a measure it re-extracts, and it only re-extracts
   * what the source still lists. Five Secretary of State measures — ACA 20,
   * ACA 22, SB 417, SB 42 and SCA 1 — were dropped from the qualified-ballot
   * -measures page when it rolled to the next election cycle. They are real
   * measures with rows in this database, and no amount of re-syncing will
   * ever touch them again. Measured after a full local re-sync, they were the
   * entire remaining echo tail: 5 of 52 rows, 9.6%.
   *
   * Their `fullText` still holds the digest. This reads it from the database
   * rather than the network, so it repairs rows the pipeline cannot reach.
   *
   * ── What it will not do ──────────────────────────────────────────────────
   *
   * Only a summary that is BLANK or a title echo is replaced. A genuine
   * Attorney General title-and-summary is better than a digest — it is
   * written for the ballot, where the digest is written for legislators — so
   * overwriting one would be a regression, not a repair.
   *
   * Idempotent: a second run finds nothing left to fix, because a row it
   * repaired is no longer blank and no longer an echo.
   *
   * Re-embeds what it rewrote, before returning. `embeddingSourceHash` does
   * not need clearing — `embedMissing` recomputes the hash from
   * `title + summary` and re-embeds any row whose stored hash no longer
   * matches — but it DOES need calling. Writing summaries without it leaves
   * the corpus holding vectors for text that is no longer there, and a stale
   * vector is worse than a missing one: retrieval still returns a confident
   * score against wording the row no longer has (#1074).
   *
   * @param limit - cap the number of rows examined, for a cautious first run.
   * @returns how many summaries were written.
   */
  async backfillSummariesFromDigest(limit?: number): Promise<number> {
    // Two passes on purpose. `fullText` runs to 115,000 characters on a
    // filing, and most rows do not need repairing — selecting it for every
    // row would pull the whole corpus of documents into memory to look at a
    // `summary` column. Find the candidates on the cheap columns first, then
    // read the text only for those.
    const rows = await this.db.proposition.findMany({
      where: { deletedAt: null, fullText: { not: null } },
      select: { id: true, externalId: true, title: true, summary: true },
      ...(limit && limit > 0 ? { take: limit } : {}),
    });
    const candidates = rows.filter((r) =>
      this.needsSummaryRepair(r.title, r.summary),
    );

    let written = 0;
    let degraded = 0;
    for (const prop of candidates) {
      const stored = await this.db.proposition.findUnique({
        where: { id: prop.id },
        select: { fullText: true },
      });

      const { text, droppedFraction } = extractLegislativeDigest(
        stored?.fullText ?? '',
        prop.externalId ?? undefined,
      );
      if (!text) continue;

      await this.db.proposition.update({
        where: { id: prop.id },
        data: { summary: text },
      });
      written += 1;
      if (droppedFraction) {
        degraded += 1;
        // The source OCR dropped a fraction glyph, so a number in this
        // summary reads as a bare "%". Never repaired, always reported — a
        // vote threshold is the number that must not be guessed (#1266).
        this.logger.warn(
          `Propositions: digest for ${String(prop.externalId)} has a percent ` +
            `sign with no number — the source PDF's OCR dropped a fraction glyph`,
        );
      }
    }

    if (written > 0) {
      this.logger.log(
        `Propositions: backfilled ${written} summary(ies) from the Legislative ` +
          `Counsel's Digest of ${rows.length} row(s) examined` +
          (degraded > 0 ? `; ${degraded} carry a dropped fraction glyph` : ''),
      );
      if (this.propositionEmbedding) {
        const embedded = await this.propositionEmbedding.embedMissing();
        this.logger.log(
          `Propositions: re-embedded ${embedded.embedded} row(s) after the backfill`,
        );
      }
      if (this.cacheService) {
        await this.cacheService.invalidateCache('propositions:');
      }
    }
    return written;
  }

  /**
   * A summary is worth replacing only when it is absent or carries nothing the
   * title does not. Shared with the pipeline's lint so the backfill and the
   * sync agree on what an echo is.
   */
  private needsSummaryRepair(
    title: string | null,
    summary: string | null,
  ): boolean {
    if (!summary?.trim()) return true;
    return detectSummaryEcho(title ?? undefined, summary).isEcho;
  }

  /**
   * Resolve `lifecycleStageId` for propositions ingested before civics
   * patterns were available, or whose status matched no pattern at the
   * time of upsert. Mirrors `backfillBillStageIds`. Idempotent.
   *
   * Scoped to the syncing plugin's own rows via `regionPluginName`
   * (#1164, closing the #731 caveat) — a county sync's stage patterns
   * must not rewrite statewide rows and vice versa.
   */
  private async backfillStageIds(
    stagePatterns: StagePattern[],
    pluginName: string,
  ): Promise<void> {
    const unmatched = await this.db.proposition.findMany({
      where: {
        lifecycleStageId: null,
        deletedAt: null,
        regionPluginName: pluginName,
      },
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
