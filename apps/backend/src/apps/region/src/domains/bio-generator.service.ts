import { Injectable, Logger } from '@nestjs/common';
import {
  extractFieldString,
  extractJsonObjectSlice,
  type BioClaim,
  type Representative,
} from '@opuspopuli/common';
import { Prisma } from '@opuspopuli/relationaldb-provider';
import { dropUnsupportedSentences } from './bio-source-guard';
import { normaliseBioClaims } from './claim-normalisers';
import { readOptionalPositiveInt, readPositiveInt } from './config-helpers';
import { AiOutputProvenance, LlmGeneratorBase } from './llm-generator.base';

/**
 * Generates AI bios for representatives that lack a scraped biography.
 *
 * Uses structured public record data (name, chamber, district, party,
 * committee assignments) to prompt the LLM for a factual biography.
 *
 * Tunable via env vars (useful for dev/prod balance):
 * - BIO_GENERATOR_MAX_TOKENS (default 800) — LLM output budget per bio
 * - BIO_GENERATOR_CONCURRENCY (default 1) — how many bios to generate in parallel
 * - BIO_GENERATOR_MAX_REPS (default unlimited) — cap on how many reps get a bio
 *   per run. Useful in dev to verify end-to-end plumbing quickly without
 *   waiting for a full-batch LLM run. Leave unset in production.
 *
 * Behavior:
 * - Only generates bios for representatives with empty/missing bio fields
 * - Existing scraped bios are never overwritten
 * - Soft failures: if generation fails, the rep is stored without a bio
 * - Sets bioSource='ai-generated' on successful generation
 */
@Injectable()
export class BioGeneratorService extends LlmGeneratorBase {
  private readonly logger = new Logger(BioGeneratorService.name);
  private activeRegionName: string | undefined;
  // Field initializers run after super(), so this.config is already set.
  private readonly maxTokens = readPositiveInt(
    this.config,
    'BIO_GENERATOR_MAX_TOKENS',
    800,
  );
  private readonly concurrency = readPositiveInt(
    this.config,
    'BIO_GENERATOR_CONCURRENCY',
    1,
  );
  private readonly maxReps = readOptionalPositiveInt(
    this.config,
    'BIO_GENERATOR_MAX_REPS',
  );

  /**
   * Generate AI bios for every representative in the region that still lacks
   * one, and reflect the results onto `reps`.
   *
   * ── Candidates come from the DATABASE, not from `reps` (#1394) ──────────────
   *
   * This used to filter the scraped array: `reps.filter((r) => !r.bio)`. That
   * reads like a precedence rule — only generate where the scrape found
   * nothing — and it is one, but it is also unconditional, because the scrape
   * finds nothing for the same reps on every single run. California's rosters
   * yield a bio for 15 of 120, so the other ~104 arrived with `bio` empty
   * every sync and were regenerated from scratch each time.
   *
   * Measured over two identical syncs on 2026-10-21: all 102 existing bios
   * were regenerated, taking **16m35s**, and **57 of them (56%) came back
   * with different text** — visible in `claims`, where `recordClaims`
   * superseded 57 subjects and correctly no-opped the 45 that regenerated
   * identically. So the corpus was not reproducible run to run, and most of
   * an hour of model time per sync went to rewriting bios that already
   * existed.
   *
   * Reading candidates from the DB fixes a second fault at the same time. The
   * roster returned **119 of 120** reps on two consecutive runs — Josh Becker
   * was absent from the scrape both times — and a rep missing from `reps` was
   * never a candidate, so he had no bio at all. `CommitteeSummaryGeneratorService`
   * already reads candidates from the DB and says why: "A scrape might fail or
   * only return part of a chamber… Reading candidates from the DB makes this
   * job resilient to scrape flakes." This is the same reasoning applied to the
   * same problem.
   *
   * Running after the extract phase is what makes it safe: the scraped bios of
   * this very sync are already persisted, so a DB query for an empty bio
   * cannot overwrite one. Scraped bios still win.
   *
   * A rep that produces no bio — a vacant seat, or one whose every sentence
   * the source-year guard drops — stays a candidate and is retried next sync.
   * That is deliberate: if the seat is filled later, we want the bio.
   *
   * @param reps - The scraped batch; mutated in place for callers downstream
   * @param regionName - Display name, used to derive the jurisdiction
   * @param regionId - Scopes the candidate query. Without it a California
   *   sync would generate bios for another region's reps and label them with
   *   California's jurisdiction, which is the wrong-state confabulation
   *   {@link deriveJurisdiction} exists to prevent.
   * @param maxRepsOverride — per-call cap that takes precedence over the
   *   BIO_GENERATOR_MAX_REPS env default. Wired to the syncRegionData
   *   mutation's `maxReps` arg so operators can choose a cap per run
   *   without bouncing the service. Pass 0 or undefined to fall back
   *   to the env default.
   */
  async enrichBios(
    reps: Representative[],
    regionName: string | undefined,
    regionId: string | undefined,
    maxRepsOverride?: number,
  ): Promise<Representative[]> {
    if (!this.promptClient || !this.llm) {
      return reps;
    }
    this.activeRegionName = regionName;

    const candidates = await this.findCandidates(
      this.resolveScope(regionId, reps),
    );
    const cap = this.resolveCap(maxRepsOverride);
    const needsBio = cap ? candidates.slice(0, cap) : candidates;

    if (needsBio.length > 0) {
      await this.runBatchGeneration(
        needsBio,
        candidates.length,
        cap,
        maxRepsOverride,
      );
      this.applyTo(reps, needsBio);
    }

    // Mark scraped bios that were present on arrival
    for (const rep of reps) {
      if (rep.bio && !rep.bioSource) {
        rep.bioSource = 'scraped';
      }
    }

    return reps;
  }

  /**
   * The region to scope candidate selection to, or undefined for all regions.
   *
   * The sync resolves its region id as
   * `regionId ?? provider.getName?.() ?? 'unknown'`, and on the
   * `syncDataType(REPRESENTATIVES)` path — which `scripts/run-rep-sync.ts`
   * uses — `regionId` arrives undefined and the provider exposes
   * `getProviderName()` rather than `getName()`. So the scope was the literal
   * string `'unknown'`, which matches no row: that path generated **zero**
   * bios, silently. Falling back to the region the scraped reps actually
   * carry restores it, and an unscoped query is warned about rather than
   * done quietly, because unscoped means another region's reps could be
   * stamped with this sync's jurisdiction.
   */
  private resolveScope(
    regionId: string | undefined,
    reps: Representative[],
  ): string | undefined {
    if (regionId && regionId !== 'unknown') return regionId;

    const fromReps = reps.find((rep) => rep.regionId)?.regionId;
    if (fromReps) return fromReps;

    this.logger.warn(
      'Bio candidates are not scoped to a region: the sync resolved no ' +
        'region id and none of the fetched representatives carry one. ' +
        'Generating for every region with a missing bio.',
    );
    return undefined;
  }

  /**
   * Representatives in the region whose stored bio is empty.
   *
   * Ordered by `externalId` so a capped run takes the same reps each time —
   * `findMany` guarantees no ordering, and an unordered cap would make a
   * smoke run cover a different arbitrary slice every time.
   */
  private async findCandidates(
    regionId: string | undefined,
  ): Promise<Representative[]> {
    if (!this.db) {
      this.logger.warn(
        'No DbService available — cannot select bio candidates from the database',
      );
      return [];
    }

    const rows = await this.db.representative.findMany({
      where: {
        deletedAt: null,
        ...(regionId ? { regionId } : {}),
        OR: [{ bio: null }, { bio: '' }],
      },
      select: {
        externalId: true,
        name: true,
        chamber: true,
        district: true,
        party: true,
        regionId: true,
      },
      orderBy: { externalId: 'asc' },
    });

    // Mapped, not cast. `Representative` declares `district` and `party` as
    // plain strings and `regionId` as `string | undefined`, while all three
    // are nullable in the database — Sonoma's supervisors carry no party at
    // all, county offices being non-partisan. An `as unknown as
    // Representative[]` asserted the shapes matched and let a `null` flow
    // into a field typed `string`; `formatRepData` then omits the empty
    // field rather than rendering "Party: null".
    return rows.map((row) => ({
      externalId: row.externalId,
      name: row.name,
      chamber: row.chamber,
      district: row.district ?? '',
      party: row.party ?? '',
      regionId: row.regionId ?? undefined,
    }));
  }

  /**
   * Copy generated bios onto the scraped batch, matched by `externalId`.
   *
   * `runBatchGeneration` persists each bio itself, so this is only so that
   * callers holding `reps` — and the phases after this one — see what was
   * generated. A candidate absent from `reps` (the roster-flake case this
   * change exists to cover) simply has nothing to copy onto.
   */
  private applyTo(reps: Representative[], generated: Representative[]): void {
    const byExternalId = new Map(reps.map((rep) => [rep.externalId, rep]));
    for (const candidate of generated) {
      if (!candidate.bio) continue;
      const target = byExternalId.get(candidate.externalId);
      if (!target) continue;
      target.bio = candidate.bio;
      target.bioSource = candidate.bioSource;
      target.bioClaims = candidate.bioClaims;
    }
  }

  /**
   * Pick the active cap: a positive mutation-arg override wins, else the
   * env default (possibly undefined → no cap).
   */
  private resolveCap(maxRepsOverride?: number): number | undefined {
    return maxRepsOverride && maxRepsOverride > 0
      ? maxRepsOverride
      : this.maxReps;
  }

  /**
   * Run the bounded-concurrency batch that turns a list of bio candidates
   * into generated bios. Mutates the reps in place and logs a summary.
   */
  private async runBatchGeneration(
    needsBio: Representative[],
    candidatesTotal: number,
    cap: number | undefined,
    maxRepsOverride: number | undefined,
  ): Promise<void> {
    const capSource =
      maxRepsOverride && maxRepsOverride > 0 ? 'mutation arg' : 'env default';
    const capNote =
      cap && candidatesTotal > cap
        ? ` (capped from ${candidatesTotal} by ${capSource}=${cap})`
        : '';
    this.logger.log(
      `Generating AI bios for ${needsBio.length} representatives${capNote} (concurrency=${this.concurrency}, maxTokens=${this.maxTokens})`,
    );

    let succeeded = 0;
    for (let i = 0; i < needsBio.length; i += this.concurrency) {
      const batch = needsBio.slice(i, i + this.concurrency);
      const results = await Promise.all(
        batch.map((rep) => this.tryGenerateBio(rep)),
      );
      succeeded += results.filter(Boolean).length;
    }

    this.logger.log(
      `Generated ${succeeded}/${needsBio.length} AI bios successfully`,
    );
  }

  /**
   * Generate a bio for one rep, mutating it in place on success.
   * Returns true if a bio was successfully generated and applied.
   * Swallows errors so one failed rep doesn't cancel its batch peers.
   */
  private async tryGenerateBio(rep: Representative): Promise<boolean> {
    try {
      const generated = await this.generateBio(rep);
      if (generated?.parsed.bio) {
        rep.bio = generated.parsed.bio;
        rep.bioSource = 'ai-generated';
        // Persist the full claims array (#602). Undefined on tier-2
        // salvage since only the bio string survived parsing.
        rep.bioClaims = generated.parsed.claims;
        await this.persistBio(rep, generated.provenance);
        return true;
      }
    } catch (error) {
      this.logger.warn(
        `Bio generation failed for ${rep.name}: ${(error as Error).message}`,
      );
    }
    return false;
  }

  /**
   * Write a freshly-generated bio back to the representative row. The rep was
   * already upserted (keyed by externalId) in the sync's extract phase, so this
   * persists the bio fields the generator just mutated in memory. The #828
   * extraction of RepresentativesSyncService dropped the monolith's
   * post-enrichBios upsert — without this write-back, generated bios are held
   * only in memory and discarded (the whole reps sync produced 0 persisted
   * bios). See #881.
   */
  private async persistBio(
    rep: Representative,
    provenance: AiOutputProvenance,
  ): Promise<void> {
    if (!this.db) {
      this.logger.warn(
        `No DbService available — generated bio for ${rep.name} not persisted`,
      );
      return;
    }
    const updated = await this.db.representative.update({
      where: { externalId: rep.externalId },
      data: {
        bio: rep.bio,
        bioSource: rep.bioSource,
        ...(rep.bioClaims
          ? { bioClaims: rep.bioClaims as unknown as Prisma.InputJsonValue }
          : {}),
        bioPromptHash: provenance.promptHash,
        bioPromptVersion: provenance.promptVersion,
        bioLlmModel: provenance.llmModel,
        bioLlmDigest: provenance.llmModelDigest,
      },
      select: { id: true },
    });

    // Dual-write into the evidence graph (#1293), after the authoritative
    // blob. No source text is passed because there is none: bio claims cite
    // structured source *fields* (`committees[0].name`), not offsets into a
    // document, so nothing here is locatable and nothing here will verify.
    //
    // That is the point rather than a shortfall — `origin: 'training'` lands
    // `unsourced` and `origin: 'source'` lands `unverified`, which is exactly
    // the distinction #1208 requires to survive: a model's recollection must
    // never read as a citation that merely failed a check.
    // `bioClaims` rather than `bioClaims?.length`: an empty array means the
    // generation produced no claims, and the blob above writes that — so the
    // mirror must clear the superseded rows too, or the relational model keeps
    // claims the blob no longer has. `undefined` is the different case (tier-2
    // salvage, where only the bio string survived parsing): the blob KEEPS its
    // previous claims, so the mirror must leave them alone. The condition
    // tracks the blob's own exactly.
    if (rep.bioClaims) {
      await this.mirrorClaims(
        {
          subjectType: 'representative',
          subjectId: updated.id,
          claims: normaliseBioClaims(rep.bioClaims),
          sourceText: null,
          sourceTextHash: null,
        },
        // `error`, not `warn`: the claims were not written. A systematic
        // failure here is otherwise invisible until something reads the
        // tables, which nothing does yet (#1296).
        (message) => this.logger.error(message),
      );
    }
  }

  /**
   * Generate a bio for a single representative via the prompt service + LLM.
   */
  private async generateBio(
    rep: Representative,
  ): Promise<
    { parsed: BioResponse; provenance: AiOutputProvenance } | undefined
  > {
    const structuredText = this.formatRepData(rep);

    // Full destructure on purpose (#1149): dropping hash/version here is
    // what left every persisted bio unattributable.
    const prompt = await this.promptClient!.getDocumentAnalysisPrompt({
      documentType: 'representative-bio',
      text: structuredText,
    });
    const { promptText } = prompt;

    const result = await this.llm!.generate(promptText, {
      maxTokens: this.maxTokens,
      temperature: 0.2,
    });

    const parsed = this.parseBioFromResponse(result.text);
    if (!parsed) return undefined;
    const guarded = this.enforceSourceYears(rep, structuredText, parsed);
    if (!guarded) return undefined;
    this.logClaimsSummary(rep, guarded);
    return { parsed: guarded, provenance: await this.outputProvenance(prompt) };
  }

  /**
   * Format representative data as key-value text for the prompt.
   * Deliberately omits committee assignments: the bio's sibling
   * "At a glance" summary covers those, and including committees in
   * the bio input causes the LLM to write about them regardless of
   * prompt instructions, bloats output, and correlates with JSON
   * truncation. See #594 Task 4.
   *
   * CRITICAL: jurisdiction (state) is plumbed explicitly. Without it,
   * the LLM disambiguates Name+Chamber+District by guessing a state
   * and hallucinates biographies of wrong-state namesakes. We derive
   * the jurisdiction from externalId (e.g., "ca-assembly-4" → California).
   */
  private formatRepData(rep: Representative): string {
    const jurisdiction = this.deriveJurisdiction(rep);

    // A field with no value is OMITTED, never rendered as its own absence.
    // Template interpolation turned a null party into the literal line
    // "Party: null", and California's county offices are non-partisan — all
    // five Sonoma supervisors have no party. Handing "null" to a prompt whose
    // whole design is "state only what the source states" invites it either
    // to copy the word into the bio or to supply a party of its own.
    const fields: [string, string | null | undefined][] = [
      ['Name', rep.name],
      ['Jurisdiction', jurisdiction],
      ['District', rep.district],
      ['Party', rep.party],
    ];

    return fields
      .filter(([, value]) => value != null && String(value).trim() !== '')
      .map(([label, value]) => `${label}: ${String(value).trim()}`)
      .join('\n');
  }

  /**
   * Derive a human-readable jurisdiction label from the rep's
   * externalId prefix + chamber. Gives the LLM enough context to
   * refuse or correctly identify a representative.
   */
  private deriveJurisdiction(rep: Representative): string {
    if (!this.activeRegionName) {
      // Federal or unknown — fall back to bare chamber so the prompt
      // can still decide whether to trust training knowledge.
      return rep.chamber;
    }
    // County regions (e.g. "Sonoma County") don't need "State" inserted —
    // "Sonoma County Board of Supervisors" is already correct.
    const isCounty = /county/i.test(this.activeRegionName);
    return isCounty
      ? `${this.activeRegionName} ${rep.chamber}`
      : `${this.activeRegionName} State ${rep.chamber}`;
  }

  /**
   * Drop any bio sentence asserting a year the source data does not contain.
   *
   * The prompt forbids this and still does it — see
   * {@link dropUnsupportedSentences} for the measurement. An invented
   * election year is the most common unsupported fact this generator emits
   * and among the easiest for a reader to mistake for a checked one, so it
   * is enforced here rather than hoped for.
   *
   * @returns The guarded response, or undefined if nothing survived
   */
  private enforceSourceYears(
    rep: Representative,
    sourceText: string,
    parsed: BioResponse,
  ): BioResponse | undefined {
    const guarded = dropUnsupportedSentences(
      parsed.bio,
      sourceText,
      parsed.claims,
    );
    if (guarded.dropped.length === 0) return parsed;

    this.logger.warn(
      `Bio for ${rep.name}: dropped ${guarded.dropped.length} sentence(s) ` +
        `asserting a fact absent from the source data — ` +
        guarded.dropped
          .map((d) => `[${d.reasons.join('+')}] ${JSON.stringify(d.sentence)}`)
          .join(', '),
    );

    if (!guarded.bio) {
      // Every sentence was unsupported, so there is no bio to store. Leaving
      // the rep without one is the honest outcome; a bio generated from
      // nothing is the failure this guard exists to catch.
      this.logger.warn(
        `Bio for ${rep.name}: no sentences survived the source-year check, ` +
          `storing no bio`,
      );
      return undefined;
    }

    return {
      ...parsed,
      bio: guarded.bio,
      claims: guarded.claims,
      // wordCount came from the model and described the text before the
      // guard ran; recount rather than persist a figure the bio contradicts.
      wordCount: guarded.bio.trim().split(/\s+/).length,
    };
  }

  /**
   * Parse the bio response from the LLM using a two-tier strategy so that
   * we get "something sane" even when the model emits malformed JSON or
   * truncated output.
   *
   * Tier 1 — full structured parse (ideal): extract { bio, wordCount,
   *   claims[] } from a balanced JSON block. Full claim-tagging preserved.
   *
   * Tier 2 — bio-only fallback: if JSON parse fails (truncation, rogue
   *   escapes, whatever), extract just the bio string directly. The bio
   *   is the only field we currently persist, so this salvages a usable
   *   bio whenever the model got that far before going sideways.
   *   Claims are logged-only today (#602) — don't let their fragility
   *   block bio persistence.
   *
   * Returns undefined only when neither tier finds a usable bio string.
   */
  private parseBioFromResponse(text: string): BioResponse | undefined {
    // Tier 1: full structured parse
    const candidate = extractJsonObjectSlice(text);
    if (candidate) {
      try {
        const parsed = JSON.parse(candidate) as {
          bio?: string;
          wordCount?: number;
          claims?: BioClaim[];
        };
        const bio = parsed.bio?.trim();
        if (bio && bio.length > 0) {
          return {
            bio,
            wordCount: parsed.wordCount,
            claims: Array.isArray(parsed.claims) ? parsed.claims : undefined,
            parseTier: 'full',
          };
        }
      } catch {
        // fall through to Tier 2
      }
    }

    // Tier 2: bio-only salvage
    const salvagedBio = extractFieldString(text, 'bio');
    if (salvagedBio && salvagedBio.length > 0) {
      this.logger.debug(
        `Bio parse tier-2 salvage: extracted ${salvagedBio.length}-char bio from ${text.length}-char response (JSON was malformed or truncated)`,
      );
      return { bio: salvagedBio, parseTier: 'bio-only' };
    }

    const head = text.slice(0, 80).replaceAll('\n', ' ');
    const tail = text.slice(-80).replaceAll('\n', ' ');
    this.logger.debug(
      `Bio parse failed entirely (both tiers): ${text.length}-char response. Head: "${head}..." Tail: "...${tail}"`,
    );
    return undefined;
  }

  /**
   * Log claim-level attribution so we can audit source vs. training-origin
   * facts without yet persisting them. Storage + UI tracked in #602.
   */
  private logClaimsSummary(rep: Representative, parsed: BioResponse): void {
    if (parsed.parseTier === 'bio-only') {
      this.logger.debug(
        `Bio for ${rep.name}: tier-2 salvage (bio only, claims dropped)`,
      );
      return;
    }
    const claims = parsed.claims ?? [];
    if (claims.length === 0) {
      this.logger.debug(`Bio for ${rep.name}: no claims returned by LLM`);
      return;
    }
    const sourceCount = claims.filter((c) => c.origin === 'source').length;
    const trainingCount = claims.filter((c) => c.origin === 'training').length;
    this.logger.debug(
      `Bio for ${rep.name}: ${claims.length} claims (${sourceCount} source, ${trainingCount} training), ${parsed.wordCount ?? 'unknown'} words`,
    );
  }
}

interface BioResponse {
  bio: string;
  wordCount?: number;
  claims?: BioClaim[];
  parseTier: 'full' | 'bio-only';
}
