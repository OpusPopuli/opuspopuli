import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { METRICS_OBSERVER, type MetricsObserver } from '@opuspopuli/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import { escapeRegExp, type Representative } from '@opuspopuli/common';
import { BioGeneratorService } from './bio-generator.service';
import { CommitteeSummaryGeneratorService } from './committee-summary-generator.service';
import { LegislativeCommitteeLinkerService } from './legislative-committee-linker.service';
import { LegislativeCommitteeDescriptionGeneratorService } from './legislative-committee-description-generator.service';
import { EntityActivitySummaryGeneratorService } from './entity-activity-summary-generator.service';
import { repSyncTracker } from './sync-phase-logger';
import {
  stripLeadingZerosFromExternalId,
  isLikelyValidBio,
  extractLastName,
} from './region.service';
import { recordClaims } from './claim-recorder';
import type { UpsertByExternalId } from './propositions-sync.service';

/**
 * Minimal provider contract for representatives data type.
 */
export interface RepresentativesProvider {
  getName?(): string;
  fetchRepresentatives(limit?: number): Promise<Representative[]>;
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
  bioTrimPatterns: RegExp[];
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
/**
 * The AI attribution columns, nulled — but only for a bio that came from a
 * scrape (#1391).
 *
 * `bioClaims`, `bioPromptHash`, `bioPromptVersion`, `bioLlmModel` and
 * `bioLlmDigest` are written exclusively by the generation path
 * (`BioGeneratorService.persistBio`). Nothing in the scraped path could clear
 * them, and the upsert passes `undefined` — which Prisma reads as "leave
 * alone" — so a scraped bio inherited whatever the last generated one claimed:
 * a verbatim government page attributed to nemotron, with a prompt hash and
 * per-sentence claims for sentences no longer present.
 *
 * Returns an EMPTY object in every other case, so a sync that scraped no bio
 * leaves the existing bio and its attribution untouched. That distinction is
 * the whole point: clearing unconditionally would wipe the attribution off
 * every legitimately generated bio on the next sync.
 */
export function clearedAiAttribution(
  rep: Representative,
): Partial<Prisma.RepresentativeUpdateInput> {
  const isScraped = Boolean(rep.bio) && rep.bioSource === 'scraped';
  if (!isScraped) return {};

  return {
    // `bio_claims` is JSONB, so Prisma's generated types accept
    // `NullableJsonNullValueInput | InputJsonValue | undefined` — NOT a
    // literal `null`. Measured, because the distinction matters: a literal
    // null here is a compile error (TS2322), while at RUNTIME Prisma accepts
    // it and clears the column. So the first version of this helper was
    // type-unsound rather than broken, and relied on undocumented leniency.
    //
    // It typechecked only because the return type was `Record<string, null>`
    // and the value is SPREAD into the update — which erased the field types.
    // Typing the return as `Partial<Prisma.RepresentativeUpdateInput>` is the
    // durable fix: the spread is now checked, so a future literal null fails
    // the build instead of passing silently.
    //
    // `Prisma.DbNull` also matches this repo's existing precedent —
    // `toJsonField` in civics-sync.service.ts exists for exactly this.
    bioClaims: Prisma.DbNull,
    // These four are `String?`, where a literal null is correct.
    bioPromptHash: null,
    bioPromptVersion: null,
    bioLlmModel: null,
    bioLlmDigest: null,
  };
}

/**
 * Strip page chrome from a scraped bio (#1382 follow-up).
 *
 * A container selector that captures the biography also captures the heading
 * above it and the call-to-action below. Measured on the first 20 scraped
 * Senate bios: 15 carried a leading heading, 8 a trailing CTA.
 *
 *   "Meet Senator Angelique Ashby Senator Ashby was elected in 2022…"
 *   "Representing California Senate District 7 State Senator Jesse Arreguín
 *    A lifelong advocate for economic and social justice…"
 *   "…a city that works for more of us. Read Bio"
 *
 * Purely pattern-driven, from region config. Two heuristics were tried first
 * and both were wrong, which is why this does no inference at all:
 *
 *  - Matching `Senator\s+<Capitalised words>` produced "Arreguín A lifelong
 *    advocate…" — it guessed where the name ended and split it in half.
 *  - Anchoring on the rep's surname then trimming through its first
 *    occurrence could not tell chrome from prose: it turned the perfectly good
 *    "Senator Ashby was elected in 2022…" into "was elected in 2022…",
 *    because a bio may legitimately open by naming its subject.
 *
 * The wording of both the heading and the CTA is a property of one caucus
 * template, not of representatives, so it lives in `bioTrimPatterns` beside
 * `bioNoisePatterns` rather than being inferred here.
 */
export function trimBioChrome(
  bio: string,
  trimPatterns: RegExp[] = [],
): string {
  let out = bio;
  for (const pattern of trimPatterns) {
    // Collapse and trim after EACH pattern, not once at the end. Patterns are
    // `^`-anchored and applied in order, so a leading space left behind by an
    // earlier one stops every later pattern from matching: `^Body\s+` on
    // "Body Meet Senator Steve Padilla…" left " Meet Senator…", and
    // `^Meet Senator\s+` then missed it. Measured — it was the one page of 16
    // that kept its chrome.
    out = out.replace(pattern, ' ').replaceAll(/\s+/g, ' ').trim();
  }
  return out;
}

/**
 * How many whitespace-separated tokens may precede the surname in a heading.
 *
 * Observed forms are "<First> <Last>" and "<First> <Middle> <Last>"; 3 leaves
 * margin for a two-word surname like "Gómez Reyes" without reaching so far
 * into prose that an incidental surname mention could anchor a match.
 */
const MAX_TOKENS_BEFORE_SURNAME = 3;

/**
 * Strip a leading name heading left behind by {@link trimBioChrome} (#1381).
 *
 * The configured patterns remove the heading's PREFIX — `^Meet Senator\s+`,
 * `^Representing California Senate District \d+ State Senator\s+` — and the
 * name itself is what remains, because the name is the variable part the
 * pattern could not name:
 *
 *   "Meet Senator Angelique Ashby Senator Ashby was elected in 2022…"
 *     → pattern → "Angelique Ashby Senator Ashby was elected in 2022…"
 *     → here    → "Senator Ashby was elected in 2022…"
 *
 * ── Why this is not the heuristic that was rejected ─────────────────────────
 *
 * {@link trimBioChrome} records that anchoring on the surname and trimming
 * through its first occurrence was tried and abandoned, because it turned the
 * perfectly good "Senator Ashby was elected in 2022…" into "was elected in
 * 2022…". It could not tell chrome from prose.
 *
 * The missing discriminator is what FOLLOWS the name. A heading is followed by
 * the start of a new sentence — a capital letter. Prose that opens by naming
 * its subject is followed by that subject's VERB, in lower case:
 *
 *   "Jesse Arreguín A lifelong advocate…"    → capital → heading, strip
 *   "Tim Grayson Elected to represent…"      → capital → heading, strip
 *   "Senate President pro Tempore Monique Limón was elected…"
 *                                            → "was"  → prose, keep
 *
 * Measured over the 9 Senate pages that yield a bio: 5 carry a bare leading
 * name, every one of them followed by a capital; the one page whose title IS
 * its prose (sd21) is followed by a lower-case verb and is left alone. The
 * same test protects the case that killed the old heuristic — "Senator Ashby
 * was elected" keeps its subject, because "was" is lower case.
 *
 * It anchors on the SURNAME, not the full name, because the roster name and
 * the page's own name disagree: the roster says "Timothy S. Grayson" and
 * "Stephen C. Padilla" where the pages say "Tim Grayson" and "Steve Padilla".
 * Matching the full name would miss exactly those.
 *
 * Non-letters between the name and the next sentence are consumed, which also
 * takes the stray `-->` that leaks into sd18's extracted text.
 *
 * Fails safe in both directions: no surname match, or a lower-case word after
 * it, leaves the bio untouched. A missed heading is cosmetic; a severed
 * opening clause is published prose about a named person.
 *
 * @param bio - Bio text, already through {@link trimBioChrome}
 * @param name - The representative's name as the roster gives it
 * @returns The bio without its leading name heading
 */
export function trimLeadingName(bio: string, name: string): string {
  const surname = extractLastName(name);
  if (!surname) return bio;

  const heading = new RegExp(
    `^(?:\\S+\\s+){0,${MAX_TOKENS_BEFORE_SURNAME}}?` +
      escapeRegExp(surname) +
      // At least one non-letter, then a capital: the start of a new
      // sentence. `+` rather than `*` is what makes the surname match end on
      // a word boundary. Zero-width would let a surname that merely PREFIXES
      // the next word sever it — "LeeAnn Smith Is…" against surname "Lee"
      // would publish "Ann Smith Is…". A `\\b` cannot do this job: JS word
      // boundaries are ASCII, so a surname ending in an accented letter has
      // no boundary before a space and would never match.
      '[^\\p{L}]+(?=\\p{Lu})',
    'u',
  );

  return bio.replace(heading, '').trim();
}

@Injectable()
export class RepresentativesSyncService {
  private readonly logger = new Logger(RepresentativesSyncService.name, {
    timestamp: true,
  });

  /**
   * One place where the metrics observer reaches a tracker, rather than a
   * fifth argument on each call below. `Parameters<typeof repSyncTracker>`
   * keeps the compile-time phase check — passing another data type's phase
   * name is still a type error.
   */
  private repTracker(
    phase: Parameters<typeof repSyncTracker>[1],
    total: number,
    summaryArgs?: Record<string, string | number>,
  ): ReturnType<typeof repSyncTracker> {
    return repSyncTracker(this.logger, phase, total, summaryArgs, this.metrics);
  }

  constructor(
    private readonly db: DbService,
    @Optional() private readonly bioGenerator?: BioGeneratorService,
    @Optional()
    private readonly committeeSummaryGenerator?: CommitteeSummaryGeneratorService,
    @Optional()
    private readonly legislativeCommitteeLinker?: LegislativeCommitteeLinkerService,
    @Optional()
    private readonly legislativeCommitteeDescriptions?: LegislativeCommitteeDescriptionGeneratorService,
    @Optional()
    private readonly entityActivitySummaries?: EntityActivitySummaryGeneratorService,
    /**
     * Where item outcomes go (M1, `docs/plans/ingestion-resource-lanes.md`
     * §2). Optional and last: several specs construct this service by hand,
     * and a sync must run identically with no metrics bound.
     */
    @Optional()
    @Inject(METRICS_OBSERVER)
    private readonly metrics?: MetricsObserver,
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
    const discoverTracker = this.repTracker('discover', 1, {
      region: resolvedRegionId,
    });
    // Pass the cap INTO the fetch (#1387). Slicing afterwards would trim
    // the rows we keep without preventing a single HTTP request, and the
    // requests are the cost: a 5-rep smoke test used to make 120 detail
    // plus 80 secondary fetches against two government sites.
    const reps = await provider.fetchRepresentatives(maxReps);
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
    const extractTracker = this.repTracker('extract_and_upsert', reps.length, {
      region: resolvedRegionId,
    });
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
              // A scraped bio carries NO AI attribution (#1391). Explicit nulls,
              // because Prisma reads `undefined` as "leave alone" — which is why
              // the previous attribution survived, leaving a row that claimed
              // nemotron produced text copied verbatim from a government page.
              // #1281 made attribution structural so an output could not be
              // unattributable; this stops it becoming MISattributable, which is
              // worse.
              //
              // Spread, and only when the scrape actually produced a bio: a sync
              // that found none must leave the existing bio and its attribution
              // entirely alone.
              ...clearedAiAttribution(rep),
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

    // A scraped bio replaces an AI one, so the AI one's claims must stop being
    // current (#1391). `clearedAiAttribution` above clears the row's own
    // columns; the shared `claims` table is a separate write and was left
    // behind, so 22 claims for the two reps scraped on 2026-10-20 still
    // attested to deleted text — including an invented spouse named for a
    // private individual and a school-board seat that does not exist.
    await this.supersedeClaimsForScrapedBios(reps);

    // ─── Phase 3/5 — detail_crawl ──────────────────────────────────
    // Detail-page crawling for committees/contact info happens inside
    // the DeclarativeRegionPlugin.fetchRepresentatives call above —
    // it's not a separate orchestrator step in the current pipeline.
    // Phase fires as a marker so the operator sees all 5 phases.
    const detailCrawlTracker = this.repTracker('detail_crawl', 0, {
      region: resolvedRegionId,
      note: 'inlined into fetchRepresentatives at plugin layer',
    });
    detailCrawlTracker.complete();

    // ─── Phase 4/5 — bio_generation ────────────────────────────────
    const bioTracker = this.repTracker(
      'bio_generation',
      this.bioGenerator ? reps.length : 0,
      { region: resolvedRegionId },
    );
    if (this.bioGenerator) {
      await this.bioGenerator.enrichBios(
        reps,
        pluginContext.regionName,
        // Scopes candidate selection to this region (#1394). Omitting it
        // would hand another region's reps California's jurisdiction.
        resolvedRegionId,
        maxReps,
      );
      // BioGeneratorService is opaque about per-rep outcomes from out
      // here — it logs its own per-rep DEBUG lines. We just record the
      // batch boundary as one aggregate item.
      bioTracker.note(`enrichBios pass complete for ${reps.length} reps`);
    }
    bioTracker.complete();

    if (this.committeeSummaryGenerator) {
      await this.committeeSummaryGenerator.generateMissingSummaries(
        resolvedRegionId,
        maxReps,
      );
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

    await this.generateActivitySummaries();

    // ─── Phase 5/5 — prune_stale ───────────────────────────────────
    // Stale-rep pruning isn't currently wired (reps don't go inactive
    // by data-source absence the way bills do — they leave office in
    // discrete elections). Marker for parity with bills' 6-phase
    // shape; tracked for actual implementation under #816 / #770
    // alongside the rep↔committee FK work.
    const pruneTracker = this.repTracker('prune_stale', 0, {
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

  /**
   * Activity summaries, which until now ran ONLY from a hand-invoked script
   * (#665) and had therefore never run at all: 0 of 125 representatives,
   * against 125 bios and 79 committee summaries produced by the generators
   * beside it in `sync()`. It was the one AI generator in this domain that no
   * sync reached, and a feature whose only trigger is someone remembering it
   * exists is a feature that stays empty.
   *
   * It summarises the `legislative_actions` ALREADY stored, not any arriving
   * in the same run — those are ingested by a different path. That is fine for
   * a 90-day window, and stated here so it is not mistaken for a freshness
   * bug.
   *
   * Extracted rather than inlined because inlining it took `sync()` from 15 to
   * 17 cognitive complexity, past the Sonar gate.
   */
  private async generateActivitySummaries(): Promise<void> {
    if (!this.entityActivitySummaries) return;

    try {
      const activity = await this.entityActivitySummaries.generateAll();
      // Reported even when zero, and worded to separate "no entity had
      // activity in the window" from "this never ran". The window closes
      // ~2026-11-10 for the current corpus (actions stop 2026-08-12, default
      // window 90 days), after which the honest answer becomes zero and the
      // two are indistinguishable without this line.
      this.logger.log(
        `Activity summaries: ${activity.repsUpdated} representative(s) and ` +
          `${activity.committeesUpdated} committee(s) updated` +
          (activity.repsUpdated === 0 && activity.committeesUpdated === 0
            ? ' — no entity had legislative actions inside the window'
            : ''),
      );
    } catch (error) {
      // Non-fatal, like its two siblings in `sync()`: a roster sync that
      // worked must not be reported as failed because a summary pass did not.
      this.logger.warn(
        `Activity summary generation failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Stop a rep's stored claims being current once its bio is scraped (#1391).
   *
   * `recordClaims` with an empty claim list supersedes and writes nothing:
   * the incoming signature differs from a non-empty stored one, so the
   * existing rows are closed, and the insert is skipped on `rows.length === 0`.
   * That is the primitive, so this does not reimplement superseding.
   *
   * Superseded rather than deleted, for the reason the writer gives — the
   * record of what we asserted last run is the point of a bi-temporal table.
   *
   * `sourceText`/`sourceTextHash` are null because representative bios cite
   * structured fields, which is what {@link ClaimRecordInput} documents them
   * as null for; with no claims to verify, nothing reads them.
   */
  private async supersedeClaimsForScrapedBios(
    reps: Representative[],
  ): Promise<void> {
    const scraped = reps.filter((r) => r.bio && r.bioSource === 'scraped');
    if (scraped.length === 0) return;

    const rows = await this.db.representative.findMany({
      where: { externalId: { in: scraped.map((r) => r.externalId) } },
      select: { id: true, externalId: true },
    });

    // No matching rows means nothing to supersede — and no reason to issue a
    // grouped query over an empty id list.
    if (rows.length === 0) return;

    // One grouped query rather than a count per rep. It also makes the log
    // honest: the previous line reported `rows.length` — every scraped rep
    // found — as though all of them had been superseded.
    const counts = await this.db.claim.groupBy({
      by: ['subjectId'],
      where: {
        subjectType: 'representative',
        subjectId: { in: rows.map((row) => row.id) },
        validUntil: null,
      },
      _count: { _all: true },
    });
    const currentByRep = new Map(
      counts.map((group) => [group.subjectId, group._count._all]),
    );

    let supersededClaims = 0;
    let supersededReps = 0;
    for (const row of rows) {
      const current = currentByRep.get(row.id) ?? 0;
      // Nothing stored means nothing to supersede, and `recordClaims` would
      // no-op anyway — skipping avoids taking its per-subject advisory lock.
      if (current === 0) continue;

      await recordClaims(this.db, {
        subjectType: 'representative',
        subjectId: row.id,
        claims: [],
        sourceText: null,
        sourceTextHash: null,
      });
      supersededClaims += current;
      supersededReps += 1;
    }

    if (supersededReps > 0) {
      this.logger.log(
        `Superseded ${supersededClaims} AI bio claim(s) across ` +
          `${supersededReps} rep(s) whose bio is now scraped`,
      );
    }
  }

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
    // Trim page chrome BEFORE validating, so the junk check judges what we
    // will actually store. A bio that is only chrome then fails the length
    // floor below and is discarded, which is the correct outcome.
    if (r.bio) {
      r.bio = trimBioChrome(r.bio, pluginContext.bioTrimPatterns);
      // After the patterns, because the name is what the patterns leave
      // behind — they strip the heading's fixed prefix, not its variable part.
      r.bio = trimLeadingName(r.bio, r.name);
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
