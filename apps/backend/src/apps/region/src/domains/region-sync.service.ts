import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DataType,
  SyncDepth,
  SyncResult,
  PluginRegistryService,
  DeclarativeRegionPlugin,
  type IPipelineService,
  type IRegionPlugin,
} from '@opuspopuli/region-provider';
import {
  batchTransaction,
  extractJsonObjectSlice,
  type Proposition,
  type Meeting,
  type Representative,
  type CampaignFinanceResult,
  type MinutesWithActions,
  type ILLMProvider,
  type DataSourceConfig,
  type DeclarativeRegionConfig,
  type Bill,
  type BillVotePosition,
} from '@opuspopuli/common';
import {
  PromptClientService,
  type LifecycleStageInput,
} from '@opuspopuli/prompt-client';
import { BioGeneratorService } from './bio-generator.service';
import { PropositionsSyncService } from './propositions-sync.service';
import { MeetingsSyncService } from './meetings-sync.service';
import { RepresentativesSyncService } from './representatives-sync.service';
import { CampaignFinanceSyncService } from './campaign-finance-sync.service';
import { CivicsSyncService } from './civics-sync.service';
import {
  RegionPluginService,
  type RegionPluginRow,
} from './region-plugin.service';
import { CommitteeSummaryGeneratorService } from './committee-summary-generator.service';
import { PropositionAnalysisService } from './proposition-analysis.service';
import { PropositionFinanceLinkerService } from './proposition-finance-linker.service';
import { LegislativeCommitteeLinkerService } from './legislative-committee-linker.service';
import { LegislativeActionLinkerService } from './legislative-action-linker.service';
import { LegislativeCommitteeService } from './legislative-committee.service';
import { LegislativeCommitteeDescriptionGeneratorService } from './legislative-committee-description-generator.service';
import { HostThrottle, fetchTextWithRetry } from './resilient-fetch';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  isBillDead,
  isBillActive,
  computeActiveCaSessionYears,
} from './bill-lifecycle';
import { RegionInfoModel, DataTypeGQL } from './models/region-info.model';
import { RegionCacheService } from './region-cache.service';
import { deriveDistrictFromExternalId } from './region.service';
import {
  billSyncTracker,
  type SyncPhaseTracker,
  type BillSyncPhase,
} from './sync-phase-logger';
import { readPositiveInt } from './config-helpers';

/**
 * Parse "AB 96" out of the externalId "202520260AB96" (CA leginfo format)
 * so per-item log lines can show the operator-readable bill number even
 * before the page content has been fetched / parsed. Returns null when
 * the pattern doesn't match — the per-item line falls back to "--".
 */
/**
 * Pull the plain-language reading out of a CivicText-shaped JSONB blob
 * ({ verbatim, plainLanguage }). Empty string when the field is missing
 * or malformed — callers decide whether to substitute a fallback. Used
 * to build per-region taxonomy inputs for the bill-status-summary
 * prompt (#823).
 */
/**
 * Parse the merged status-summary `status.lastActionDate` (ISO YYYY-MM-DD
 * or null) into the value to write back to `bills.lastActionDate`.
 *
 * Returns:
 *   - a Date when the string parses cleanly
 *   - null when the LLM explicitly returned null (intentional clear)
 *   - undefined when the field was absent OR the string is unparseable —
 *     callers spread this with `...(date !== undefined ? { lastActionDate: date } : {})`
 *     so the existing column value is preserved instead of being clobbered
 *     with null.
 */
function parseLastActionDate(
  raw: string | null | undefined,
): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function extractPlainLanguage(field: unknown): string {
  if (!field || typeof field !== 'object') return '';
  const plain = (field as Record<string, unknown>)['plainLanguage'];
  return typeof plain === 'string' ? plain : '';
}

function billNumberFromExternalId(
  externalId: string | undefined,
): string | null {
  if (!externalId) return null;
  // Trailing alphabetic measure code (AB, SB, ACA, SCR, AJR, SJR, ...)
  // + trailing decimal number. Anchored to end so we don't accidentally
  // match the session-year digits.
  const m = externalId.match(/([A-Z]{1,4})(\d+)$/);
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

/**
 * Distinct outcomes of a single votes_only page extraction (#889). Kept
 * granular so the phase summary reports the real distribution rather than
 * the previous blanket "no bill shell yet".
 */
type VotesOutcome =
  | 'votes-upserted'
  | 'no-bill-id'
  | 'shell-missing'
  | 'providers-unavailable'
  | 'fetch-failed'
  | 'no-votes-on-page'
  // Split out from a blanket 'extraction-failed' (#894) so the phase summary
  // distinguishes truncation (empty/unparseable — raise BILL_VOTES_MAX_TOKENS)
  // from genuine post-parse errors.
  | 'extraction-empty'
  | 'extraction-unparseable'
  | 'extraction-failed';

interface VotesExtractionResult {
  outcome: VotesOutcome;
  /** Number of per-member vote rows upserted; 0 for every non-success outcome. */
  count: number;
}

/**
 * Maps each votes outcome onto its phase-tracker counter bucket. Success →
 * 'updated'; genuine failures (providers down, fetch/extraction errors) →
 * 'error'; benign no-ops (missing shell, no votes on page, unparseable URL)
 * → 'skipped'. The outcome string itself is also passed as an extraCounter
 * so the summary breaks the total down by reason.
 */
const VOTES_OUTCOME_TRACKING: Record<
  VotesOutcome,
  { counter: 'updated' | 'skipped' | 'error' }
> = {
  'votes-upserted': { counter: 'updated' },
  'no-bill-id': { counter: 'skipped' },
  'shell-missing': { counter: 'skipped' },
  'no-votes-on-page': { counter: 'skipped' },
  'providers-unavailable': { counter: 'error' },
  'fetch-failed': { counter: 'error' },
  'extraction-empty': { counter: 'error' },
  'extraction-unparseable': { counter: 'error' },
  'extraction-failed': { counter: 'error' },
};

/** One chamber-level roll-call record in a bill-votes-extraction response. */
interface RollCallRecord {
  chamber?: string;
  date?: string;
  motionText?: string;
  yesCount?: number;
  noCount?: number;
  members?: Array<{ name?: string; position?: string; party?: string }>;
}

/** Raw shape emitted by the bill-votes-extraction prompt (chamber roll-call). */
interface RollCallExtraction {
  skip?: boolean;
  votes?: RollCallRecord[];
}

/** Outcome of enriching a single bill (summarize phase). */
type EnrichmentOutcome = 'enriched' | 'skipped' | 'failed';

const VALID_VOTE_POSITIONS: ReadonlySet<string> = new Set<BillVotePosition>([
  'yes',
  'no',
  'abstain',
  'absent',
  'excused',
  'no_vote',
]);

/**
 * Coerce a raw LLM position string to a valid BillVotePosition, or null when
 * unrecognized (so the member row is dropped, never fabricated).
 */
function normalizeVotePosition(
  raw: string | undefined,
): BillVotePosition | null {
  if (!raw) return null;
  const v = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return VALID_VOTE_POSITIONS.has(v) ? (v as BillVotePosition) : null;
}

/**
 * Reduce a committee name to its core policy area for fuzzy matching. The LLM
 * extracts verbose page strings ("Assembly Committee on Appropriations",
 * "Committee on Public Safety") while legislative_committees stores short
 * canonical names ("Appropriations", "Public Safety"), so an exact match linked
 * almost nothing (#908). Strips chamber/qualifier words + the "committee (on)"
 * boilerplate and collapses whitespace. Applied to BOTH sides so the comparison
 * is symmetric; returns '' when a name is only boilerplate (never aliased).
 */
export function normalizeCommitteeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(
      /\b(assembly|senate|joint|select|standing|legislative|subcommittee|committee|on)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map the enrich-single-bill result onto a phase tracker outcome shape.
 * Lifted to a named helper so the call site avoids two nested ternaries
 * (one for label, one for counter bucket) — sonarjs/no-nested-conditional
 * trips on the inline form.
 */
function describeEnrichmentResult(
  outcome: EnrichmentOutcome,
  tokensUsed: number,
): {
  outcomeLabel: string;
  outcome: 'created' | 'updated' | 'skipped' | 'error';
} {
  if (outcome === 'enriched') {
    return {
      outcomeLabel: `enriched (${tokensUsed} tokens)`,
      outcome: 'updated',
    };
  }
  if (outcome === 'skipped') {
    return { outcomeLabel: 'skipped: no fullTextUrl', outcome: 'skipped' };
  }
  return { outcomeLabel: 'failed', outcome: 'error' };
}

// ─── Type aliases (sync-local, not exported) ─────────────────────────────────

type ExternalIdRecord = { externalId: string };

/** Compiled lifecycle stage pattern used for bill status resolution. */
interface StagePattern {
  stageId: string;
  regex: RegExp;
}

/** Minimal Bill row shape needed by the inner sync-loop skip checks.
 *  Loaded once per region via `loadBillSkipMetadata` to avoid N+1 reads. */
interface BillSkipRecord {
  id: string;
  externalId: string;
  sourcePublishedAt: Date | null;
  lastAction: string | null;
  lastActionDate: Date | null;
  needsStatusRecheck: boolean;
}

/** Region plugin row shape returned by list/lookup queries. */
/**
 * Minimal interface for data fetching used by sync methods.
 * Satisfied by both RegionProviderService and IRegionPlugin.
 */
interface DataFetcher {
  fetchPropositions(pipelineJobId?: string): Promise<Proposition[]>;
  fetchMeetings(pipelineJobId?: string): Promise<Meeting[]>;
  fetchRepresentatives(): Promise<Representative[]>;
  fetchCampaignFinance?(
    onBatch?: (items: Record<string, unknown>[]) => Promise<void>,
    pipelineJobId?: string,
  ): Promise<CampaignFinanceResult>;
  fetchMeetingMinutes?(): Promise<MinutesWithActions[]>;
  getName?(): string;
  getDataSources?(dataType?: DataType): DataSourceConfig[];
}

/**
 * Shape we expect from the bill-analysis LLM response. Everything is
 * optional at the runtime boundary — the LLM may drop fields, and the
 * `skip` sentinel short-circuits the rest. Stored verbatim in
 * `Bill.aiSummary` as JSONB. Consumers (ranking pipeline #743, briefing
 * UI #744) read via the typed GraphQL field added in #741.
 *
 * Post-#823 this is the inner shape of `summary` on the merged
 * bill-status-summary response — preserved byte-for-byte so existing
 * consumers (bill-relevance-explanation #745, briefing UI) keep working
 * without coordinated changes.
 */
interface BillAiSummaryShape {
  plainEnglishSummary?: string;
  topics?: string[];
  whoItAffects?: string[];
  fiscalImpact?: { level?: string; summary?: string };
  stakeholderImpact?: string;
  /** LLM sentinel: input was blank / garbled / not a bill. */
  skip?: boolean;
}

/**
 * Shape we expect from the merged bill-status-summary LLM response. The
 * `summary` block is structurally identical to {@link BillAiSummaryShape}
 * so the JSONB written to `bills.aiSummary` stays drop-in compatible with
 * existing consumers. The `status` block carries the LLM-classified stage
 * id (validated at runtime against the region's civics_blocks taxonomy)
 * + verbatim status text + last-action date + a short verbatim snippet.
 * See opuspopuli#823.
 */
interface BillStatusSummaryShape {
  status?: {
    raw?: string;
    /** A stage id from the region's lifecycleStages, or "unknown". */
    stage?: string;
    /** ISO YYYY-MM-DD; null when unparseable. */
    lastActionDate?: string | null;
    lastActionSnippet?: string | null;
  };
  summary?: BillAiSummaryShape;
  /** LLM sentinel: input was blank / garbled / not a bill. */
  skip?: boolean;
}

/**
 * Subset of Bill columns required by the enrichment loop. Derived from
 * the Prisma model so the type stays in sync with the schema — adding
 * a new column to Bill doesn't quietly break the candidate fetch.
 */
type BillEnrichmentCandidate = Prisma.BillGetPayload<{
  select: {
    id: true;
    regionId: true;
    billNumber: true;
    sessionYear: true;
    title: true;
    subject: true;
    status: true;
    authorName: true;
    fiscalImpact: true;
    fullTextUrl: true;
    currentStageId: true;
  };
}>;

/**
 * RegionSyncService — owns all data-synchronisation logic extracted from
 * the monolithic RegionDomainService (issue DEBT-030). Implements
 * OnModuleInit / OnModuleDestroy so it can perform plugin loading and
 * cache teardown just as the original class did.
 */
@Injectable()
export class RegionSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(RegionSyncService.name, {
    timestamp: true,
  });
  /** Per-host fetch throttle shared across all syncs in this process.
   *  Per-source `rateLimitOverride` values are applied to the relevant
   *  hostname by sync orchestrators before they start their loops. */
  private readonly hostThrottle = new HostThrottle(1000);

  constructor(
    private readonly regionPluginService: RegionPluginService,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly db: DbService,
    private readonly cacheService: RegionCacheService,
    @Optional()
    @Inject('SCRAPING_PIPELINE')
    private readonly pipeline?: IPipelineService,
    @Optional() private readonly bioGenerator?: BioGeneratorService,
    @Optional()
    private readonly committeeSummaryGenerator?: CommitteeSummaryGeneratorService,
    @Optional()
    private readonly propositionAnalysis?: PropositionAnalysisService,
    @Optional()
    private readonly propositionFinanceLinker?: PropositionFinanceLinkerService,
    @Optional()
    private readonly legislativeCommitteeLinker?: LegislativeCommitteeLinkerService,
    @Optional()
    private readonly legislativeCommittees?: LegislativeCommitteeService,
    @Optional()
    private readonly legislativeCommitteeDescriptions?: LegislativeCommitteeDescriptionGeneratorService,
    @Optional()
    private readonly legislativeActionLinker?: LegislativeActionLinkerService,
    @Optional() private readonly promptClient?: PromptClientService,
    @Optional()
    @Inject('LLM_PROVIDER')
    private readonly llm?: ILLMProvider,
    // Bounded-context services (#828). Optional so existing test modules
    // that build `RegionSyncService` standalone don't have to register
    // every extracted service — they can stub the small public surface
    // they actually exercise.
    @Optional()
    private readonly propositionsSyncService?: PropositionsSyncService,
    @Optional()
    private readonly meetingsSyncService?: MeetingsSyncService,
    @Optional()
    private readonly representativesSyncService?: RepresentativesSyncService,
    @Optional()
    private readonly campaignFinanceSyncService?: CampaignFinanceSyncService,
    @Optional()
    private readonly civicsSyncService?: CivicsSyncService,
    // Optional so existing standalone test modules (which don't register
    // ConfigService) resolve `undefined` → readPositiveInt returns the
    // fallback, preserving default behavior with no test-module changes.
    @Optional() private readonly config?: ConfigService,
  ) {
    // Assigned in the constructor body, not as field initializers: `config`
    // is a same-class parameter property, which TS assigns only once the
    // body runs — a field initializer reading `this.config` fails with
    // TS2729 (used-before-init). (bio-generator can use field initializers
    // because its `config` comes from a base class via super(), which
    // completes before subclass field initializers run.)
    this.billEnrichmentConcurrency = readPositiveInt(
      this.config,
      'BILL_ENRICHMENT_CONCURRENCY',
      1,
    );
    this.billEnrichmentTimeoutMs = readPositiveInt(
      this.config,
      'BILL_ENRICHMENT_REQUEST_TIMEOUT_MS',
      120_000,
    );
    this.billVotesConcurrency = readPositiveInt(
      this.config,
      'BILL_VOTES_CONCURRENCY',
      1,
    );
    this.billVotesMaxTokens = readPositiveInt(
      this.config,
      'BILL_VOTES_MAX_TOKENS',
      8000,
    );
    this.billVotesRequestTimeoutMs = readPositiveInt(
      this.config,
      'BILL_VOTES_REQUEST_TIMEOUT_MS',
      150_000,
    );
  }

  // Bill-enrichment throughput knobs (#889 follow-up). Defaults reproduce
  // the prior serial, provider-default-timeout behavior when unset.
  //  - BILL_ENRICHMENT_CONCURRENCY: bills enriched in parallel per batch.
  //    Only helps if the Ollama server also accepts parallel requests
  //    (OLLAMA_NUM_PARALLEL ≥ this); otherwise calls queue server-side.
  //  - BILL_ENRICHMENT_REQUEST_TIMEOUT_MS: per-bill LLM timeout. The
  //    provider default is too short for the node's largest full-text
  //    bills (~4.4% aborted); a generous cap converts those to successes.
  private readonly billEnrichmentConcurrency: number;
  private readonly billEnrichmentTimeoutMs: number;
  // Votes-phase (Phase 3, votes_only) throughput knob (#892). Mirrors
  // BILL_ENRICHMENT_CONCURRENCY: bills whose votes pages are fetched +
  // LLM-extracted in parallel per batch. Only helps if the Ollama server
  // also accepts parallel requests (OLLAMA_NUM_PARALLEL ≥ this); otherwise
  // calls queue server-side. Default 1 reproduces the prior serial loop.
  private readonly billVotesConcurrency: number;
  // Max output tokens for votes extraction (#894). A large roll-call
  // (an 80-member chamber × multiple motions) serializes to a votes JSON
  // that overran the prior 4000-token cap → truncated mid-object →
  // unparseable → ~33% of bills silently lost their votes. Default 8000
  // clears typical CA roll-calls; a per-source DataSourceConfig.llmMaxTokens
  // still overrides when set.
  private readonly billVotesMaxTokens: number;
  // Per-bill LLM request timeout for votes extraction (#897). The #894 bump to
  // 8000 output tokens made large roll-calls take ~100s at ~80 tok/s, which
  // overran the provider's 60s default → ~82% of bills timed out. Default
  // 150000 leaves headroom (8000 tok / ~80 tps ≈ 100s); a per-source
  // DataSourceConfig.llmRequestTimeoutMs still overrides when set.
  private readonly billVotesRequestTimeoutMs: number;

  async onModuleDestroy(): Promise<void> {
    await this.cacheService.destroy();
  }

  /**
   * Test-time compatibility shim. Plugin bootstrap moved to
   * RegionPluginService.onModuleInit (#828 Step 6); Nest invokes it
   * directly in production. The legacy spec calls `service.onModuleInit()`
   * to bootstrap the test instance, so we keep a delegate here that
   * forwards to the plugin service. Will be removed in Step 9 when the
   * test file is split.
   */
  async onModuleInit(): Promise<void> {
    return this.regionPluginService.onModuleInit();
  }

  /**
   * Plugin lifecycle (#828 Step 6) moved to RegionPluginService. The
   * remaining methods on RegionSyncService that touch plugin state read
   * via the `regionService` getter on the plugin service, and the public
   * plugin admin surface is exposed via thin delegates below so the
   * existing RegionDomainService → RegionSyncService → ... call chain
   * keeps working unchanged.
   */
  private get regionService() {
    return this.regionPluginService.getRegionService();
  }

  /** Delegate — see RegionPluginService.refreshActiveLocalPlugin (#828 Step 6). */
  async refreshActiveLocalPlugin(): Promise<void> {
    return this.regionPluginService.refreshActiveLocalPlugin();
  }

  // Plugin lifecycle methods moved to RegionPluginService below this point.
  // Originally: resolveApiKeysFromVault, onModuleInit, fetchLocalPluginConfigs,
  // reloadActiveLocalPlugin, initFederalPlugin, initLocalPlugins,
  // createFallbackPlugin, syncRegionConfigs. The block they used to occupy
  // (~220 LOC) is now in region-plugin.service.ts.

  // ─── Plugin state / admin reads ──────────────────────────────────────────────

  getRegionInfo(): RegionInfoModel {
    const info = this.regionService.getRegionInfo();
    const supportedTypes = this.regionService.getSupportedDataTypes();

    return {
      id: info.id,
      name: info.name,
      description: info.description,
      timezone: info.timezone,
      dataSourceUrls: info.dataSourceUrls,
      supportedDataTypes: supportedTypes.map(
        (t) => t as unknown as DataTypeGQL,
      ),
    };
  }

  /** Delegate — see RegionPluginService.listRegionPlugins. */
  async listRegionPlugins(): Promise<RegionPluginRow[]> {
    return this.regionPluginService.listRegionPlugins();
  }

  /** Delegate — see RegionPluginService.getPluginDataSourceConfigs. */
  async getPluginDataSourceConfigs(): Promise<
    Array<{ regionId: string; sources: DataSourceConfig[] }>
  > {
    return this.regionPluginService.getPluginDataSourceConfigs();
  }

  /** Delegate — see RegionPluginService.getRegionPluginByFipsCode. */
  async getRegionPluginByFipsCode(
    fipsCode: string,
  ): Promise<RegionPluginRow | null> {
    return this.regionPluginService.getRegionPluginByFipsCode(fipsCode);
  }

  /** Delegate — see RegionPluginService.setRegionPluginEnabled. */
  async setRegionPluginEnabled(
    name: string,
    enabled: boolean,
    cascade = false,
  ): Promise<RegionPluginRow> {
    return this.regionPluginService.setRegionPluginEnabled(
      name,
      enabled,
      cascade,
    );
  }

  /** Delegate — see RegionPluginService.invalidateManifest. */
  async invalidateManifest(
    regionId: string,
    sourceUrl: string,
  ): Promise<number> {
    return this.regionPluginService.invalidateManifest(regionId, sourceUrl);
  }

  // ─── Sync orchestration ───────────────────────────────────────────────────────

  async syncAll(
    dataTypes?: string[],
    maxReps?: number,
    maxBills?: number,
    depth: string = SyncDepth.STATE,
    scopedRegionId?: string,
    pipelineJobId?: string,
    forceStatusRecheck?: boolean,
  ): Promise<SyncResult[]> {
    // Re-read enabled plugins from the DB before every sync. The hot-swap
    // on `setRegionPluginEnabled` only fires in the *region service* process;
    // the region-worker has its own Nest instance with its own in-memory
    // registry that would otherwise drift after an admin toggle, causing
    // syncs for newly-enabled plugins to silently process 0 data types.
    await this.refreshActiveLocalPlugin();

    const limits = [
      maxReps != null ? `maxReps=${maxReps}` : null,
      maxBills != null ? `maxBills=${maxBills}` : null,
      depth !== SyncDepth.STATE ? `depth=${depth}` : null,
      scopedRegionId ? `regionId=${scopedRegionId}` : null,
      forceStatusRecheck ? 'forceStatusRecheck=true' : null,
    ].filter(Boolean);
    const limitsStr = limits.length ? ` (${limits.join(', ')})` : '';
    this.logger.log(
      dataTypes
        ? `Starting data sync for: ${dataTypes.join(', ')}${limitsStr}`
        : `Starting full data sync${limitsStr}`,
    );
    const results: SyncResult[] = [];

    const statePlugins =
      depth === SyncDepth.COUNTY
        ? []
        : this.pluginRegistry
            .getAll()
            .filter((p) => !scopedRegionId || p.name === scopedRegionId);

    for (const registered of statePlugins) {
      results.push(
        ...(await this.runPluginSync(
          registered.instance,
          registered.name,
          dataTypes,
          maxReps,
          maxBills,
          pipelineJobId,
          forceStatusRecheck,
        )),
      );
    }

    if (depth === SyncDepth.COUNTY || depth === SyncDepth.ALL) {
      results.push(
        ...(await this.syncCountyPlugins(
          dataTypes,
          maxReps,
          maxBills,
          scopedRegionId,
          pipelineJobId,
          forceStatusRecheck,
        )),
      );
    }

    this.logger.log(`Sync complete. Processed ${results.length} data type(s).`);
    return results;
  }

  private async runPluginSync(
    instance: IRegionPlugin,
    name: string,
    dataTypes?: string[],
    maxReps?: number,
    maxBills?: number,
    pipelineJobId?: string,
    forceStatusRecheck?: boolean,
  ): Promise<SyncResult[]> {
    const supported = instance.getSupportedDataTypes();
    const filtered = dataTypes
      ? supported.filter((dt) => dataTypes.includes(dt))
      : supported;
    const results: SyncResult[] = [];
    for (const dataType of filtered) {
      try {
        const result = await this.syncDataTypeFrom(
          instance,
          name,
          dataType,
          maxReps,
          maxBills,
          name,
          pipelineJobId,
          forceStatusRecheck,
        );
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to sync ${dataType} from ${name}:`, error);
        results.push({
          regionId: name,
          dataType,
          itemsProcessed: 0,
          itemsCreated: 0,
          itemsUpdated: 0,
          itemsSkipped: 0,
          errors: [(error as Error).message],
          syncedAt: new Date(),
        });
      }
    }
    return results;
  }

  private async syncCountyPlugins(
    dataTypes?: string[],
    maxReps?: number,
    maxBills?: number,
    scopedRegionId?: string,
    pipelineJobId?: string,
    forceStatusRecheck?: boolean,
  ): Promise<SyncResult[]> {
    const where = scopedRegionId
      ? { name: scopedRegionId, parentRegionId: { not: null }, enabled: true }
      : { parentRegionId: { not: null }, enabled: true };

    const countyRows = await this.db.regionPlugin.findMany({
      where,
      select: { name: true, config: true },
      orderBy: { name: 'asc' },
    });

    if (countyRows.length === 0) {
      this.logger.debug('No enabled county plugins found for sync');
      return [];
    }

    this.logger.log(`Syncing ${countyRows.length} county plugin(s)…`);
    const results: SyncResult[] = [];

    for (const row of countyRows) {
      if (!row.config) continue;
      try {
        if (!this.pipeline) {
          throw new Error(
            'ScrapingPipelineService unavailable — county sync requires a pipeline',
          );
        }
        const plugin = new DeclarativeRegionPlugin(
          row.config as unknown as DeclarativeRegionConfig,
          this.pipeline,
        );
        results.push(
          ...(await this.runPluginSync(
            plugin,
            row.name,
            dataTypes,
            maxReps,
            maxBills,
            pipelineJobId,
            forceStatusRecheck,
          )),
        );
      } catch (error) {
        this.logger.error(
          `Failed to instantiate county plugin ${row.name}:`,
          error,
        );
        results.push({
          regionId: row.name,
          dataType: DataType.REPRESENTATIVES,
          itemsProcessed: 0,
          itemsCreated: 0,
          itemsUpdated: 0,
          itemsSkipped: 0,
          errors: [(error as Error).message],
          syncedAt: new Date(),
        });
      }
    }
    return results;
  }

  async syncDataType(dataType: DataType): Promise<SyncResult> {
    return this.syncDataTypeFrom(
      this.regionService,
      this.pluginRegistry.getActiveName() ?? 'local',
      dataType,
    );
  }

  private async syncDataTypeFrom(
    provider: DataFetcher,
    pluginName: string,
    dataType: DataType,
    maxReps?: number,
    maxBills?: number,
    regionId?: string,
    pipelineJobId?: string,
    forceStatusRecheck?: boolean,
  ): Promise<SyncResult> {
    this.logger.log(`Syncing ${dataType} from ${pluginName}`);
    const startTime = Date.now();

    const syncHandlers: Partial<
      Record<
        DataType,
        () => Promise<{
          processed: number;
          created: number;
          updated: number;
          skipped?: number;
        }>
      >
    > = {
      [DataType.PROPOSITIONS]: () =>
        this.syncPropositions(provider, pipelineJobId),
      [DataType.MEETINGS]: () => this.syncMeetings(provider, pipelineJobId),
      [DataType.REPRESENTATIVES]: () =>
        this.syncRepresentatives(provider, maxReps, regionId),
      [DataType.CAMPAIGN_FINANCE]: () =>
        this.syncCampaignFinance(provider, pipelineJobId),
      [DataType.CIVICS]: () => this.syncCivics(provider),
      [DataType.BILLS]: () =>
        this.syncBills(maxBills, provider, forceStatusRecheck),
    };

    const handler = syncHandlers[dataType];
    if (!handler) {
      this.logger.warn(`No sync handler for data type: ${dataType}`);
      return {
        regionId: pluginName,
        dataType,
        itemsProcessed: 0,
        itemsCreated: 0,
        itemsUpdated: 0,
        itemsSkipped: 0,
        errors: [`No sync handler for data type: ${dataType}`],
        syncedAt: new Date(),
      };
    }
    const { processed, created, updated, skipped = 0 } = await handler();

    const duration = Date.now() - startTime;
    const skippedStr = skipped > 0 ? `, ${skipped} skipped` : '';
    this.logger.log(
      `Synced ${dataType} from ${pluginName}: ${processed} items (${created} created, ${updated} updated${skippedStr}) in ${duration}ms`,
    );

    return {
      regionId: pluginName,
      dataType,
      itemsProcessed: processed,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsSkipped: skipped,
      errors: [],
      syncedAt: new Date(),
    };
  }

  // ─── upsert helper ────────────────────────────────────────────────────────────

  private async upsertByExternalId<T extends ExternalIdRecord>(
    items: T[],
    findExisting: (externalIds: string[]) => Promise<ExternalIdRecord[]>,
    buildOps: (items: T[]) => Prisma.PrismaPromise<unknown>[],
    cachePrefix: string,
  ): Promise<{ processed: number; created: number; updated: number }> {
    if (items.length === 0) return { processed: 0, created: 0, updated: 0 };

    const externalIds = items.map((i) => i.externalId);
    const existingRecords = await findExisting(externalIds);
    const existingSet = new Set(existingRecords.map((r) => r.externalId));

    await batchTransaction(this.db, buildOps(items));
    await this.cacheService.invalidateCache(cachePrefix);

    return {
      processed: items.length,
      created: items.filter((i) => !existingSet.has(i.externalId)).length,
      updated: items.filter((i) => existingSet.has(i.externalId)).length,
    };
  }

  // ─── Per-type sync methods ────────────────────────────────────────────────────

  /**
   * Delegates to {@link PropositionsSyncService} (#828 Step 1). The
   * orchestrator owns stage-pattern construction (because the helpers
   * still live here pending the shared-helpers extraction) and passes
   * the patterns + the `upsertByExternalId` callback so the extracted
   * service stays free of the orchestrator's full surface.
   */
  private async syncPropositions(
    provider: DataFetcher = this.regionService,
    pipelineJobId?: string,
  ): Promise<{ processed: number; created: number; updated: number }> {
    if (!this.propositionsSyncService) {
      // Defensive — happens only when a unit-test module instantiates
      // RegionSyncService standalone without registering the bounded
      // services. Returning an empty result mirrors the previous
      // behavior when propositionAnalysis was absent.
      return { processed: 0, created: 0, updated: 0 };
    }
    const regionId = provider.getName?.() ?? 'unknown';
    const stagePatterns = await this.buildStagePatterns(regionId);
    return this.propositionsSyncService.sync(
      provider,
      pipelineJobId,
      stagePatterns,
      this.upsertByExternalId.bind(this),
    );
  }

  /** Delegates to {@link PropositionsSyncService} (#828 Step 1). */
  async regeneratePropositionAnalysis(id: string): Promise<boolean> {
    if (!this.propositionsSyncService) return false;
    return this.propositionsSyncService.regenerate(id);
  }

  /** Delegates to {@link MeetingsSyncService} (#828 Step 2). */
  private async syncMeetings(
    provider: DataFetcher = this.regionService,
    pipelineJobId?: string,
  ): Promise<{ processed: number; created: number; updated: number }> {
    if (!this.meetingsSyncService) {
      return { processed: 0, created: 0, updated: 0 };
    }
    return this.meetingsSyncService.sync(
      provider,
      pipelineJobId,
      this.upsertByExternalId.bind(this),
    );
  }

  /** Delegates to {@link RepresentativesSyncService} (#828 Step 3). */
  private async syncRepresentatives(
    provider: DataFetcher = this.regionService,
    maxReps?: number,
    regionId?: string,
  ): Promise<{ processed: number; created: number; updated: number }> {
    if (!this.representativesSyncService) {
      return { processed: 0, created: 0, updated: 0 };
    }
    return this.representativesSyncService.sync(
      provider,
      maxReps,
      regionId,
      {
        regionName: this.regionPluginService.getPluginRegionName(),
        normalizeDistrict:
          this.regionPluginService.getPluginNormalizeDistrict(),
        bioNoisePatterns: this.regionPluginService.getPluginBioNoisePatterns(),
      },
      this.upsertByExternalId.bind(this),
      deriveDistrictFromExternalId,
    );
  }

  /** Delegates to {@link CampaignFinanceSyncService} (#828 Step 4). */
  private async syncCampaignFinance(
    provider: DataFetcher,
    pipelineJobId?: string,
  ): Promise<{ processed: number; created: number; updated: number }> {
    if (!this.campaignFinanceSyncService) {
      return { processed: 0, created: 0, updated: 0 };
    }
    return this.campaignFinanceSyncService.sync(provider, pipelineJobId);
  }

  /** Delegates to {@link CivicsSyncService} (#828 Step 5). Shared HTTP /
   *  HTML helpers (fetchUrlText, htmlToReadableText, crawlCivicsUrls)
   *  are passed in as callbacks because bills sync also uses them; the
   *  consolidation lands as a follow-up after #828 Step 7 (bills) lifts
   *  them into a shared module. */
  private async syncCivics(plugin: DataFetcher): Promise<{
    processed: number;
    created: number;
    updated: number;
  }> {
    if (!this.civicsSyncService) {
      return { processed: 0, created: 0, updated: 0 };
    }
    return this.civicsSyncService.sync(plugin, {
      fetchUrlText: this.fetchUrlText.bind(this),
      htmlToReadableText: this.htmlToReadableText.bind(this),
      crawlCivicsUrls: this.crawlCivicsUrls.bind(this),
    });
  }

  // ─── Bills sync ───────────────────────────────────────────────────────────────

  private async syncBills(
    maxBills: number | undefined,
    plugin: DataFetcher,
    forceStatusRecheck: boolean = false,
  ): Promise<{
    processed: number;
    created: number;
    updated: number;
    skipped: number;
  }> {
    if (!this.promptClient || !this.llm) {
      this.logger.warn('Bills sync requires PromptClient and LLM; skipping');
      return { processed: 0, created: 0, updated: 0, skipped: 0 };
    }

    if (!plugin?.getDataSources) {
      this.logger.warn(
        'Region plugin does not expose getDataSources(); skipping bills sync',
      );
      return { processed: 0, created: 0, updated: 0, skipped: 0 };
    }

    const dataSources = plugin.getDataSources(DataType.BILLS);
    if (dataSources.length === 0) {
      this.logger.log('No bills data sources configured for this region');
      return { processed: 0, created: 0, updated: 0, skipped: 0 };
    }

    const registeredHosts = new Set(
      plugin.getDataSources().flatMap((s) => {
        try {
          return [new URL(s.url).hostname];
        } catch {
          return [];
        }
      }),
    );

    this.applyBillsHostThrottle(dataSources);

    const regionId = plugin.getName?.() ?? 'unknown';
    const repIndex = await this.buildRepNameIndex(regionId);
    const committeeIndex = await this.buildCommitteeNameIndex();
    const stagePatterns = await this.buildStagePatterns(regionId);
    const billsByExternalId = await this.loadBillSkipMetadata(regionId);

    let processed = 0;
    let created = 0;
    let updated = 0;
    let skippedTotal = 0;
    const syncedExternalIds = new Set<string>();

    // ─── Phase 1/6 — discover ───────────────────────────────────────
    // Walk every data source's discovery index up-front so phase 2/3
    // can announce a real grand-total. Otherwise the per-source
    // interleaving would force the operator to mentally sum partial
    // counts.
    const discoverTracker = billSyncTracker(
      this.logger,
      'discover',
      dataSources.length,
      { region: regionId },
    );
    const allStatusUrls: Array<{ url: string; ds: DataSourceConfig }> = [];
    const allVotesUrls: Array<{ url: string; ds: DataSourceConfig }> = [];
    for (const ds of dataSources) {
      const { statusUrls, votesUrls } = await this.discoverBillUrls(
        ds,
        registeredHosts,
        maxBills,
      );
      discoverTracker.item({
        name: ds.url,
        externalId: null,
        outcomeLabel: `${statusUrls.length} status URL(s), ${votesUrls.length} votes-only URL(s)`,
        outcome: 'updated',
      });
      for (const url of statusUrls) allStatusUrls.push({ url, ds });
      for (const url of votesUrls) allVotesUrls.push({ url, ds });
    }
    discoverTracker.complete();

    // ─── Phase 2/6 — extract_and_upsert ─────────────────────────────
    const extractTracker = billSyncTracker(
      this.logger,
      'extract_and_upsert',
      allStatusUrls.length,
      { region: regionId },
    );
    for (const { url, ds } of allStatusUrls) {
      await this.processOneBillUrl(url, {
        regionId,
        ds,
        repIndex,
        committeeIndex,
        stagePatterns,
        billsByExternalId,
        forceStatusRecheck,
        syncedExternalIds,
        tracker: extractTracker,
      });
    }
    const extractCounts = extractTracker.complete();
    processed +=
      extractCounts.created + extractCounts.updated + extractCounts.skipped;
    created += extractCounts.created;
    updated += extractCounts.updated;
    skippedTotal += extractCounts.skipped;

    // ─── Phase 3/6 — votes_only ─────────────────────────────────────
    const votesResult = await this.runVotesPhase(
      regionId,
      allVotesUrls,
      repIndex,
    );
    updated += votesResult.updated;

    // ─── Phase 4/6 — stage_backfill ────────────────────────────────
    if (stagePatterns.length > 0) {
      await this.backfillBillStageIds(regionId, stagePatterns);
    }

    // ─── Phase 5/6 — prune_stale ───────────────────────────────────
    await this.pruneStaleBills(regionId, syncedExternalIds, maxBills);

    // ─── Phase 6/6 — summarize ─────────────────────────────────────
    // Enrichment is a second pass: extraction (above) is the prerequisite,
    // but enrichment can be re-run independently when the bill-status-summary
    // prompt template version bumps (see #823, #741). Bounded by maxBills.
    //
    // Post-#823: the merged call needs the region's lifecycle taxonomy so
    // the LLM can classify the stage in-band (replacing the 92%-miss
    // deterministic pattern matcher). Built here so we pay the civics-data
    // read once per sync rather than per-bill.
    const lifecycleStages = await this.buildLifecycleStageInputs(regionId);
    await this.enrichBillSummaries(
      regionId,
      stagePatterns,
      lifecycleStages,
      maxBills,
    );

    return { processed, created, updated, skipped: skippedTotal };
  }

  /**
   * Apply per-source rate limits to the shared host throttle. Each bills
   * data source may override the default 1 req/sec gap via
   * DataSourceConfig.rateLimitOverride (requests/sec). The override
   * applies to the source's hostname, which transitively covers the
   * status / votes / text page templates (all on the same host).
   *
   * Extracted from `syncBills` to keep that function under SonarCloud's
   * cognitive-complexity gate. Try/catch on URL parsing isolates a
   * malformed-URL failure from interrupting the throttle setup for
   * other sources.
   */
  private applyBillsHostThrottle(dataSources: DataSourceConfig[]): void {
    for (const ds of dataSources) {
      if (!ds.rateLimitOverride || ds.rateLimitOverride <= 0) continue;
      try {
        const host = new URL(ds.url).hostname;
        this.hostThrottle.setRequestsPerSecond(host, ds.rateLimitOverride);
        this.logger.log(
          `Bills: host throttle for ${host} set to ${ds.rateLimitOverride} req/sec`,
        );
      } catch {
        /* invalid URL — surfaced elsewhere */
      }
    }
  }

  /**
   * Process a single bill discovery URL: try the cheap status-only
   * re-check first, then fall through to the full LLM extraction.
   * Emits one per-item log line via the tracker and mutates the shared
   * `syncedExternalIds` set in place.
   */
  private async processOneBillUrl(
    url: string,
    ctx: {
      regionId: string;
      ds: DataSourceConfig;
      repIndex: Map<string, { id: string; chamber: string }>;
      committeeIndex: Map<string, string>;
      stagePatterns: StagePattern[];
      billsByExternalId: Map<string, BillSkipRecord>;
      forceStatusRecheck: boolean;
      syncedExternalIds: Set<string>;
      tracker: SyncPhaseTracker<BillSyncPhase>;
    },
  ): Promise<void> {
    const billId = this.safeBillIdFromUrl(url);
    const billNumber = billNumberFromExternalId(billId);

    // Status-only re-check path (#819, generalizing #689): fires for every
    // bill with a prior DB row, not just journal-flagged ones. Unchanged →
    // skip cheaply (no LLM, just an `updated_at` touch); otherwise fall
    // through to the full extract path. `forceStatusRecheck=true` bypasses
    // the cheap parse and forces LLM re-extraction.
    if (billId) {
      const recheck = await this.tryStatusOnlyRecheck(
        url,
        ctx.forceStatusRecheck,
        ctx.billsByExternalId.get(billId),
      );
      if (recheck === 'unchanged') {
        ctx.tracker.item({
          name: billNumber,
          externalId: billId,
          outcomeLabel: 'status-only matched (no LLM)',
          outcome: 'skipped',
          extraCounters: ['status-only matched'],
        });
        ctx.syncedExternalIds.add(billId);
        return;
      }
    }

    const result = await this.extractAndUpsertBillPage(
      ctx.regionId,
      url,
      ctx.ds,
      ctx.repIndex,
      ctx.committeeIndex,
      ctx.stagePatterns,
    );
    if (result === 'created') {
      ctx.tracker.item({
        name: billNumber,
        externalId: billId ?? null,
        outcomeLabel: 'created (LLM)',
        outcome: 'created',
      });
    } else if (result === 'updated') {
      ctx.tracker.item({
        name: billNumber,
        externalId: billId ?? null,
        outcomeLabel: 'updated (LLM)',
        outcome: 'updated',
      });
    } else if (result === 'skipped') {
      ctx.tracker.item({
        name: billNumber,
        externalId: billId ?? null,
        outcomeLabel: 'skipped',
        outcome: 'skipped',
      });
    } else {
      // result === 'failed'
      ctx.tracker.item({
        name: billNumber,
        externalId: billId ?? null,
        outcomeLabel: 'failed',
        outcome: 'error',
      });
    }
    if (result !== 'failed' && billId) {
      ctx.syncedExternalIds.add(billId);
    }
  }

  private async buildStagePatterns(regionId: string): Promise<StagePattern[]> {
    const civics = await this.getCivicsDataForSync(regionId);
    const patterns: StagePattern[] = [];
    for (const stage of civics?.lifecycleStages ?? []) {
      for (const raw of stage.statusStringPatterns) {
        try {
          patterns.push({ stageId: stage.id, regex: new RegExp(raw, 'i') });
        } catch {
          this.logger.warn(
            `Invalid status pattern "${raw}" for stage "${stage.id}" in ${regionId} — skipping`,
          );
        }
      }
    }
    return patterns;
  }

  /**
   * Internal helper to load civics data for bill stage pattern compilation
   * and (post-#823) for the merged bill-status-summary prompt's per-region
   * taxonomy. Reads directly from DB without caching so sync always uses
   * fresh data.
   *
   * `name` and `description` are extracted from `name.plainLanguage` and
   * `shortDescription.plainLanguage` respectively — see the CivicText
   * shape in region-query.service.ts. Both fall back to empty strings
   * when the upstream civics extraction didn't populate them.
   */
  private async getCivicsDataForSync(regionId: string): Promise<{
    lifecycleStages: Array<{
      id: string;
      name: string;
      description: string;
      statusStringPatterns: string[];
    }>;
  } | null> {
    const rows = await this.db.civicsBlock.findMany({
      where: { regionId },
      orderBy: { extractedAt: 'desc' },
    });
    if (rows.length === 0) return null;
    const lifecycleStages = new Map<
      string,
      {
        id: string;
        name: string;
        description: string;
        statusStringPatterns: string[];
      }
    >();
    for (const row of rows) {
      const rawL = row.lifecycleStages as Record<string, unknown>[] | null;
      if (!rawL) continue;
      for (const ls of rawL) {
        const id = String(ls['id'] ?? '');
        if (!id || lifecycleStages.has(id)) continue;
        lifecycleStages.set(id, {
          id,
          name: extractPlainLanguage(ls['name']),
          description: extractPlainLanguage(ls['shortDescription']),
          statusStringPatterns: Array.isArray(ls['statusStringPatterns'])
            ? (ls['statusStringPatterns'] as string[])
            : [],
        });
      }
    }
    if (lifecycleStages.size === 0) return null;
    return { lifecycleStages: Array.from(lifecycleStages.values()) };
  }

  /**
   * Build the per-region lifecycle taxonomy input the merged
   * bill-status-summary prompt expects (opuspopuli#823). The LLM picks
   * one `id` from this list (or returns `"unknown"`); the caller
   * validates the returned id against this set before writing it to
   * `bills.current_stage_id`.
   *
   * Returns `null` when the region has no civics_blocks taxonomy yet —
   * callers should skip the merged enrichment path in that case (we'd
   * have nothing to classify into). Civic data onboarding is a hard
   * prerequisite of the new path; documenting that as a setup step
   * beats silently regressing to a fixed enum.
   */
  private async buildLifecycleStageInputs(
    regionId: string,
  ): Promise<LifecycleStageInput[] | null> {
    const civics = await this.getCivicsDataForSync(regionId);
    if (!civics || civics.lifecycleStages.length === 0) return null;
    return civics.lifecycleStages.map((s) => ({
      id: s.id,
      name: s.name || s.id,
      description: s.description || `Stage ${s.id}.`,
    }));
  }

  private resolveStageFromStatus(
    status: string | null | undefined,
    stagePatterns: StagePattern[],
  ): string | null {
    if (!status || stagePatterns.length === 0) return null;
    return stagePatterns.find((p) => p.regex.test(status))?.stageId ?? null;
  }

  private async backfillBillStageIds(
    regionId: string,
    stagePatterns: StagePattern[],
  ): Promise<void> {
    const unmatched = await this.db.bill.findMany({
      where: { regionId, currentStageId: null, status: { not: null } },
      select: { id: true, status: true, billNumber: true, externalId: true },
    });

    const tracker = billSyncTracker(
      this.logger,
      'stage_backfill',
      unmatched.length,
      {
        region: regionId,
      },
    );
    if (unmatched.length === 0) {
      tracker.complete();
      return;
    }

    const byStage = new Map<string, Array<(typeof unmatched)[number]>>();
    for (const bill of unmatched) {
      const stageId = this.resolveStageFromStatus(bill.status, stagePatterns);
      if (!stageId) {
        tracker.item({
          name: bill.billNumber,
          externalId: bill.externalId,
          outcomeLabel: 'unresolved (no pattern matched)',
          outcome: 'skipped',
        });
        continue;
      }
      if (!byStage.has(stageId)) byStage.set(stageId, []);
      byStage.get(stageId)!.push(bill);
    }

    for (const [stageId, bills] of byStage) {
      await this.db.bill.updateMany({
        where: { id: { in: bills.map((b) => b.id) } },
        data: { currentStageId: stageId },
      });
      for (const bill of bills) {
        tracker.item({
          name: bill.billNumber,
          externalId: bill.externalId,
          outcomeLabel: `stage=${stageId}`,
          outcome: 'updated',
        });
      }
    }
    tracker.complete();
  }

  private async pruneStaleBills(
    regionId: string,
    syncedExternalIds: Set<string>,
    maxBills?: number,
  ): Promise<void> {
    if (syncedExternalIds.size === 0 || maxBills != null) {
      // Tracker still useful so the operator sees the no-op outcome
      // rather than wondering whether the phase ran at all.
      const tracker = billSyncTracker(this.logger, 'prune_stale', 0, {
        region: regionId,
        reason:
          syncedExternalIds.size === 0
            ? 'no-synced-ids'
            : 'maxBills-set-skips-prune',
      });
      tracker.complete();
      return;
    }

    const stale = await this.db.bill.findMany({
      where: {
        regionId,
        externalId: { notIn: Array.from(syncedExternalIds) },
      },
      select: { id: true, billNumber: true, externalId: true },
    });

    const tracker = billSyncTracker(this.logger, 'prune_stale', stale.length, {
      region: regionId,
    });
    if (stale.length === 0) {
      tracker.complete();
      return;
    }

    await this.db.bill.deleteMany({
      where: { id: { in: stale.map((b) => b.id) } },
    });
    for (const bill of stale) {
      tracker.item({
        name: bill.billNumber,
        externalId: bill.externalId,
        outcomeLabel: 'removed (not seen in this sync)',
        outcome: 'updated',
      });
    }
    tracker.complete();
  }

  /**
   * Enrich un-summarized bills with structured AI summaries from the
   * merged bill-status-summary prompt-service endpoint (#823). Runs as a
   * second pass after `syncBills` so extraction stays decoupled from
   * summarization — a new prompt-template version triggers re-enrichment
   * without re-extracting.
   *
   * Per #823 the LLM call now also re-classifies the bill's lifecycle
   * stage (status.stage), overwriting whatever the pattern matcher set.
   * Stage coverage rises from 8% (pattern-match only) → ~95%+ (LLM with
   * the region taxonomy in context).
   *
   * Idempotency: queries only bills where `ai_summary IS NULL`. Bills the
   * LLM marks `{ skip: true }` get that value stored (so they don't churn
   * on every sync); bills that fail with an LLM error stay NULL and are
   * retried on the next sync. To force re-enrichment for all bills (e.g.
   * after a prompt-template version bump), the operator nulls the column.
   *
   * Cost telemetry: per-bill debug log + per-job summary log. LLM is local
   * Ollama (`qwen3.5:9b` by default), so cost is compute time, not $$ —
   * the telemetry is for noticing spikes and regressions. See #741.
   */
  private async enrichBillSummaries(
    regionId: string,
    stagePatterns: StagePattern[],
    lifecycleStages: LifecycleStageInput[] | null,
    maxBills?: number,
  ): Promise<{ enriched: number; skipped: number; failed: number }> {
    if (!this.promptClient || !this.llm) {
      return { enriched: 0, skipped: 0, failed: 0 };
    }

    // Civics-data taxonomy is a hard prerequisite for the merged call —
    // the LLM has nothing to classify into without it. Onboarding a new
    // region means seeding civics_blocks before bills enrichment.
    if (!lifecycleStages || lifecycleStages.length === 0) {
      this.logger.warn(
        `Bill enrichment ${regionId}: skipping summarize phase — no civics_blocks.lifecycleStages taxonomy. Run a civics-extraction sync first.`,
      );
      return { enriched: 0, skipped: 0, failed: 0 };
    }

    const candidates = await this.db.bill.findMany({
      where: { regionId, aiSummary: { equals: Prisma.DbNull } },
      select: {
        id: true,
        regionId: true,
        billNumber: true,
        sessionYear: true,
        title: true,
        subject: true,
        status: true,
        authorName: true,
        fiscalImpact: true,
        fullTextUrl: true,
        currentStageId: true,
      },
      take: maxBills,
    });

    const tracker = billSyncTracker(
      this.logger,
      'summarize',
      candidates.length,
      { region: regionId },
    );
    if (candidates.length === 0) {
      tracker.complete();
      return { enriched: 0, skipped: 0, failed: 0 };
    }

    const counts = { enriched: 0, skipped: 0, failed: 0 };
    const tokensRef = { total: 0 };
    const startMs = Date.now();

    const stageIdSet = new Set(lifecycleStages.map((s) => s.id));
    const concurrency = this.billEnrichmentConcurrency;
    if (concurrency > 1) {
      tracker.note(`enriching with concurrency=${concurrency}`);
    }
    // Bounded-concurrency batches (#889 follow-up). enrichSingleBill is
    // self-contained and persists per-bill (writeStatusSummary) with no
    // shared mutable state, so bills are safe to run in parallel. Counter
    // and tracker updates happen after each batch resolves, in order, so
    // tallies stay deterministic. concurrency=1 == the prior serial loop.
    for (let i = 0; i < candidates.length; i += concurrency) {
      const batch = candidates.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((bill) =>
          this.enrichSingleBill(
            bill,
            stagePatterns,
            lifecycleStages,
            stageIdSet,
          ),
        ),
      );
      results.forEach((result, j) => {
        this.applyEnrichmentResult(
          result,
          batch[j],
          counts,
          tokensRef,
          tracker,
        );
      });
    }
    const totalTokens = tokensRef.total;

    const totalDurationMs = Date.now() - startMs;
    tracker.complete();
    // Structured telemetry retained alongside the human-readable phase
    // log so the existing dashboards / log queries keep working.
    this.logger.log(
      {
        event: 'bill_enrichment_summary',
        regionId,
        billsEnriched: counts.enriched,
        billsSkippedNoText: counts.skipped,
        billsFailed: counts.failed,
        totalTokens,
        totalDurationMs,
        avgTokensPerEnrichedBill:
          counts.enriched > 0 ? Math.round(totalTokens / counts.enriched) : 0,
      },
      `Bill enrichment ${regionId}: enriched=${counts.enriched} skipped=${counts.skipped} failed=${counts.failed} tokens=${totalTokens} ms=${totalDurationMs}`,
    );

    return counts;
  }

  /**
   * Fold one enrich result into the running tallies and emit its tracker
   * line. Extracted from the batch loop so enrichBillSummaries stays under
   * the SonarCloud cognitive-complexity gate. `tokensRef` is a boxed
   * accumulator so the running total survives across batches.
   */
  private applyEnrichmentResult(
    result: { outcome: EnrichmentOutcome; tokensUsed: number },
    bill: { billNumber: string },
    counts: { enriched: number; skipped: number; failed: number },
    tokensRef: { total: number },
    tracker: SyncPhaseTracker<BillSyncPhase>,
  ): void {
    counts[result.outcome] += 1;
    tokensRef.total += result.tokensUsed;
    const { outcomeLabel, outcome } = describeEnrichmentResult(
      result.outcome,
      result.tokensUsed,
    );
    tracker.item({
      name: bill.billNumber,
      externalId: null,
      outcomeLabel,
      outcome,
    });
  }

  /**
   * Phase 3 (votes_only): fetch + LLM-extract each bill's votes page and
   * upsert per-member rows. Runs in bounded-concurrency batches (#892) —
   * extractVotesOnlyPage is self-contained (findUnique → fetch → LLM →
   * linkBillVotes, all per-bill with no shared mutable state), so votes
   * pages are safe to run in parallel. Batch results are applied in slice
   * order, so tracker lines and the `updated` tally stay deterministic —
   * identical to the prior serial loop. concurrency=1 == that serial loop,
   * and only helps if the Ollama server accepts parallel requests
   * (OLLAMA_NUM_PARALLEL ≥ concurrency); otherwise calls queue server-side.
   */
  private async runVotesPhase(
    regionId: string,
    allVotesUrls: Array<{ url: string; ds: DataSourceConfig }>,
    repIndex: Map<string, { id: string; chamber: string }>,
  ): Promise<{ updated: number }> {
    const votesTracker = billSyncTracker(
      this.logger,
      'votes_only',
      allVotesUrls.length,
      { region: regionId },
    );
    const concurrency = this.billVotesConcurrency;
    if (concurrency > 1) {
      votesTracker.note(`extracting votes with concurrency=${concurrency}`);
    }
    const updatedRef = { total: 0 };
    for (let i = 0; i < allVotesUrls.length; i += concurrency) {
      const batch = allVotesUrls.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(({ url, ds }) =>
          this.extractVotesOnlyPage(regionId, url, ds, repIndex),
        ),
      );
      results.forEach((result, j) => {
        this.applyVotesResult(result, batch[j].url, updatedRef, votesTracker);
      });
    }
    votesTracker.complete();
    return { updated: updatedRef.total };
  }

  /**
   * Fold one votes_only extraction into the phase tracker and the boxed
   * `updated` tally. Extracted from the Phase 3 batch loop (#892) so
   * runVotesPhase stays under the SonarCloud cognitive-complexity gate.
   * Derives externalId/billNumber from the URL here (not in the parallel
   * map) so the tracker line is emitted in deterministic slice order.
   */
  private applyVotesResult(
    result: VotesExtractionResult,
    url: string,
    updatedRef: { total: number },
    tracker: SyncPhaseTracker<BillSyncPhase>,
  ): void {
    const externalId = this.safeBillIdFromUrl(url) ?? null;
    const billNumber = billNumberFromExternalId(externalId ?? undefined);
    const { outcome, count } = result;
    // Report the TRUE per-bill outcome (#889). The extraCounter bucket
    // (== the outcome string) makes the phase-complete summary show the
    // distribution, e.g. "... 4998 shell-missing, 20 extraction-failed".
    const mapped = VOTES_OUTCOME_TRACKING[outcome];
    tracker.item({
      name: billNumber,
      externalId,
      outcomeLabel:
        outcome === 'votes-upserted' ? `votes upserted (${count})` : outcome,
      outcome: mapped.counter,
      extraCounters: [outcome],
    });
    if (outcome === 'votes-upserted') updatedRef.total += 1;
  }

  private async enrichSingleBill(
    bill: BillEnrichmentCandidate,
    stagePatterns: StagePattern[],
    lifecycleStages: LifecycleStageInput[],
    stageIdSet: Set<string>,
  ): Promise<{
    outcome: EnrichmentOutcome;
    tokensUsed: number;
  }> {
    if (!bill.fullTextUrl) {
      this.logger.debug(
        `Bill enrichment: skipping ${bill.billNumber} — no fullTextUrl`,
      );
      return { outcome: 'skipped', tokensUsed: 0 };
    }

    try {
      const html = this.htmlToReadableText(
        await this.fetchUrlText(bill.fullTextUrl),
      );

      const { promptText, promptVersion } =
        await this.promptClient!.getBillStatusSummaryPrompt({
          regionId: bill.regionId,
          billNumber: bill.billNumber,
          sessionYear: bill.sessionYear,
          title: bill.title,
          html,
          lifecycleStages,
          priorStatus: bill.status ?? undefined,
          priorStage: bill.currentStageId ?? undefined,
        });

      const llmStart = Date.now();
      const llmResult = await this.llm!.generate(promptText, {
        maxTokens: 2000,
        temperature: 0.1,
        // Provider default is too short for the largest full-text bills
        // (#889 follow-up) — ~4.4% aborted without this. Env-tunable.
        requestTimeoutMs: this.billEnrichmentTimeoutMs,
      });
      const llmMs = Date.now() - llmStart;
      const tokensUsed = llmResult.tokensUsed ?? 0;

      const parsed = this.parseStatusSummaryResponse(
        llmResult.text,
        bill.billNumber,
      );
      if (!parsed) {
        return { outcome: 'failed', tokensUsed };
      }

      await this.writeStatusSummary(
        bill,
        parsed,
        promptVersion,
        stagePatterns,
        stageIdSet,
      );

      this.logger.debug(
        {
          event: 'bill_enrichment',
          billId: bill.id,
          billNumber: bill.billNumber,
          promptVersion,
          tokensUsed,
          latencyMs: llmMs,
          llmSkip: parsed.skip === true,
        },
        `Bill enrichment ok: ${bill.billNumber} ${promptVersion} tokens=${tokensUsed} ms=${llmMs}`,
      );

      return { outcome: 'enriched', tokensUsed };
    } catch (e) {
      this.logger.warn(
        `Bill enrichment failed for ${bill.billNumber}: ${(e as Error).message}`,
      );
      return { outcome: 'failed', tokensUsed: 0 };
    }
  }

  /**
   * Parse the merged bill-status-summary LLM response. Returns null when
   * the payload is missing/non-object/array — caller treats that as
   * `failed` so the bill stays eligible for the next sync (its
   * `aiSummary` column remains NULL).
   */
  private parseStatusSummaryResponse(
    text: string,
    billNumber: string,
  ): BillStatusSummaryShape | null {
    const candidate = extractJsonObjectSlice(text);
    if (!candidate) {
      this.logger.warn(`Bill enrichment: no JSON returned for ${billNumber}`);
      return null;
    }
    const raw: unknown = JSON.parse(candidate);
    // Reject non-object payloads — the LLM occasionally returns `null` or
    // `[]` instead of the structured object. Storing those would lock the
    // bill out of the retry query (`ai_summary IS NULL`) with garbage in
    // the column. Counted as failed → retried next sync.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      this.logger.warn(
        `Bill enrichment: non-object JSON payload for ${billNumber}`,
      );
      return null;
    }
    return raw as BillStatusSummaryShape;
  }

  /**
   * Apply the merged response to the bill row:
   *   - `{ skip: true }` → store the sentinel verbatim in `aiSummary` so
   *     the bill stops cycling through enrichment on every sync (mirrors
   *     the pre-#823 behavior).
   *   - Otherwise → write the `summary` JSONB (drop-in shape for existing
   *     consumers), the verbatim `status.raw`, a runtime-validated
   *     `currentStageId`, and the parsed `lastActionDate`. When the LLM
   *     reports `status.changed === false` we still write because this
   *     bill arrived here via `ai_summary IS NULL` — the changed flag
   *     just disambiguates intent for future re-enrich loops.
   */
  private async writeStatusSummary(
    bill: BillEnrichmentCandidate,
    parsed: BillStatusSummaryShape,
    promptVersion: string,
    stagePatterns: StagePattern[],
    stageIdSet: Set<string>,
  ): Promise<void> {
    if (parsed.skip === true) {
      await this.db.bill.update({
        where: { id: bill.id },
        data: {
          aiSummary: { skip: true } as Prisma.InputJsonValue,
          aiSummaryVersion: promptVersion,
          aiSummaryGeneratedAt: new Date(),
        },
      });
      return;
    }

    const summary: BillAiSummaryShape = parsed.summary ?? {};
    const status = parsed.status ?? {};
    const validatedStage = this.validateStageId(
      status.stage,
      status.raw,
      bill,
      stagePatterns,
      stageIdSet,
    );
    const lastActionDate = parseLastActionDate(status.lastActionDate);

    await this.db.bill.update({
      where: { id: bill.id },
      data: {
        aiSummary: summary as Prisma.InputJsonValue,
        aiSummaryVersion: promptVersion,
        aiSummaryGeneratedAt: new Date(),
        ...(status.raw ? { status: status.raw } : {}),
        // status.lastActionSnippet is the LLM's fresh read of the most
        // recent history entry; writing it keeps bills.lastAction in sync
        // with the merged-call view rather than letting the bill-extraction
        // value drift.
        ...(status.lastActionSnippet
          ? { lastAction: status.lastActionSnippet }
          : {}),
        currentStageId: validatedStage,
        ...(lastActionDate !== undefined ? { lastActionDate } : {}),
      },
    });
  }

  /**
   * Resolve the stage id we'll write to the bill row. Trust the LLM's
   * classification when it lands inside the region's taxonomy; otherwise
   * fall back to the deterministic pattern matcher.
   *
   * Logging is split by level so post-launch alerting has a clean drift
   * signal:
   *   - `"unknown"` is the documented "no stage fits" answer — expected
   *     for bills mid-paperwork — and logs at debug.
   *   - An out-of-taxonomy id is a prompt-template / model-drift signal
   *     and logs at warn so log-based alerts can target it.
   *
   * Returns `null` when neither the LLM nor the pattern matcher resolves —
   * the column stays NULL and the bill is eligible for the next sync.
   */
  private validateStageId(
    llmStage: string | undefined,
    statusRaw: string | undefined,
    bill: BillEnrichmentCandidate,
    stagePatterns: StagePattern[],
    stageIdSet: Set<string>,
  ): string | null {
    if (llmStage && llmStage !== 'unknown' && stageIdSet.has(llmStage)) {
      return llmStage;
    }
    const fallback = this.resolveStageFromStatus(
      statusRaw ?? bill.status,
      stagePatterns,
    );
    const outOfTaxonomy = llmStage !== undefined && llmStage !== 'unknown';
    const logPayload = {
      event: 'bill_stage_resolution_fallback',
      billId: bill.id,
      billNumber: bill.billNumber,
      regionId: bill.regionId,
      llmStage: llmStage ?? null,
      outOfTaxonomy,
      fallback: fallback ?? null,
    };
    const logMessage = `Bill ${bill.billNumber}: stage fallback (llmStage=${llmStage ?? 'null'}) → ${fallback ?? 'null'}`;
    if (outOfTaxonomy) {
      // Drift signal — alertable.
      this.logger.warn(logPayload, logMessage);
    } else {
      // Expected sometimes ("unknown" from the LLM, or absent stage field) —
      // visible at debug only so it doesn't drown the drift signal.
      this.logger.debug(logPayload, logMessage);
    }
    return fallback;
  }

  private async discoverBillUrls(
    ds: DataSourceConfig,
    registeredHosts: Set<string>,
    maxBills?: number,
  ): Promise<{ statusUrls: string[]; votesUrls: string[] }> {
    if (!ds.billDiscovery) {
      const urls = await this.crawlCivicsUrls(ds, registeredHosts);
      return {
        statusUrls: urls.filter((u) => u.includes('billStatusClient.xhtml')),
        votesUrls: urls.filter((u) => u.includes('billVotesClient.xhtml')),
      };
    }

    const { navLinkPattern, statusPageTemplate, votesPageTemplate } =
      ds.billDiscovery;

    const seedUrl = new URL(ds.url);
    if (
      seedUrl.protocol !== 'https:' ||
      !registeredHosts.has(seedUrl.hostname)
    ) {
      this.logger.error(
        `Bills discovery rejected: ${seedUrl.hostname} is not a registered host`,
      );
      return { statusUrls: [], votesUrls: [] };
    }

    const limit = maxBills ?? Infinity;
    let html: string;
    try {
      html = await this.fetchUrlText(ds.url);
    } catch (e) {
      this.logger.warn(
        `Bills: failed to fetch seed ${ds.url}: ${(e as Error).message}`,
      );
      return { statusUrls: [], votesUrls: [] };
    }

    const decoded = html.replace(/&amp;/g, '&');
    const re = new RegExp(navLinkPattern, 'g');
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(decoded)) !== null && seen.size < limit) {
      seen.add(m[1]);
    }

    const base = `${seedUrl.protocol}//${seedUrl.host}`;
    const statusUrls: string[] = [];
    const votesUrls: string[] = [];
    for (const billId of seen) {
      statusUrls.push(
        `${base}${statusPageTemplate.replace('{bill_id}', billId)}`,
      );
      votesUrls.push(
        `${base}${votesPageTemplate.replace('{bill_id}', billId)}`,
      );
    }

    return { statusUrls, votesUrls };
  }

  private async buildRepNameIndex(
    _: string,
  ): Promise<Map<string, { id: string; chamber: string }>> {
    const reps = await this.db.representative.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, chamber: true },
    });
    const index = new Map<string, { id: string; chamber: string }>();
    for (const r of reps) {
      index.set(r.name.toLowerCase().trim(), { id: r.id, chamber: r.chamber });
      const lastName = r.name.split(/\s+/).pop()?.toLowerCase() ?? '';
      if (lastName && !index.has(lastName)) {
        index.set(lastName, { id: r.id, chamber: r.chamber });
      }
    }
    return index;
  }

  private async buildCommitteeNameIndex(): Promise<Map<string, string>> {
    const committees = await this.db.legislativeCommittee.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    const index = new Map<string, string>();
    // Exact canonical keys first — the original behavior, never regressed.
    for (const c of committees) {
      index.set(c.name.toLowerCase().trim(), c.id);
    }
    // Normalized-core aliases so verbose extracted names ("Assembly Committee on
    // Appropriations") resolve to short canonical committees ("Appropriations").
    // Collect ids per normalized key, then add only unambiguous ones (a core
    // shared by ≥2 committees is skipped — never mis-link) that aren't already
    // an exact key (#908).
    const byNorm = new Map<string, string[]>();
    for (const c of committees) {
      const norm = normalizeCommitteeName(c.name);
      if (!norm) continue;
      const ids = byNorm.get(norm) ?? [];
      ids.push(c.id);
      byNorm.set(norm, ids);
    }
    for (const [norm, ids] of byNorm) {
      if (ids.length === 1 && !index.has(norm)) index.set(norm, ids[0]);
    }
    return index;
  }

  private resolveRepByName(
    name: string,
    index: Map<string, { id: string; chamber: string }>,
  ): string | undefined {
    const normalized = name.toLowerCase().trim();
    const exact = index.get(normalized);
    if (exact) return exact.id;
    const lastName = normalized.split(/\s+/).pop() ?? '';
    return lastName ? index.get(lastName)?.id : undefined;
  }

  private extractBillPublishedAt(html: string): string | null {
    const m = html.match(
      /Date Published:\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)/i,
    );
    return m ? m[1].trim() : null;
  }

  private async checkBillSkipCondition(
    billId: string,
    sourceUrl: string,
    textPageTemplate: string,
  ): Promise<Date | 'skipped' | null> {
    const base = new URL(sourceUrl).origin;
    const textUrl = `${base}${textPageTemplate.replace('{bill_id}', billId)}`;
    try {
      if (new URL(textUrl).hostname !== new URL(sourceUrl).hostname) {
        this.logger.warn(
          `Bills skip-check: textPageTemplate hostname mismatch, skipping for ${sourceUrl}`,
        );
        return null;
      }
      const textHtml = await this.fetchUrlText(textUrl);
      const remoteStr = this.extractBillPublishedAt(textHtml);
      if (!remoteStr) return null;

      const remoteDate = new Date(`${remoteStr} UTC`);
      if (isNaN(remoteDate.getTime())) return null;

      const existing = await this.db.bill.findUnique({
        where: { externalId: billId },
        select: { sourcePublishedAt: true },
      });
      if (
        existing?.sourcePublishedAt &&
        existing.sourcePublishedAt.getTime() === remoteDate.getTime()
      ) {
        return 'skipped';
      }
      return remoteDate;
    } catch {
      return null;
    }
  }

  private safeBillIdFromUrl(url: string): string | undefined {
    try {
      return new URL(url).searchParams.get('bill_id') ?? undefined;
    } catch {
      this.logger.warn(`Bills: malformed bill URL skipped: ${url}`);
      return undefined;
    }
  }

  /**
   * Extract change-detection signals from billStatusClient.xhtml for the
   * status-only re-check path (#689). Targets the actual leginfo markup:
   *
   *   - lastActionDate: <span id="lastAction" class="statusLabel">M/D/YY</span>
   *   - lastAction:    first row of the action history table
   *                    (<td scope="row">DATE</td><td>TEXT</td>)
   *
   * Note: the leginfo `status` cell ("Inactive Bill - Chaptered") differs
   * from the LLM-normalized DB `status` ("Chaptered"), so it is NOT used
   * for change detection — a raw-vs-normalized mismatch would trigger a
   * false positive on every check. Caller compares only lastActionDate +
   * lastAction text, which the LLM stores verbatim.
   */
  private extractBillStatusFields(html: string): {
    lastAction: string | null;
    lastActionDate: Date | null;
  } {
    const clean = (raw: string): string =>
      raw
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();

    // <span id="lastAction"...>M/D/YY</span> — 2-digit year on leginfo
    const dateMatch = html.match(
      /<span\s+id="lastAction"[^>]*>\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*</i,
    );
    let lastActionDate: Date | null = null;
    if (dateMatch) {
      const [, m, d, yRaw] = dateMatch;
      const year = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
      const dt = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
      if (!isNaN(dt.getTime())) lastActionDate = dt;
    }

    // First action history row: <td scope="row">DATE</td><td>TEXT</td>
    const actionMatch = html.match(
      /<td\s+scope="row">\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*<\/td>\s*<td>\s*([^<]+?)\s*</i,
    );
    const lastAction = actionMatch ? clean(actionMatch[1]) || null : null;

    return { lastAction, lastActionDate };
  }

  /**
   * Status-only re-check for every bill with a prior DB row (#819,
   * generalizing #689). Fetches the status page, parses lastAction +
   * lastActionDate cheaply (no LLM), and skips the full extract path
   * when neither has moved. The LLM-normalized `status` field is
   * intentionally NOT compared — the LLM rewrites the raw leginfo
   * status ("Inactive Bill - Chaptered" → "Chaptered") so a raw-vs-
   * normalized comparison would false-positive every time.
   *
   * Coverage: pre-#819 this only fired for bills flagged by the
   * journal linker (`needsStatusRecheck=true`) or the weekly backstop.
   * Unflagged bills fell to the text-page `sourcePublishedAt` skip
   * (Mechanism B) — which silently missed status-only changes (e.g.
   * committee amendments) that didn't re-publish the bill text.
   * Removing the flag gate closes that silent-drift gap; the existing
   * `needsStatusRecheck` flag is retained as documentation (journal
   * linker still sets it; the clear-after-skip path still clears it)
   * but is no longer load-bearing for skip eligibility.
   *
   * `forceStatusRecheck` semantics: when true, bypass the cheap parse
   * entirely and fall through to full LLM extraction. This is the
   * operator override for "I don't trust DB state, re-extract from
   * scratch." Pre-#819 the same flag meant "force the cheap parse to
   * fire" — a subtle weaker guarantee since the cheap parse could
   * still skip the LLM. The new semantics match the parameter name.
   *
   * Takes `existing` as a parameter to avoid a per-bill `findUnique` —
   * callers pre-load via `loadBillSkipMetadata` at sync start.
   */
  private async tryStatusOnlyRecheck(
    statusUrl: string,
    forceStatusRecheck: boolean,
    existing: BillSkipRecord | undefined,
  ): Promise<'unchanged' | 'fall-through'> {
    if (!existing) return 'fall-through'; // brand-new bill, full extraction
    // Operator override — skip the cheap parse, force LLM re-extraction.
    if (forceStatusRecheck) return 'fall-through';

    let html: string;
    try {
      html = await this.fetchUrlText(statusUrl);
    } catch {
      return 'fall-through';
    }
    const fields = this.extractBillStatusFields(html);

    // Both signals must parse cleanly. If the page structure shifts and a
    // regex breaks, fall through to LLM so we don't silently drift.
    if (fields.lastAction == null || fields.lastActionDate == null) {
      return 'fall-through';
    }

    const lastActionChanged = fields.lastAction !== existing.lastAction;
    const dateChanged =
      existing.lastActionDate == null ||
      existing.lastActionDate.getTime() !== fields.lastActionDate.getTime();

    if (lastActionChanged || dateChanged) {
      // Something new on the page — defer to LLM for authoritative update.
      // The LLM path clears needsStatusRecheck in its upsert.
      return 'fall-through';
    }

    // No material change. Clear the flag (idempotent on already-false) and skip.
    await this.db.bill.update({
      where: { id: existing.id },
      data: { needsStatusRecheck: false },
    });
    return 'unchanged';
  }

  /**
   * Pre-load the per-bill metadata that the inner loop needs for skip-gating
   * decisions (status-only re-check + sourcePublishedAt skip).
   *
   * Eliminates a per-bill `findUnique` in the iteration loop: with ~5k bills
   * per CA sync that's ~5k round-trips replaced by one bulk SELECT.
   */
  private async loadBillSkipMetadata(
    regionId: string,
  ): Promise<Map<string, BillSkipRecord>> {
    const rows = await this.db.bill.findMany({
      where: { regionId },
      select: {
        id: true,
        externalId: true,
        sourcePublishedAt: true,
        lastAction: true,
        lastActionDate: true,
        needsStatusRecheck: true,
      },
    });
    return new Map(rows.map((r) => [r.externalId, r]));
  }

  private parseBillJson(
    candidate: string,
    sourceUrl: string,
  ): (Partial<Bill> & { billNumber: string; title: string }) | null {
    let raw: Partial<Bill>;
    try {
      raw = JSON.parse(candidate) as Partial<Bill>;
    } catch {
      this.logger.warn(`Bills extraction: JSON parse failed for ${sourceUrl}`);
      return null;
    }
    if (!raw.billNumber || !raw.title) {
      this.logger.warn(
        `Bills extraction: missing required fields at ${sourceUrl}`,
      );
      return null;
    }
    return raw as Partial<Bill> & { billNumber: string; title: string };
  }

  private async extractAndUpsertBillPage(
    regionId: string,
    sourceUrl: string,
    ds: DataSourceConfig,
    repIndex: Map<string, { id: string; chamber: string }>,
    committeeIndex: Map<string, string>,
    stagePatterns: StagePattern[],
  ): Promise<'created' | 'updated' | 'skipped' | 'failed'> {
    if (!this.promptClient || !this.llm) return 'failed';
    try {
      let sourcePublishedAt: Date | null = null;
      let billId: string | undefined;
      try {
        billId = new URL(sourceUrl).searchParams.get('bill_id') ?? undefined;
      } catch {
        /* invalid URL */
      }

      if (billId && ds.billDiscovery?.textPageTemplate) {
        const skipResult = await this.checkBillSkipCondition(
          billId,
          sourceUrl,
          ds.billDiscovery.textPageTemplate,
        );
        if (skipResult === 'skipped') return 'skipped';
        if (skipResult instanceof Date) sourcePublishedAt = skipResult;
      }

      const html = await this.fetchUrlText(sourceUrl);
      const content = this.htmlToReadableText(html);
      const sessionYear = this.inferSessionYear(sourceUrl);

      const { promptText } = await this.promptClient.getBillExtractionPrompt({
        regionId,
        sourceUrl,
        sessionYear,
        html: content,
      });

      const llmResult = await this.llm.generate(promptText, {
        maxTokens: ds.llmMaxTokens ?? 8000,
        temperature: 0.1,
        requestTimeoutMs: ds.llmRequestTimeoutMs,
      });

      const candidate = extractJsonObjectSlice(llmResult.text);
      if (!candidate) {
        this.logger.warn(`Bills extraction: no JSON for ${sourceUrl}`);
        return 'failed';
      }

      const raw = this.parseBillJson(candidate, sourceUrl);
      if (!raw) return 'failed';

      const externalId =
        billId ?? raw.externalId ?? this.buildBillExternalId(raw);
      const authorId = raw.authorName
        ? this.resolveRepByName(raw.authorName, repIndex)
        : undefined;
      const existing = await this.db.bill.findUnique({
        where: { externalId },
        select: { id: true },
      });

      const measureTypeCode =
        raw.measureTypeCode ?? this.inferMeasureTypeCode(raw.billNumber);
      if (!measureTypeCode) {
        this.logger.warn(
          `Bills extraction: cannot determine measureTypeCode for "${raw.billNumber}" at ${sourceUrl}`,
        );
        return 'failed';
      }

      const resolvedCurrentStageId =
        raw.currentStageId ??
        this.resolveStageFromStatus(raw.status, stagePatterns);
      const resolvedSessionYear = raw.sessionYear ?? sessionYear;
      const resolvedLastActionDate = raw.lastActionDate
        ? new Date(raw.lastActionDate as unknown as string)
        : null;

      // Snapshot now() once so both lifecycle helpers see the same moment —
      // avoids a sub-millisecond drift between today and activeSessionYears.
      const now = new Date();
      const lifecycleInput = {
        status: raw.status ?? null,
        currentStageId: resolvedCurrentStageId,
        sessionYear: resolvedSessionYear,
        lastAction: raw.lastAction ?? null,
        lastActionDate: resolvedLastActionDate,
      };
      const lifecycleCtx = {
        today: now,
        activeSessionYears: computeActiveCaSessionYears(now),
      };

      const billData = {
        regionId,
        billNumber: raw.billNumber,
        sessionYear: resolvedSessionYear,
        measureTypeCode,
        title: raw.title,
        subject: raw.subject ?? null,
        status: raw.status ?? null,
        currentStageId: resolvedCurrentStageId,
        lastAction: raw.lastAction ?? null,
        lastActionDate: resolvedLastActionDate,
        fiscalImpact: raw.fiscalImpact ?? null,
        fullTextUrl: raw.fullTextUrl ?? null,
        authorId: authorId ?? null,
        authorName: raw.authorName ?? null,
        sourceUrl,
        sourcePublishedAt,
        // A successful full extraction always clears the status-recheck
        // flag — whether the bill arrived here via the journal flag or the
        // weekly backstop, the LLM update is authoritative. See #689.
        needsStatusRecheck: false,
        // Procedural lifecycle flags (#747). Computed at write time so list/
        // search/feed queries don't re-evaluate the rules per row. The two
        // booleans form a 3-way partition (active | passed/chaptered |
        // dead); see bill-lifecycle.ts for the rules. Sync re-evaluates on
        // each run — the helpers are deterministic, so re-runs are no-ops
        // until the source status changes.
        isDead: isBillDead(lifecycleInput, lifecycleCtx),
        isActive: isBillActive(lifecycleInput, lifecycleCtx),
        extractedAt: now,
      };
      const bill = await this.db.bill.upsert({
        where: { externalId },
        create: { externalId, ...billData },
        update: billData,
        select: { id: true },
      });

      await this.linkBillCoAuthors(bill.id, raw.coAuthorNames ?? [], repIndex);
      await this.linkBillCommittees(
        bill.id,
        raw.committeeNames ?? [],
        committeeIndex,
      );
      await this.linkBillVotes(bill.id, raw.votes ?? [], repIndex, sourceUrl);

      return existing ? 'updated' : 'created';
    } catch (e) {
      this.logger.warn(
        `Bills extraction failed for ${sourceUrl}: ${(e as Error).message}`,
      );
      return 'failed';
    }
  }

  /**
   * Per-bill outcome of votes_only extraction. Split out (#889) so the
   * caller can report the TRUE reason instead of blanket-logging
   * "no bill shell yet" — which conflated shell-missing, no-votes, and
   * extraction failures and masked a real extraction bug as a lookup miss.
   */
  private async extractVotesOnlyPage(
    regionId: string,
    sourceUrl: string,
    ds: DataSourceConfig,
    repIndex: Map<string, { id: string; chamber: string }>,
  ): Promise<VotesExtractionResult> {
    if (!this.promptClient || !this.llm) {
      return { outcome: 'providers-unavailable', count: 0 };
    }

    let billIdParam: string | null;
    try {
      billIdParam = new URL(sourceUrl).searchParams.get('bill_id');
    } catch {
      return { outcome: 'no-bill-id', count: 0 };
    }
    if (!billIdParam) return { outcome: 'no-bill-id', count: 0 };

    const bill = await this.db.bill.findUnique({
      where: { externalId: billIdParam },
      select: { id: true },
    });
    if (!bill) return { outcome: 'shell-missing', count: 0 };

    // Fetch is a separate failure mode from extraction — a votes page that
    // 404s or times out shouldn't read as "extraction-failed".
    let content: string;
    try {
      const html = await this.fetchUrlText(sourceUrl);
      content = this.htmlToReadableText(html);
    } catch (e) {
      this.logger.warn(
        `Bills: votes page fetch failed for ${sourceUrl}: ${(e as Error).message}`,
      );
      return { outcome: 'fetch-failed', count: 0 };
    }

    try {
      const sessionYear = this.inferSessionYear(sourceUrl);

      // Votes-specific prompt (#889). Previously this reused
      // getBillExtractionPrompt — a bill-METADATA prompt — which never
      // emitted a votes[] array, so every bill extracted 0 votes.
      const { promptText } =
        await this.promptClient.getBillVotesExtractionPrompt({
          regionId,
          sourceUrl,
          sessionYear,
          billId: billIdParam,
          html: content,
        });

      const llmResult = await this.llm.generate(promptText, {
        maxTokens: ds.llmMaxTokens ?? this.billVotesMaxTokens,
        temperature: 0.1,
        requestTimeoutMs:
          ds.llmRequestTimeoutMs ?? this.billVotesRequestTimeoutMs,
      });

      // A large roll-call whose votes JSON exceeds maxTokens is truncated
      // mid-object, so no complete `{...}` slice is found (#894). Surface it
      // as its own outcome — the fix is to raise BILL_VOTES_MAX_TOKENS, not
      // to debug the parser.
      const candidate = extractJsonObjectSlice(llmResult.text);
      if (!candidate) {
        this.logger.warn(
          `Bills: votes extraction produced no JSON object for ${sourceUrl} ` +
            `(${llmResult.text.length} chars; likely maxTokens truncation)`,
        );
        return { outcome: 'extraction-empty', count: 0 };
      }

      let raw: RollCallExtraction;
      try {
        raw = JSON.parse(candidate) as RollCallExtraction;
      } catch (e) {
        this.logger.warn(
          `Bills: votes JSON parse failed for ${sourceUrl}: ` +
            `${(e as Error).message} (candidate ${candidate.length} chars; ` +
            `likely maxTokens truncation)`,
        );
        return { outcome: 'extraction-unparseable', count: 0 };
      }

      // The votes template emits chamber-level roll-call records; flatten to
      // the per-member BillVote[] shape linkBillVotes / bill_votes expect.
      const votes = this.flattenRollCall(raw, billIdParam, sourceUrl);
      if (votes.length === 0) return { outcome: 'no-votes-on-page', count: 0 };

      await this.linkBillVotes(bill.id, votes, repIndex, sourceUrl);
      this.logger.log(
        `Bills: merged ${votes.length} vote(s) for ${billIdParam}`,
      );
      return { outcome: 'votes-upserted', count: votes.length };
    } catch (e) {
      this.logger.warn(
        `Bills: votes extraction failed for ${sourceUrl}: ${(e as Error).message}`,
      );
      return { outcome: 'extraction-failed', count: 0 };
    }
  }

  /**
   * Flatten the votes-extraction roll-call shape
   * `{ votes: [{ chamber, date, motionText, members: [{ name, position }] }] }`
   * into the flat per-member `BillVote[]` the linker consumes. Chamber-level
   * yesCount/noCount tallies are not persisted (the bill_votes table is
   * per-member); members with an unrecognized position — and whole records
   * with a missing/unparseable `date` — are dropped rather than fabricated
   * (`voteDate` is a NOT NULL DATE column; an Invalid Date would reject the
   * entire per-bill insert). Returns [] on `{ skip: true }` or absent votes.
   */
  private flattenRollCall(
    raw: RollCallExtraction,
    billExternalId: string,
    sourceUrl: string,
  ): Bill['votes'] {
    if (raw.skip || !Array.isArray(raw.votes)) return [];
    const flat: Bill['votes'] = [];
    for (const record of raw.votes) {
      if (!record || !Array.isArray(record.members)) continue;
      // Drop the whole record if the date is missing or unparseable — a
      // NOT NULL @db.Date column can't take an Invalid Date, and one bad
      // row would abort createMany for every vote on the bill.
      const voteDate = record.date ? new Date(record.date) : new Date(NaN);
      if (Number.isNaN(voteDate.getTime())) continue;
      const rows = this.flattenRecordMembers(
        record,
        voteDate,
        billExternalId,
        sourceUrl,
      );
      // Surface the "parsed a roll-call but kept nothing" case — it's an
      // extraction-quality signal, not a benign no-votes page (#889 S2).
      if (record.members.length > 0 && rows.length === 0) {
        this.logger.debug(
          `Bills: votes record for ${billExternalId} had ${record.members.length} member(s) but none survived normalization`,
        );
      }
      flat.push(...rows);
    }
    return flat;
  }

  /**
   * Map one roll-call record's members to flat BillVote rows, dropping any
   * member with a missing name or unrecognized position (never fabricated).
   * Extracted from flattenRollCall to keep both under the complexity gate.
   */
  private flattenRecordMembers(
    record: RollCallRecord,
    voteDate: Date,
    billExternalId: string,
    sourceUrl: string,
  ): Bill['votes'] {
    const rows: Bill['votes'] = [];
    for (const m of record.members ?? []) {
      const position = normalizeVotePosition(m?.position);
      if (!m?.name || !position) continue;
      rows.push({
        billExternalId,
        representativeName: m.name,
        chamber: record.chamber ?? '',
        voteDate,
        position,
        motionText: record.motionText ?? undefined,
        sourceUrl,
      });
    }
    return rows;
  }

  private buildBillExternalId(raw: Partial<Bill>): string {
    const year = (raw.sessionYear ?? '').replace(/\D/g, '');
    const num = (raw.billNumber ?? '').replace(/\s/g, '');
    return `${year}${num}`;
  }

  private inferMeasureTypeCode(billNumber: string): string | null {
    return (
      billNumber
        .replace(/\s*\d+.*$/, '')
        .trim()
        .toUpperCase() || null
    );
  }

  private inferSessionYear(url: string): string {
    try {
      const billId = new URL(url).searchParams.get('bill_id');
      if (billId) {
        const m = billId.match(/^(\d{4})(\d{4})/);
        if (m && Number(m[2]) === Number(m[1]) + 1) return `${m[1]}-${m[2]}`;
      }
    } catch {
      /* invalid URL, fall through */
    }
    const m = url.match(/(\d{4})(\d{4})/);
    if (m && Number(m[2]) === Number(m[1]) + 1) return `${m[1]}-${m[2]}`;
    const y = new Date().getFullYear();
    return `${y}-${y + 1}`;
  }

  private async linkBillCoAuthors(
    billId: string,
    names: string[],
    repIndex: Map<string, { id: string; chamber: string }>,
  ): Promise<void> {
    await this.db.billCoAuthor.deleteMany({ where: { billId } });
    const rows = names
      .map((name) => {
        const repId = this.resolveRepByName(name, repIndex);
        return repId
          ? { billId, representativeId: repId, coAuthorType: 'coauthor' }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length > 0) {
      await this.db.billCoAuthor.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
  }

  private async linkBillCommittees(
    billId: string,
    names: string[],
    committeeIndex: Map<string, string>,
  ): Promise<void> {
    await this.db.billCommitteeAssignment.deleteMany({ where: { billId } });
    const rows = names
      .map((name) => {
        // Exact match first; fall back to the normalized-core alias so verbose
        // extracted names link to short canonical committees (#908).
        const committeeId =
          committeeIndex.get(name.toLowerCase().trim()) ??
          committeeIndex.get(normalizeCommitteeName(name));
        return committeeId
          ? { billId, legislativeCommitteeId: committeeId }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length > 0) {
      await this.db.billCommitteeAssignment.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
  }

  private async linkBillVotes(
    billId: string,
    votes: Bill['votes'],
    repIndex: Map<string, { id: string; chamber: string }>,
    sourceUrl: string,
  ): Promise<void> {
    if (votes.length === 0) return;
    await this.db.billVote.deleteMany({ where: { billId } });
    const rows = votes
      .filter((v) => v.representativeName && v.position)
      .map((v) => {
        const voteDate =
          v.voteDate instanceof Date
            ? v.voteDate
            : new Date(v.voteDate as unknown as string);
        return {
          billId,
          representativeId:
            this.resolveRepByName(v.representativeName!, repIndex) ?? null,
          representativeName: v.representativeName!,
          chamber: v.chamber,
          voteDate,
          position: v.position,
          motionText: v.motionText ?? null,
          sourceUrl,
        };
      });
    if (rows.length > 0) {
      await this.db.billVote.createMany({ data: rows, skipDuplicates: true });
    }
  }

  // ─── Civics sync helpers ──────────────────────────────────────────────────────

  private async crawlCivicsUrls(
    ds: DataSourceConfig,
    registeredHosts: Set<string>,
  ): Promise<string[]> {
    const depth = ds.crawlDepth ?? 0;
    const maxPages = ds.crawlMaxPages ?? 20;

    const seed = this.canonicalizeUrl(ds.url);
    const seedUrl = new URL(seed);

    if (
      seedUrl.protocol !== 'https:' ||
      !registeredHosts.has(seedUrl.hostname)
    ) {
      this.logger.error(
        `Civics crawl rejected: ${seedUrl.hostname} is not a registered data source host or is non-HTTPS`,
      );
      return [];
    }

    const pathPrefix = seedUrl.pathname.replace(/[^/]*$/, '');
    const inScope = (u: string): boolean => {
      try {
        const parsed = new URL(u);
        return (
          parsed.host === seedUrl.host && parsed.pathname.startsWith(pathPrefix)
        );
      } catch {
        return false;
      }
    };

    const visited = new Set<string>([seed]);
    const order: string[] = [seed];
    const queue: { url: string; depth: number }[] = [{ url: seed, depth: 0 }];

    while (queue.length > 0 && order.length < maxPages) {
      const { url, depth: d } = queue.shift()!;
      if (d >= depth) continue;
      let html: string;
      try {
        html = await this.fetchUrlText(url);
      } catch (e) {
        this.logger.warn(
          `Civics crawl: fetch failed for ${url}: ${(e as Error).message}`,
        );
        continue;
      }
      for (const link of this.extractLinks(url, html)) {
        const canonical = this.canonicalizeUrl(link);
        if (visited.has(canonical) || !inScope(canonical)) continue;
        visited.add(canonical);
        order.push(canonical);
        queue.push({ url: canonical, depth: d + 1 });
        if (order.length >= maxPages) break;
      }
    }
    return order;
  }

  private canonicalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      u.hash = '';
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  private extractLinks(baseUrl: string, html: string): string[] {
    const out: string[] = [];
    const re = /<a\b[^>]*\bhref\s*=\s*['"]([^'"]+)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const href = m[1].trim().replace(/&amp;/g, '&');
      if (
        !href ||
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('#')
      ) {
        continue;
      }
      try {
        out.push(new URL(href, baseUrl).toString());
      } catch {
        // skip malformed
      }
    }
    return out;
  }

  /**
   * Throttled + retried HTML fetch. Wraps `fetchTextWithRetry` from
   * `./resilient-fetch` so all per-bill / per-page fetches honor the
   * shared per-host gap and back off on 5xx / 429 / timeouts before
   * giving up. See opuspopuli#730.
   */
  private async fetchUrlText(url: string): Promise<string> {
    return fetchTextWithRetry(url, {
      timeoutMs: 20_000,
      throttle: this.hostThrottle,
      logger: this.logger,
    });
  }

  private htmlToReadableText(html: string): string {
    let s = html;
    s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '');
    s = s.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '');
    s = s.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '');
    s = s.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<[^>]+>/g, ' ');
    s = s
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    s = s
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
    return s;
  }
}
