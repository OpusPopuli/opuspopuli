import { Injectable, Logger } from '@nestjs/common';
import {
  extractFieldString,
  extractJsonObjectSlice,
  stableHash,
  type BioClaim,
  type Representative,
} from '@opuspopuli/common';
import { Prisma } from '@opuspopuli/relationaldb-provider';
import { dropUnsupportedSentences } from './bio-source-guard';
import { normaliseBioClaims } from './claim-normalisers';
import { readOptionalPositiveInt, readPositiveInt } from './config-helpers';
import { AiOutputProvenance, LlmGeneratorBase } from './llm-generator.base';
import {
  outputCurrency,
  partitionStale,
  type GeneratedOutputOutcome,
  type LiveOutputKey,
  type OutputCurrency,
  type OutputTarget,
} from './generated-output-key';

/** Bumped when what this generator stores changes shape (the source-year guard included). */
const BIO_GENERATOR_VERSION = 'bio-1';

/** The config axis of the skip key: everything that shapes what is stored. */
export function bioConfigHash(maxTokens: number): string {
  return stableHash({
    generator: BIO_GENERATOR_VERSION,
    maxTokens,
    temperature: 0.2,
  });
}

const BIO_TEMPLATE = 'document-analysis-representative-bio';

/**
 * Whether the roster lists this seat as vacant ("Member Vacant", "Vacant").
 * The only case in which an empty bio is an answer rather than a failure.
 */
export function isVacantSeat(name: string | null | undefined): boolean {
  return /\bvacant\b/i.test(name ?? '');
}

/** What a bio's key and input are read from. */
const BIO_SELECT = {
  id: true,
  externalId: true,
  name: true,
  chamber: true,
  district: true,
  party: true,
  regionId: true,
  bio: true,
  bioSource: true,
  bioPromptHash: true,
  bioLlmDigest: true,
  bioSourceHash: true,
  bioConfigHash: true,
} as const;

interface BioRow {
  id: string;
  externalId: string;
  name: string;
  chamber: string;
  district: string | null;
  party: string | null;
  regionId: string | null;
  bio: string | null;
  bioSource: string | null;
  bioPromptHash: string | null;
  bioLlmDigest: string | null;
  bioSourceHash: string | null;
  bioConfigHash: string | null;
}

/**
 * The rep a bio is generated for — mapped, not cast: `Representative`
 * declares `district` and `party` as plain strings and `regionId` as
 * `string | undefined`, while all three are nullable in the database
 * (Sonoma's supervisors carry no party; county offices are non-partisan).
 * `formatRepData` omits an empty field rather than rendering "Party: null".
 */
function toRepresentative(row: BioRow): Representative {
  return {
    externalId: row.externalId,
    name: row.name,
    chamber: row.chamber,
    district: row.district ?? '',
    party: row.party ?? '',
    regionId: row.regionId ?? undefined,
  };
}

/**
 * Sentinels the pipeline writes where a value is simply not known.
 *
 * `domain-mapper.service.ts` defaults an unscraped party to "Unknown"; a
 * region id that could not be resolved becomes "unknown". Neither is a fact,
 * and a prompt told to state only what the source states will state them.
 */
const ABSENT_VALUES = new Set(['unknown', 'n/a', 'none', 'null', 'undefined']);

/** Whether a field carries something a bio may actually assert. */
function isPresent(value: string | null | undefined): boolean {
  if (value == null) return false;
  const trimmed = value.trim();
  return trimmed !== '' && !ABSENT_VALUES.has(trimmed.toLowerCase());
}

/**
 * Generates AI bios for representatives that lack a scraped biography.
 *
 * Uses structured public record data (name, chamber, district, party,
 * committee assignments) to prompt the LLM for a factual biography.
 *
 * Tunable via env vars (useful for dev/prod balance):
 * - BIO_GENERATOR_MAX_TOKENS (default 800) — LLM output budget per bio
 * - BIO_GENERATOR_CONCURRENCY (default 1) — how many bios to generate in parallel
 *   on the in-process path (`enrichBios`). The sync queues bios instead
 *   (`representative-bio`), bounded by the queue worker and the GPU lane
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
    const scope = this.resolveScope(regionId, reps);
    const { pending } = await this.selectStale(
      regionName,
      scope,
      maxRepsOverride,
    );
    if (pending.length > 0) {
      const generated = await this.runBatchGeneration(pending, regionName);
      this.applyTo(reps, generated);
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
   * Reps in scope whose AI bio is stale on some axis — or missing — up to the
   * cap, and how many are current. A scraped bio is never a candidate. A
   * legacy bio (the live prompt and weights, no input or config hash yet) is
   * stamped current (owner, 2026-10-27). Before Phase B a bio was written once
   * and never again, whatever changed.
   *
   * @param regionName - The sync's region display name, for the jurisdiction
   * @param scope - The region id to select in, or undefined for all
   * @param maxRepsOverride - Per-call cap over BIO_GENERATOR_MAX_REPS
   */
  async selectStale(
    regionName: string | undefined,
    scope: string | undefined,
    maxRepsOverride?: number,
  ): Promise<{ pending: OutputTarget[]; current: number }> {
    if (!this.db) {
      this.logger.warn(
        'No DbService available — cannot select bio candidates from the database',
      );
      return { pending: [], current: 0 };
    }
    if (!this.promptClient || !this.llm) return { pending: [], current: 0 };
    await this.loadRegionNames();
    const cap = this.resolveCap(maxRepsOverride);
    const rows: BioRow[] = await this.db.representative.findMany({
      where: {
        deletedAt: null,
        ...(scope ? { regionId: scope } : {}),
        // Missing, or ours — never a scraped bio.
        OR: [{ bio: null }, { bio: '' }, { bioSource: 'ai-generated' }],
      },
      select: BIO_SELECT,
      // A capped run takes the same reps each time — `findMany` guarantees
      // no ordering, and an unordered cap would cover a different slice.
      orderBy: { externalId: 'asc' },
    });

    return partitionStale(rows, {
      assess: (row) => this.assess(row, regionName),
      stamp: (row, live) => this.stamp(row.id, live),
      target: (row, key) => ({ id: row.id, key }),
      cap,
    });
  }

  /**
   * One rep's bio — the `representative-bio` job (S4). Re-checks currency
   * first, and never touches a scraped bio. A transient LLM failure throws,
   * so the queue retries it.
   *
   * @param regionName - The sync's region display name, for the jurisdiction
   */
  async generateOne(
    id: string,
    regionName: string | undefined,
  ): Promise<GeneratedOutputOutcome> {
    return (await this.generateAndPersist(id, regionName)).outcome;
  }

  /** {@link generateOne}, also handing back the rep it generated for. */
  private async generateAndPersist(
    id: string,
    regionName: string | undefined,
  ): Promise<{ outcome: GeneratedOutputOutcome; rep?: Representative }> {
    if (!this.db || !this.promptClient || !this.llm) {
      return { outcome: 'skipped' };
    }
    const row: BioRow | null = await this.db.representative.findFirst({
      where: { id, deletedAt: null },
      select: BIO_SELECT,
    });
    if (!row) return { outcome: 'skipped' };
    if (row.bio && row.bioSource !== 'ai-generated') {
      return { outcome: 'skipped' };
    }
    await this.loadRegionNames();
    const { live, currency } = await this.assess(row, regionName);
    if (currency !== 'stale') {
      if (currency === 'legacy') await this.stamp(id, live);
      return { outcome: 'unchanged' };
    }

    const rep = toRepresentative(row);
    const generated = await this.generateBio(rep, regionName);
    if (generated?.parsed === null && isVacantSeat(row.name)) {
      // A vacant seat has no one to write about. Recorded with its key, so
      // the seat is not asked about again until its input changes (someone
      // fills it); retrying an identical prompt every sync was two LLM calls
      // and two errors a run. The seat is vacant because the ROSTER says so —
      // an empty answer for a sitting member is a model error, and must not
      // delete their bio (below).
      await this.recordDecline(row, generated.provenance, live);
      return { outcome: 'skipped' };
    }
    if (!generated?.parsed?.bio) {
      // Nothing usable: unparseable, every sentence dropped by the
      // source-year guard, or an empty answer for a seat that is not vacant.
      // Nothing stored and no key recorded, so the next sync asks again.
      return { outcome: 'failed' };
    }
    rep.bio = generated.parsed.bio;
    rep.bioSource = 'ai-generated';
    // The full claims array (#602); undefined on tier-2 salvage, where only
    // the bio string survived parsing — and `persistBio` then clears the
    // stored claims rather than keep the last generation's.
    rep.bioClaims = generated.parsed.claims;
    await this.persistBio(id, rep, generated.provenance, live);
    return { outcome: row.bio ? 'updated' : 'created', rep };
  }

  /** The live key — over exactly the prompt's input — and how the stored bio compares. */
  private async assess(
    row: BioRow,
    regionName: string | undefined,
  ): Promise<{ live: LiveOutputKey; currency: OutputCurrency }> {
    const live = await this.liveOutputKey(
      BIO_TEMPLATE,
      this.formatRepData(toRepresentative(row), regionName),
      bioConfigHash(this.maxTokens),
    );
    const currency = outputCurrency(
      {
        promptHash: row.bioPromptHash,
        llmDigest: row.bioLlmDigest,
        sourceHash: row.bioSourceHash,
        configHash: row.bioConfigHash,
      },
      live,
    );
    return { live, currency };
  }

  /** Record a legacy bio's input and config as current (decision 2). */
  private async stamp(id: string, live: LiveOutputKey): Promise<void> {
    await this.db!.representative.update({
      where: { id },
      data: { bioSourceHash: live.sourceHash, bioConfigHash: live.configHash },
    });
  }

  /**
   * Display name per region id, read once per run from `region_plugins`.
   *
   * Empty when no database is bound, in which case {@link deriveJurisdiction}
   * falls back to the active plugin's name as before.
   */
  private readonly regionNames = new Map<string, string>();
  private regionNamesAt = 0;

  /** At most once a minute — every job used to re-read the table. */
  private async loadRegionNames(): Promise<void> {
    if (!this.db) return;
    if (Date.now() - this.regionNamesAt < 60_000) return;
    this.regionNamesAt = Date.now();
    const rows = await this.db.regionPlugin.findMany({
      select: { name: true, displayName: true },
    });
    this.regionNames.clear();
    for (const row of rows) this.regionNames.set(row.name, row.displayName);
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
  resolveScope(
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
   * Copy generated bios onto the scraped batch, matched by `externalId`, so
   * callers holding `reps` — and the phases after this one — see them. A rep
   * absent from `reps` (the roster-flake case #1394 covers) simply has
   * nothing to copy onto.
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
   * Generate the stale bios in this process, `BIO_GENERATOR_CONCURRENCY` at a
   * time — the inline path, when the `representative-bio` queue is off.
   * One failed rep does not cancel its batch peers.
   */
  private async runBatchGeneration(
    pending: OutputTarget[],
    regionName: string | undefined,
  ): Promise<Representative[]> {
    this.logger.log(
      `Generating AI bios for ${pending.length} representatives (concurrency=${this.concurrency}, maxTokens=${this.maxTokens})`,
    );
    const results = await this.runInBatches(
      pending,
      this.concurrency,
      (target) => this.generateAndPersist(target.id, regionName),
      (target, error) => {
        this.logger.warn(
          `Bio generation failed for ${target.id}: ${error.message}`,
        );
        return { outcome: 'failed' as const, rep: undefined };
      },
    );
    const generated = results.flatMap(({ rep }) => (rep ? [rep] : []));
    this.logger.log(
      `Generated ${generated.length}/${pending.length} AI bios successfully`,
    );
    return generated;
  }

  /**
   * A declined bio: the key and attribution of the answer "nothing", and no
   * bio. A seat that falls vacant still carries its last member's AI bio, so
   * that bio is cleared and its claims superseded — the generator just said
   * there is no one to describe.
   */
  private async recordDecline(
    row: BioRow,
    provenance: AiOutputProvenance,
    live: LiveOutputKey,
  ): Promise<void> {
    const hadBio = Boolean(row.bio);
    await this.db!.representative.update({
      where: { id: row.id },
      data: {
        ...(hadBio && {
          bio: null,
          bioSource: null,
          bioClaims: Prisma.DbNull,
        }),
        bioPromptHash: provenance.promptHash,
        bioPromptVersion: provenance.promptVersion,
        bioLlmModel: provenance.llmModel,
        bioLlmDigest: provenance.llmModelDigest,
        bioSourceHash: live.sourceHash,
        bioConfigHash: live.configHash,
        bioGeneratedAt: new Date(),
      },
    });
    if (hadBio) {
      await this.mirrorClaims(
        {
          subjectType: 'representative',
          subjectId: row.id,
          claims: [],
          sourceText: null,
          sourceTextHash: null,
        },
        (message) => this.logger.error(message),
      );
    }
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
    id: string,
    rep: Representative,
    provenance: AiOutputProvenance,
    live: LiveOutputKey,
  ): Promise<void> {
    if (!this.db) {
      this.logger.warn(
        `No DbService available — generated bio for ${rep.name} not persisted`,
      );
      return;
    }
    await this.db.representative.update({
      where: { externalId: rep.externalId },
      data: {
        bio: rep.bio,
        bioSource: rep.bioSource,
        bioClaims: rep.bioClaims
          ? (rep.bioClaims as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        bioPromptHash: provenance.promptHash,
        bioPromptVersion: provenance.promptVersion,
        bioLlmModel: provenance.llmModel,
        bioLlmDigest: provenance.llmModelDigest,
        bioSourceHash: live.sourceHash,
        bioConfigHash: live.configHash,
        bioGeneratedAt: new Date(),
      },
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
    // Always, and always matching the blob: the claims describe the bio just
    // written or none at all. Tier-2 salvage (only the bio string survived
    // parsing, `bioClaims` undefined) used to KEEP the previous claims, which
    // was right while a bio was written once — now a bio is regenerated when
    // its key moves, and keeping them would attach the last generation's
    // claims to text that no longer says them.
    await this.mirrorClaims(
      {
        subjectType: 'representative',
        subjectId: id,
        claims: rep.bioClaims ? normaliseBioClaims(rep.bioClaims) : [],
        sourceText: null,
        sourceTextHash: null,
      },
      // `error`, not `warn`: the claims were not written. A systematic
      // failure here is otherwise invisible until something reads the
      // tables, which nothing does yet (#1296).
      (message) => this.logger.error(message),
    );
  }

  /**
   * Generate a bio for a single representative via the prompt service + LLM.
   *
   * @returns `parsed: null` when the model returned a well-formed, empty bio
   *   — a decline, not a failure; undefined when nothing usable came back
   */
  private async generateBio(
    rep: Representative,
    regionName: string | undefined,
  ): Promise<
    { parsed: BioResponse | null; provenance: AiOutputProvenance } | undefined
  > {
    const structuredText = this.formatRepData(rep, regionName);

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
    if (parsed === null) {
      return { parsed, provenance: await this.outputProvenance(prompt) };
    }
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
  private formatRepData(
    rep: Representative,
    activeRegionName: string | undefined,
  ): string {
    const jurisdiction = this.deriveJurisdiction(rep, activeRegionName);

    // A field with no value is OMITTED, never rendered as its own absence.
    // Template interpolation turned a null party into the literal line
    // "Party: null", and the domain mapper defaults a missing party to the
    // string "Unknown" (`domain-mapper.service.ts`, `.default("Unknown")`).
    // Both are sentinels, and handing either to a prompt whose whole design
    // is "state only what the source states" gets them reported as fact:
    // measured on the Sonoma supervisors, who are non-partisan, the bios
    // came back "She is listed as Unknown party." A reader cannot tell that
    // from a party called Unknown.
    const fields: [string, string | null | undefined][] = [
      ['Name', rep.name],
      ['Jurisdiction', jurisdiction],
      ['District', rep.district],
      ['Party', rep.party],
    ];

    return fields
      .filter(([, value]) => isPresent(value))
      .map(([label, value]) => `${label}: ${String(value).trim()}`)
      .join('\n');
  }

  /**
   * Derive a human-readable jurisdiction label from the rep's
   * externalId prefix + chamber. Gives the LLM enough context to
   * refuse or correctly identify a representative.
   */
  private deriveJurisdiction(
    rep: Representative,
    activeRegionName: string | undefined,
  ): string {
    // The rep's OWN region names its jurisdiction, not the sync's active
    // plugin. `getPluginRegionName()` returns the parent — "California" —
    // for a county sync, so the county test below failed and five Sonoma
    // supervisors were told they sit on the "California State Board of
    // Supervisors", a body that does not exist.
    const regionName = this.regionNames.get(rep.regionId ?? '');
    if (regionName) {
      return /county/i.test(regionName)
        ? `${regionName} ${rep.chamber}`
        : `${regionName} State ${rep.chamber}`;
    }

    if (!activeRegionName) {
      // Federal or unknown — fall back to bare chamber so the prompt
      // can still decide whether to trust training knowledge.
      return rep.chamber;
    }
    // County regions (e.g. "Sonoma County") don't need "State" inserted —
    // "Sonoma County Board of Supervisors" is already correct.
    const isCounty = /county/i.test(activeRegionName);
    return isCounty
      ? `${activeRegionName} ${rep.chamber}`
      : `${activeRegionName} State ${rep.chamber}`;
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
   * Returns null for a well-formed response whose bio is empty — the model
   * declining, as for a vacant seat — and undefined when neither tier finds
   * a usable bio string.
   */
  private parseBioFromResponse(text: string): BioResponse | null | undefined {
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
        if (typeof parsed.bio === 'string' && bio === '') return null;
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
