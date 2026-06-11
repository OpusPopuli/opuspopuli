import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import type { Representative } from '@opuspopuli/common';
import { BioGeneratorService } from './bio-generator.service';
import { CommitteeSummaryGeneratorService } from './committee-summary-generator.service';
import { LegislativeCommitteeLinkerService } from './legislative-committee-linker.service';
import { LegislativeCommitteeDescriptionGeneratorService } from './legislative-committee-description-generator.service';
import { repSyncTracker } from './sync-phase-logger';
import {
  stripLeadingZerosFromExternalId,
  isLikelyValidBio,
  extractLastName,
} from './region.service';
import type { UpsertByExternalId } from './propositions-sync.service';

/**
 * Minimal provider contract for representatives data type.
 */
export interface RepresentativesProvider {
  getName?(): string;
  fetchRepresentatives(): Promise<Representative[]>;
}

/**
 * Plugin-scoped context that affects representative normalization /
 * district sanitization / bio-junk filtering. Owned by the orchestrator
 * (set by the plugin-lifecycle code; the plugin extraction in #828 Step 6
 * will lift this into its own service) and passed in per-sync.
 */
export interface RepresentativesPluginContext {
  /** Plugin-supplied region identifier, used when seeding `rep.regionId` for bio generation. */
  regionName: string | undefined;
  /** Whether the active plugin asked us to strip leading zeros from district external ids. */
  normalizeDistrict: boolean;
  /** Plugin-supplied noise regexes used to discard junk bio scrapes. */
  bioNoisePatterns: RegExp[];
}

/**
 * Owns the representatives data-type sync (extracted from RegionSyncService
 * as #828 Step 3). Phases: discover → extract_and_upsert → detail_crawl
 * (marker; inlined into the plugin layer) → bio_generation → prune_stale
 * (marker).
 *
 * District helper from the original location (`deriveDistrictFromExternalId`)
 * stays in `region.service.ts` for now — moving it requires a touched
 * surface bigger than this PR; tracked as a follow-up in #828.
 */
@Injectable()
export class RepresentativesSyncService {
  private readonly logger = new Logger(RepresentativesSyncService.name, {
    timestamp: true,
  });

  constructor(
    private readonly db: DbService,
    @Optional() private readonly bioGenerator?: BioGeneratorService,
    @Optional()
    private readonly committeeSummaryGenerator?: CommitteeSummaryGeneratorService,
    @Optional()
    private readonly legislativeCommitteeLinker?: LegislativeCommitteeLinkerService,
    @Optional()
    private readonly legislativeCommitteeDescriptions?: LegislativeCommitteeDescriptionGeneratorService,
  ) {}

  async sync(
    provider: RepresentativesProvider,
    maxReps: number | undefined,
    regionId: string | undefined,
    pluginContext: RepresentativesPluginContext,
    upsertByExternalId: UpsertByExternalId,
    deriveDistrictFromExternalId: (externalId: string) => string | undefined,
  ): Promise<{ processed: number; created: number; updated: number }> {
    const resolvedRegionId = regionId ?? provider.getName?.() ?? 'unknown';

    // ─── Phase 1/5 — discover ──────────────────────────────────────
    const discoverTracker = repSyncTracker(this.logger, 'discover', 1, {
      region: resolvedRegionId,
    });
    const reps = await provider.fetchRepresentatives();
    discoverTracker.item({
      name: 'representatives provider',
      externalId: null,
      outcomeLabel: `${reps.length} representative(s) discovered`,
      outcome: 'updated',
    });
    discoverTracker.complete();

    // Chamber attribution happens at fetch time in
    // DeclarativeRegionPlugin.fetchRepresentatives — each rep is stamped
    // with the source's `category` (Assembly / Senate / Board of
    // Supervisors / …) before it leaves the plugin. The old
    // `applyChamberFallback` here relied on `instanceof
    // DeclarativeRegionPlugin` which silently failed across worker
    // bundles, leaving chamber undefined and causing Prisma to reject
    // every upsert. Removed in the #745 code review.
    for (const r of reps) {
      this.normalizeRep(r, pluginContext);
    }

    // ─── Phase 2/5 — extract_and_upsert ────────────────────────────
    // Pre-fetch existing externalIds so the per-item line can report
    // accurate created-vs-updated outcomes. Skip when there's nothing
    // to look up.
    const existingRepIds = new Set<string>(
      reps.length === 0
        ? []
        : (
            await this.db.representative.findMany({
              where: { externalId: { in: reps.map((r) => r.externalId) } },
              select: { externalId: true },
            })
          ).map((r: { externalId: string }) => r.externalId),
    );
    const extractTracker = repSyncTracker(
      this.logger,
      'extract_and_upsert',
      reps.length,
      { region: resolvedRegionId },
    );
    const result = await upsertByExternalId(
      reps,
      (ids) =>
        this.db.representative.findMany({
          where: { externalId: { in: ids } },
          select: { externalId: true },
        }),
      (items): unknown[] =>
        items.map((rep) => {
          const lastName = extractLastName(rep.name);
          const district = this.sanitizeDistrict(
            rep,
            deriveDistrictFromExternalId,
          );
          const isNew = !existingRepIds.has(rep.externalId);
          extractTracker.item({
            name: rep.name,
            externalId: rep.externalId,
            outcomeLabel: `${isNew ? 'created' : 'updated'} (chamber=${rep.chamber ?? 'unknown'}, district=${district})`,
            outcome: isNew ? 'created' : 'updated',
          });
          return this.db.representative.upsert({
            where: { externalId: rep.externalId },
            update: {
              regionId: regionId ?? rep.regionId ?? 'california',
              name: rep.name,
              lastName,
              chamber: rep.chamber,
              district,
              party: rep.party,
              photoUrl: rep.photoUrl ?? undefined,
              contactInfo: (rep.contactInfo as object | null) ?? undefined,
              committees: (rep.committees as object[] | null) ?? undefined,
              committeesSummary: rep.committeesSummary ?? undefined,
              bio: rep.bio ?? undefined,
              bioSource: rep.bioSource ?? undefined,
              bioClaims: (rep.bioClaims as object[] | null) ?? undefined,
            },
            create: {
              externalId: rep.externalId,
              regionId: regionId ?? rep.regionId ?? 'california',
              name: rep.name,
              lastName,
              chamber: rep.chamber,
              district,
              party: rep.party,
              photoUrl: rep.photoUrl,
              contactInfo: rep.contactInfo as object | undefined,
              committees: rep.committees as object[] | undefined,
              committeesSummary: rep.committeesSummary,
              bio: rep.bio,
              bioSource: rep.bioSource,
              bioClaims: rep.bioClaims as object[] | undefined,
            },
          });
        }),
      'representatives:',
    );
    extractTracker.complete();

    // ─── Phase 3/5 — detail_crawl ──────────────────────────────────
    // Detail-page crawling for committees/contact info happens inside
    // the DeclarativeRegionPlugin.fetchRepresentatives call above —
    // it's not a separate orchestrator step in the current pipeline.
    // Phase fires as a marker so the operator sees all 5 phases.
    const detailCrawlTracker = repSyncTracker(this.logger, 'detail_crawl', 0, {
      region: resolvedRegionId,
      note: 'inlined into fetchRepresentatives at plugin layer',
    });
    detailCrawlTracker.complete();

    // ─── Phase 4/5 — bio_generation ────────────────────────────────
    const bioTracker = repSyncTracker(
      this.logger,
      'bio_generation',
      this.bioGenerator ? reps.length : 0,
      { region: resolvedRegionId },
    );
    if (this.bioGenerator) {
      await this.bioGenerator.enrichBios(
        reps,
        pluginContext.regionName,
        maxReps,
      );
      // BioGeneratorService is opaque about per-rep outcomes from out
      // here — it logs its own per-rep DEBUG lines. We just record the
      // batch boundary as one aggregate item.
      bioTracker.note(`enrichBios pass complete for ${reps.length} reps`);
    }
    bioTracker.complete();

    if (this.committeeSummaryGenerator) {
      await this.committeeSummaryGenerator.generateMissingSummaries(maxReps);
    }

    if (this.legislativeCommitteeLinker) {
      try {
        await this.legislativeCommitteeLinker.linkAll();
      } catch (error) {
        this.logger.warn(
          `Legislative committee linker failed: ${(error as Error).message}`,
        );
      }
    }

    if (this.legislativeCommitteeDescriptions) {
      try {
        await this.legislativeCommitteeDescriptions.generateMissingDescriptions(
          maxReps,
        );
      } catch (error) {
        this.logger.warn(
          `Legislative committee description generation failed: ${(error as Error).message}`,
        );
      }
    }

    // ─── Phase 5/5 — prune_stale ───────────────────────────────────
    // Stale-rep pruning isn't currently wired (reps don't go inactive
    // by data-source absence the way bills do — they leave office in
    // discrete elections). Marker for parity with bills' 6-phase
    // shape; tracked for actual implementation under #816 / #770
    // alongside the rep↔committee FK work.
    const pruneTracker = repSyncTracker(this.logger, 'prune_stale', 0, {
      region: resolvedRegionId,
      note: 'not-yet-implemented',
    });
    pruneTracker.complete();

    return result;
  }

  /**
   * Pick the best district value for a representative. Prefer the
   * scraped numeric district, fall back to deriving from the externalId
   * (e.g. trailing digits in the slug), keep the raw value otherwise.
   * Plugin-agnostic — the derive function is passed in so this service
   * doesn't have to import from `region.service.ts` directly.
   */
  private sanitizeDistrict(
    rep: Representative,
    deriveDistrictFromExternalId: (externalId: string) => string | undefined,
  ): string {
    const raw = (rep.district ?? '').trim();
    if (/^\d+$/.test(raw)) return String(Number.parseInt(raw, 10));
    const derived = deriveDistrictFromExternalId(rep.externalId);
    if (derived !== undefined) {
      this.logger.warn(
        `Sanitized district for ${rep.name} (${rep.externalId}): scraped value "${raw}" is not numeric, using externalId-derived "${derived}"`,
      );
      return derived;
    }
    if (raw) {
      this.logger.warn(
        `Non-numeric district "${raw}" for ${rep.name} (${rep.externalId}) and no numeric suffix to fall back on; keeping raw value`,
      );
    }
    return raw;
  }

  private normalizeRep(
    r: Representative,
    pluginContext: RepresentativesPluginContext,
  ): void {
    if (pluginContext.normalizeDistrict) {
      r.externalId = stripLeadingZerosFromExternalId(r.externalId);
    }
    if (r.bio && !isLikelyValidBio(r.bio, pluginContext.bioNoisePatterns)) {
      this.logger.warn(
        `Discarding junk bio for ${r.externalId} (${r.bio.length} chars): ${r.bio.slice(0, 60)}…`,
      );
      r.bio = undefined;
      r.bioSource = undefined;
    }
    if (r.bio && !r.bioSource) {
      r.bioSource = 'scraped';
    }
  }
}
