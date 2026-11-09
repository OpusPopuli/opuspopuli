/**
 * Integration tests for the bill-status-summary merged-call path (#823).
 *
 * Complements the unit tests at
 * `apps/backend/src/apps/region/src/domains/region-sync.service.spec.ts` —
 * those mock `DbService`, so they cover the parsing / validation logic but
 * never exercise the actual Prisma writes. These integration cases use the
 * real `postgres_test` database to assert:
 *
 *   - the merged `summary` JSONB round-trips into `bills.aiSummary` with no
 *     shape mutation (drop-in compatibility for the bill-relevance-explanation
 *     #745 consumer)
 *   - the runtime-validated stage id lands in `bills.currentStageId`, while
 *     the LLM's `status.raw`, `lastActionSnippet` and `lastActionDate` do
 *     NOT reach the status-page columns (owner decision 2026-10-22: since F4
 *     those columns drive isDead/isActive, and the status page is their
 *     only source)
 *   - the `{ skip: true }` sentinel is persisted intact and bill-state
 *     columns are NOT overwritten
 *   - the taxonomy guard (no civics_blocks → skip the summarize phase)
 *     short-circuits before any LLM call fires
 *   - LLM-hallucinated out-of-taxonomy stage ids fall through to the
 *     deterministic pattern matcher (the 8% → ~95% stage-coverage win)
 *
 * The LLM provider and the bill-text fetcher are mocked — we don't want
 * Ollama or HTTP network IO in the integration suite. The DB layer + the
 * region-sync orchestration are real.
 *
 * The original issue called for 20 representative CA bill HTMLs against a
 * real LLM. That belongs in an offline LLM-quality validation script, not
 * CI: ~24s × 20 = ~8 min per run, and the assertion is about LLM behaviour
 * not wiring. Wiring is what these integration tests cover end-to-end.
 */

import {
  BillSummaryState,
  summaryStateOf,
} from '../../../src/apps/region/src/domains/bill-summary-state';
import { Test, TestingModule } from '@nestjs/testing';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  PluginLoaderService,
  PluginRegistryService,
  type IRegionPlugin,
} from '@opuspopuli/region-provider';
import {
  RegionSyncService,
  type EnrichmentOutcome,
} from '../../../src/apps/region/src/domains/region-sync.service';
import { RegionCacheService } from '../../../src/apps/region/src/domains/region-cache.service';
import { REGION_CACHE } from '../../../src/apps/region/src/domains/region.tokens';
import { PropositionsSyncService } from '../../../src/apps/region/src/domains/propositions-sync.service';
import { MeetingsSyncService } from '../../../src/apps/region/src/domains/meetings-sync.service';
import { RepresentativesSyncService } from '../../../src/apps/region/src/domains/representatives-sync.service';
import { CampaignFinanceSyncService } from '../../../src/apps/region/src/domains/campaign-finance-sync.service';
import { CivicsSyncService } from '../../../src/apps/region/src/domains/civics-sync.service';
import { RegionPluginService } from '../../../src/apps/region/src/domains/region-plugin.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const REGION_ID = 'california';

/**
 * Two-stage region taxonomy seeded into civics_blocks for every test in
 * this file. Kept small on purpose — the tests are about wiring, not
 * taxonomy fidelity. `statusStringPatterns` are the deterministic-fallback
 * inputs to `resolveStageFromStatus` — the merged-call guard ALSO uses
 * these when the LLM returns `unknown` or an out-of-set id.
 */
const LIFECYCLE_STAGES_JSON = [
  {
    id: 'in_committee',
    name: { verbatim: 'In Committee', plainLanguage: 'In Committee' },
    shortDescription: {
      verbatim: 'Referred to policy committee.',
      plainLanguage: 'Bill is referred to a policy committee.',
    },
    statusStringPatterns: ['Held in Committee', 'In committee'],
  },
  {
    id: 'passed_first_chamber',
    name: {
      verbatim: 'Passed First Chamber',
      plainLanguage: 'Passed First Chamber',
    },
    shortDescription: {
      verbatim: 'Passed house of origin.',
      plainLanguage: 'Bill cleared its house of origin.',
    },
    statusStringPatterns: ['Passed Assembly', 'Passed Senate'],
  },
];

/**
 * Minimal IRegionPlugin stub — the merged enrichment path doesn't call
 * any plugin methods, but PluginRegistryService.getActive() is invoked
 * from the service constructor / refresh logic during module bootstrap.
 */
function buildPlugin(): jest.Mocked<IRegionPlugin> {
  return {
    getName: jest.fn().mockReturnValue(REGION_ID),
    getVersion: jest.fn().mockReturnValue('1.0.0'),
    getRegionInfo: jest.fn().mockReturnValue({
      id: REGION_ID,
      name: 'California',
      description: 'CA',
      timezone: 'America/Los_Angeles',
    }),
    getSupportedDataTypes: jest.fn().mockReturnValue([]),
    getDataSources: jest.fn().mockReturnValue([]),
    initialize: jest.fn(),
    healthCheck: jest.fn(),
    destroy: jest.fn(),
  } as unknown as jest.Mocked<IRegionPlugin>;
}

/**
 * Seed a civics_blocks row carrying the two-stage taxonomy. The merged
 * call requires this — without it, the summarize phase short-circuits.
 */
async function seedCivicsTaxonomy(db: DbService): Promise<void> {
  await db.civicsBlock.create({
    data: {
      regionId: REGION_ID,
      sourceUrl: 'https://example/civics',
      lifecycleStages:
        LIFECYCLE_STAGES_JSON as unknown as Prisma.InputJsonValue,
      chambers: [] as unknown as Prisma.InputJsonValue,
      measureTypes: [] as unknown as Prisma.InputJsonValue,
      glossary: [] as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Seed a bill row with `aiSummary IS NULL` so the enrichment query picks
 * it up. Defaults reflect a CA-shaped legislative bill mid-cycle.
 */
async function seedBill(
  db: DbService,
  overrides: Partial<{
    id: string;
    externalId: string;
    billNumber: string;
    status: string | null;
    currentStageId: string | null;
    fullTextUrl: string | null;
    statusSource: string | null;
    isActive: boolean;
    isDead: boolean;
    lastActionDate: Date | null;
  }> = {},
): Promise<{ id: string }> {
  const id = overrides.id ?? `bill-${Math.random().toString(36).slice(2, 10)}`;
  await db.bill.create({
    data: {
      id,
      regionId: REGION_ID,
      externalId: overrides.externalId ?? `ext-${id}`,
      billNumber: overrides.billNumber ?? 'AB 1',
      sessionYear: '2025-2026',
      measureTypeCode: 'AB',
      title: 'A bill to test the merged enrichment path.',
      sourceUrl: `https://leginfo.legislature.ca.gov/faces/billStatusClient.xhtml?bill_id=${id}`,
      fullTextUrl:
        overrides.fullTextUrl === undefined
          ? 'https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=' +
            id
          : overrides.fullTextUrl,
      status: overrides.status ?? null,
      currentStageId: overrides.currentStageId ?? null,
      statusSource: overrides.statusSource ?? null,
      lastActionDate: overrides.lastActionDate ?? null,
      isActive: overrides.isActive ?? true,
      isDead: overrides.isDead ?? false,
    },
  });
  return { id };
}

/**
 * Build a stub PromptClientService. The wire contract is: a call to
 * `getBillStatusSummaryPrompt` returns a deterministic prompt-text +
 * version. The compose path is exercised by the unit tests in
 * packages/prompt-client; here we only need a placeholder that satisfies
 * the contract so RegionSyncService thinks it has a real client.
 */
function buildPromptClientStub() {
  return {
    getBillStatusSummaryPrompt: jest
      .fn()
      .mockImplementation(async (params: { billNumber: string }) => ({
        promptText: `[merged-prompt for ${params.billNumber}]`,
        promptVersion: 'v1',
        promptHash: 'h',
      })),
    // The served template's hash K6 compares a stored summary's hash with.
    getServedPromptHash: jest
      .fn()
      .mockResolvedValue({ promptHash: 'h', fallback: false }),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('bill-status-summary merge — integration (#823)', () => {
  let service: RegionSyncService;
  let db: DbService;
  let mockRegistry: {
    getActive: jest.Mock;
    getLocal: jest.Mock;
    getAll: jest.Mock;
  };
  let mockLoader: { loadPlugin: jest.Mock };
  let mockPromptClient: ReturnType<typeof buildPromptClientStub>;
  let mockLlm: {
    generate: jest.Mock;
    getModelName: jest.Mock;
    getModelDigest: jest.Mock;
    isAvailable: jest.Mock;
  };

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();

    const plugin = buildPlugin();
    mockRegistry = {
      getActive: jest.fn().mockReturnValue(plugin),
      getLocal: jest.fn().mockReturnValue(plugin),
      getAll: jest
        .fn()
        .mockReturnValue([
          { name: REGION_ID, instance: plugin, status: 'active' },
        ]),
    };
    mockLoader = { loadPlugin: jest.fn().mockResolvedValue(plugin) };
    mockPromptClient = buildPromptClientStub();
    mockLlm = {
      generate: jest.fn(),
      // #1149: writeStatusSummary reads the model for the attribution
      // triple; a mock without it throws inside the enrichment catch and
      // reports failed:1 with no visible error — exactly how this mock
      // gap was found.
      getModelName: jest.fn().mockReturnValue('qwen-it:9b'),
      getModelDigest: jest.fn().mockResolvedValue('sha256:it-digest'),
      isAvailable: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionSyncService,
        // Bounded-context services that RegionSyncService now requires
        // post-#828 (partial refactor). RegionPluginService takes the
        // OnModuleInit slot that used to live on RegionSyncService — Nest
        // resolves the DI graph by constructing it first.
        RegionPluginService,
        PropositionsSyncService,
        MeetingsSyncService,
        RepresentativesSyncService,
        CampaignFinanceSyncService,
        CivicsSyncService,
        { provide: DbService, useValue: db },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: REGION_CACHE, useValue: { get: jest.fn(), set: jest.fn() } },
        RegionCacheService,
      ],
    }).compile();

    service = module.get<RegionSyncService>(RegionSyncService);

    // Wire optional deps after construction so we don't have to recreate
    // the entire dependency graph. The service treats both as optional
    // via @Optional() in the constructor.
    (
      service as unknown as {
        promptClient: unknown;
        llm: unknown;
      }
    ).promptClient = mockPromptClient;
    (
      service as unknown as {
        promptClient: unknown;
        llm: unknown;
      }
    ).llm = mockLlm;
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  // -----------------------------------------------------------------------
  // Helper: call the private enrichBillSummaries directly. Avoids spinning
  // up the entire syncBills orchestration (extraction, votes, pruning) —
  // those phases are tested elsewhere and would dominate the test runtime.
  // -----------------------------------------------------------------------

  type StagePattern = { stageId: string; regex: RegExp };
  type LifecycleStageInput = { id: string; name: string; description: string };
  type HotSelection = { coldAfterDays: number; today: Date };
  type EnrichFn = (
    regionId: string,
    stagePatterns: StagePattern[],
    lifecycleStages: LifecycleStageInput[] | null,
    maxBills?: number,
    hot?: HotSelection,
  ) => Promise<Record<EnrichmentOutcome, number>>;

  const callEnrich = (
    regionId: string,
    stagePatterns: StagePattern[],
    lifecycleStages: LifecycleStageInput[] | null,
    hot?: HotSelection,
  ): Promise<Record<EnrichmentOutcome, number>> =>
    (
      service as unknown as { enrichBillSummaries: EnrichFn }
    ).enrichBillSummaries.bind(service)(
      regionId,
      stagePatterns,
      lifecycleStages,
      undefined,
      hot,
    );

  /**
   * Stub the per-bill HTML fetch + the readability transform so the LLM
   * stub sees a deterministic input. The actual HTML content doesn't
   * matter — only the LLM-response stub does — but the call has to
   * succeed for enrichSingleBill to reach the LLM path.
   */
  function stubFetchUrlText(html = '<html>Bill body</html>'): jest.SpyInstance {
    return jest
      .spyOn(
        service as unknown as { fetchUrlText: (u: string) => Promise<string> },
        'fetchUrlText',
      )
      .mockResolvedValue(html);
  }

  const STAGE_PATTERNS: StagePattern[] = [
    { stageId: 'in_committee', regex: /Held in Committee|In committee/i },
    {
      stageId: 'passed_first_chamber',
      regex: /Passed Assembly|Passed Senate/i,
    },
  ];
  const STAGE_INPUTS: LifecycleStageInput[] = [
    {
      id: 'in_committee',
      name: 'In Committee',
      description: 'Bill is referred to a policy committee.',
    },
    {
      id: 'passed_first_chamber',
      name: 'Passed First Chamber',
      description: 'Bill cleared its house of origin.',
    },
  ];

  // -----------------------------------------------------------------------
  // Tests
  // -----------------------------------------------------------------------

  it('writes the merged response shape — summary JSONB + stage, status-page columns untouched (happy path)', async () => {
    await seedCivicsTaxonomy(db);
    const { id } = await seedBill(db, {
      status: 'Introduced',
      currentStageId: null,
    });
    stubFetchUrlText();
    mockLlm.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        status: {
          raw: 'Senate - Held in Committee',
          stage: 'in_committee',
          lastActionDate: '2026-05-30',
          lastActionSnippet: 'Referred to Com. on JUD.',
        },
        summary: {
          plainEnglishSummary: 'Caps ADU fees at $1000.',
          topics: ['housing'],
          whoItAffects: ['homeowners'],
          fiscalImpact: { level: 'low', summary: 'Negligible state cost.' },
          stakeholderImpact: 'Homeowners benefit.',
        },
      }),
      tokensUsed: 1234,
    });

    const result = await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS);

    expect(result).toEqual({
      enriched: 1,
      skipped: 0,
      failed: 0,
      tooLarge: 0,
      truncated: 0,
    });

    // The per-region taxonomy + prior-state both have to reach the prompt
    // client verbatim — drift here is the failure mode #823 explicitly
    // designs against. Asserting here catches a refactor that loses the
    // taxonomy threading before the rendered prompt would notice.
    expect(mockPromptClient.getBillStatusSummaryPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        regionId: REGION_ID,
        billNumber: 'AB 1',
        lifecycleStages: STAGE_INPUTS,
        priorStatus: 'Introduced',
        // currentStageId was null on the seeded bill, so priorStage maps
        // to undefined per the optional-field convention.
        priorStage: undefined,
      }),
    );

    const row = await db.bill.findUniqueOrThrow({ where: { id } });
    // status.stage lands in bills.currentStageId after taxonomy validation
    expect(row.currentStageId).toBe('in_committee');
    // The LLM's status-page fields are not written: the scraped status
    // stands, and lastAction/lastActionDate keep their seeded (null) values.
    expect(row.status).toBe('Introduced');
    expect(row.lastAction).toBeNull();
    expect(row.lastActionDate).toBeNull();
    // ...and the flags are computed from what is stored, in the same write.
    expect(row.isDead).toBe(false);
    // summary block round-trips as JSONB — drop-in shape for #745 consumer
    expect(row.aiSummary).toMatchObject({
      plainEnglishSummary: 'Caps ADU fees at $1000.',
      topics: ['housing'],
      whoItAffects: ['homeowners'],
      fiscalImpact: { level: 'low', summary: 'Negligible state cost.' },
      stakeholderImpact: 'Homeowners benefit.',
    });
    expect(row.aiSummaryVersion).toBe('v1');
    // #1149 — the attribution triple lands on the real row.
    expect(row.aiSummaryPromptVersion).toBe('v1');
    expect(row.aiSummaryPromptHash).toBe('h');
    expect(row.aiSummaryLlmModel).toBe('qwen-it:9b');
    // F3/K6: and the exact model build.
    expect(row.aiSummaryLlmDigest).toBe('sha256:it-digest');
  });

  it('persists the { skip: true } sentinel without touching status / stage / lastActionDate', async () => {
    await seedCivicsTaxonomy(db);
    // Pre-seed status + stage so we can prove the skip path left them alone.
    const { id } = await seedBill(db, {
      status: 'Pre-existing status text',
      currentStageId: 'in_committee',
    });
    stubFetchUrlText();
    mockLlm.generate.mockResolvedValueOnce({
      text: JSON.stringify({ skip: true }),
      tokensUsed: 100,
    });

    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS);

    const row = await db.bill.findUniqueOrThrow({ where: { id } });
    expect(row.aiSummary).toEqual({ skip: true });
    // Bill-state columns untouched — important because skip semantically
    // means "we couldn't extract from this input", not "status reverted".
    expect(row.status).toBe('Pre-existing status text');
    expect(row.currentStageId).toBe('in_committee');
  });

  it('falls back to the pattern matcher when the LLM returns an out-of-taxonomy stage', async () => {
    // Reproduces the 8% → ~95% stage-coverage win: even if the LLM
    // hallucinates "vetoed" (not in the region's two-stage taxonomy), the
    // OFFICIAL status "Passed Assembly" matches the pattern matcher's
    // `passed_first_chamber` regex. The LLM's own status.raw says otherwise
    // and must lose: it is not the LLM's to decide (owner decision).
    await seedCivicsTaxonomy(db);
    const { id } = await seedBill(db, { status: 'Passed Assembly' });
    stubFetchUrlText();
    mockLlm.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        status: {
          raw: 'Held in Committee',
          stage: 'vetoed', // out of taxonomy
          lastActionDate: null,
          lastActionSnippet: null,
        },
        summary: { plainEnglishSummary: '...' },
      }),
      tokensUsed: 500,
    });

    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS);

    const row = await db.bill.findUniqueOrThrow({ where: { id } });
    // The scraped status stands, and it — not the LLM's raw — picked the stage.
    expect(row.status).toBe('Passed Assembly');
    expect(row.currentStageId).toBe('passed_first_chamber');
  });

  it('leaves currentStageId NULL when neither the LLM nor the pattern matcher resolves', async () => {
    // Total miss → bill stays eligible for re-enrichment after a prompt
    // template bump. No bad data lands.
    await seedCivicsTaxonomy(db);
    const { id } = await seedBill(db);
    stubFetchUrlText();
    mockLlm.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        status: {
          raw: 'Some weird status string no pattern catches',
          stage: 'unknown',
          lastActionDate: null,
          lastActionSnippet: null,
        },
        summary: { plainEnglishSummary: '...' },
      }),
      tokensUsed: 500,
    });

    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS);

    const row = await db.bill.findUniqueOrThrow({ where: { id } });
    expect(row.currentStageId).toBeNull();
    // But the verbatim status is still written — operator can see it.
    // The LLM's status.raw is neither written nor used for the fallback.
    expect(row.status).toBeNull();
  });

  it('counts a non-object LLM payload as failed without writing aiSummary', async () => {
    // The LLM occasionally returns `[]` or bare strings — those must NOT
    // land in the column, otherwise the bill is locked out of the retry
    // query (`ai_summary IS NULL`) with garbage.
    await seedCivicsTaxonomy(db);
    const { id } = await seedBill(db);
    stubFetchUrlText();
    mockLlm.generate.mockResolvedValueOnce({
      text: '[]',
      tokensUsed: 50,
    });

    const result = await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS);

    expect(result.failed).toBe(1);
    const row = await db.bill.findUniqueOrThrow({ where: { id } });
    expect(row.aiSummary).toBeNull();
  });

  it('skips the summarize phase entirely when the region has no civics_blocks taxonomy', async () => {
    // No civics_blocks → no LLM call, no DB writes, just a warn log.
    const { id } = await seedBill(db);
    stubFetchUrlText();

    const result = await callEnrich(REGION_ID, STAGE_PATTERNS, null);

    expect(result).toEqual({
      enriched: 0,
      skipped: 0,
      failed: 0,
      tooLarge: 0,
      truncated: 0,
    });
    expect(mockLlm.generate).not.toHaveBeenCalled();
    const row = await db.bill.findUniqueOrThrow({ where: { id } });
    expect(row.aiSummary).toBeNull();
  });

  it('only picks up bills where aiSummary IS NULL (idempotency guard)', async () => {
    // The retry guard is what makes re-running the enrichment phase safe
    // after a partial failure. Bills that have ANY value in aiSummary —
    // including the { skip: true } sentinel — must stay untouched.
    await seedCivicsTaxonomy(db);
    const targetBill = await seedBill(db, {
      id: 'target',
      externalId: 'ext-target',
      billNumber: 'AB 100',
    });
    const settledBill = await seedBill(db, {
      id: 'settled',
      externalId: 'ext-settled',
      billNumber: 'AB 200',
    });
    // Mark the settled bill as already summarized.
    await db.bill.update({
      where: { id: settledBill.id },
      data: {
        aiSummary: {
          plainEnglishSummary: 'Pre-existing.',
        } as Prisma.InputJsonValue,
        aiSummaryVersion: 'v0',
      },
    });

    stubFetchUrlText();
    mockLlm.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        status: { raw: 'X', stage: 'in_committee' },
        summary: { plainEnglishSummary: 'Fresh.' },
      }),
      tokensUsed: 100,
    });

    const result = await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS);

    expect(result.enriched).toBe(1);
    // LLM called exactly once — for the target, not for the settled bill.
    expect(mockLlm.generate).toHaveBeenCalledTimes(1);

    const target = await db.bill.findUniqueOrThrow({
      where: { id: targetBill.id },
    });
    expect(target.aiSummary).toMatchObject({ plainEnglishSummary: 'Fresh.' });

    const settled = await db.bill.findUniqueOrThrow({
      where: { id: settledBill.id },
    });
    expect(settled.aiSummary).toMatchObject({
      plainEnglishSummary: 'Pre-existing.',
    });
    expect(settled.aiSummaryVersion).toBe('v0');
  });

  // -----------------------------------------------------------------------
  // Bills from the pubinfo export (bills-phase-b.md, D9, K6, D5)
  // -----------------------------------------------------------------------

  const SUMMARY_RESPONSE = {
    text: JSON.stringify({
      status: { raw: 'X', stage: 'in_committee' },
      summary: { plainEnglishSummary: 'From the export text.' },
    }),
    tokensUsed: 10,
  };
  const TODAY = new Date('2026-10-22T12:00:00Z');
  const HOT = { coldAfterDays: 180, today: TODAY };
  const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);

  it("reads an official bill's text from the export mirror, not the page", async () => {
    await seedCivicsTaxonomy(db);
    await seedBill(db, {
      id: 'official',
      externalId: '202520260AB9001',
      statusSource: 'official',
      status: 'In Committee Process',
    });
    await db.pubinfoBillVersion.createMany({
      data: [
        {
          externalId: 'V99',
          billId: '202520260AB9001',
          versionNum: 99,
          billVersionActionDate: new Date('2025-02-01'),
          billXml: '<caml:Bill>introduced text</caml:Bill>',
        },
        {
          externalId: 'V98',
          billId: '202520260AB9001',
          versionNum: 98,
          billVersionActionDate: new Date('2025-04-01'),
          billXml: '<caml:Bill>current amended text</caml:Bill>',
        },
      ],
    });
    const fetch = stubFetchUrlText();
    mockLlm.generate.mockResolvedValueOnce(SUMMARY_RESPONSE);

    const result = await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS);

    expect(result.enriched).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    const { html } = mockPromptClient.getBillStatusSummaryPrompt.mock
      .calls[0][0] as { html: string };
    expect(html).toContain('current amended text');
    expect(html).not.toContain('introduced text');
  });

  it("keeps an official bill's flags through the summary write", async () => {
    // The summary write recomputes flags (F4). For an official row it must
    // leave them as the export derive set them: the regex rules would read
    // "In Committee Process" as not "Active Bill", so inactive (B8).
    await seedCivicsTaxonomy(db);
    const { id } = await seedBill(db, {
      statusSource: 'official',
      status: 'In Committee Process',
      isActive: true,
    });
    stubFetchUrlText();
    mockLlm.generate.mockResolvedValueOnce(SUMMARY_RESPONSE);

    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS);

    const row = await db.bill.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ isActive: true, isDead: false });
  });

  it('summarizes hot bills only (K6, D1, D2)', async () => {
    await seedCivicsTaxonomy(db);
    await seedBill(db, { id: 'active', isActive: true });
    await seedBill(db, {
      id: 'recently-enacted',
      isActive: false,
      lastActionDate: daysAgo(30),
    });
    await seedBill(db, {
      id: 'cold',
      isActive: false,
      lastActionDate: daysAgo(200),
    });
    await seedBill(db, {
      id: 'dead',
      isActive: false,
      isDead: true,
      lastActionDate: daysAgo(5),
    });
    stubFetchUrlText();
    mockLlm.generate.mockResolvedValue(SUMMARY_RESPONSE);

    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);

    const summarized = await db.bill.findMany({
      where: { NOT: { aiSummary: { equals: Prisma.DbNull } } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(summarized.map((b) => b.id)).toEqual(['active', 'recently-enacted']);
  });

  it('regenerates a hot summary with no prompt hash, never the skip sentinel (D5)', async () => {
    await seedCivicsTaxonomy(db);
    const unattributed = await seedBill(db, { id: 'unattributed' });
    const sentinel = await seedBill(db, { id: 'sentinel' });
    await db.bill.update({
      where: { id: unattributed.id },
      data: {
        aiSummary: { plainEnglishSummary: 'Old.' } as Prisma.InputJsonValue,
      },
    });
    await db.bill.update({
      where: { id: sentinel.id },
      data: { aiSummary: { skip: true } as Prisma.InputJsonValue },
    });
    stubFetchUrlText();
    mockLlm.generate.mockResolvedValue(SUMMARY_RESPONSE);

    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);

    expect(mockLlm.generate).toHaveBeenCalledTimes(1);
    const row = await db.bill.findUniqueOrThrow({
      where: { id: unattributed.id },
    });
    expect(row.aiSummary).toMatchObject({
      plainEnglishSummary: 'From the export text.',
    });
    expect(row.aiSummaryPromptHash).toBe('h');
  });

  it('records a failed summary and waits a week before trying it again', async () => {
    await seedCivicsTaxonomy(db);
    const { id } = await seedBill(db);
    stubFetchUrlText();
    mockLlm.generate.mockResolvedValueOnce({ text: '[]', tokensUsed: 50 });

    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);
    const failed = await db.bill.findUniqueOrThrow({ where: { id } });
    expect(failed.aiSummaryFailedAt).not.toBeNull();

    // The next sync leaves it alone: it would lead again and trip the abort.
    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);
    expect(mockLlm.generate).toHaveBeenCalledTimes(1);

    // A week on it is tried again, and a success clears the mark.
    await db.bill.update({
      where: { id },
      data: { aiSummaryFailedAt: daysAgo(8) },
    });
    mockLlm.generate.mockResolvedValue(SUMMARY_RESPONSE);
    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);
    const retried = await db.bill.findUniqueOrThrow({ where: { id } });
    expect(retried.aiSummary).not.toBeNull();
    expect(retried.aiSummaryFailedAt).toBeNull();
  });

  it('tries bills that never failed before a retry', async () => {
    await seedCivicsTaxonomy(db);
    const retry = await seedBill(db, { id: 'a-retry' });
    await seedBill(db, { id: 'b-fresh' });
    await db.bill.update({
      where: { id: retry.id },
      data: { aiSummaryFailedAt: daysAgo(8) },
    });
    stubFetchUrlText();
    mockLlm.generate.mockResolvedValue(SUMMARY_RESPONSE);

    await (
      service as unknown as { enrichBillSummaries: EnrichFn }
    ).enrichBillSummaries.bind(service)(
      REGION_ID,
      STAGE_PATTERNS,
      STAGE_INPUTS,
      1,
      HOT,
    );

    const summarized = await db.bill.findMany({
      where: { NOT: { aiSummary: { equals: Prisma.DbNull } } },
      select: { id: true },
    });
    expect(summarized.map((b) => b.id)).toEqual(['b-fresh']);
  });

  it('makes a bill with no text wait, so it does not hold a place every sync', async () => {
    await seedCivicsTaxonomy(db);
    const { id } = await seedBill(db, { fullTextUrl: null });

    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);

    const row = await db.bill.findUniqueOrThrow({ where: { id } });
    expect(row.aiSummaryFailedAt).not.toBeNull();
  });

  it('makes a bill wait after any failed attempt, a timeout or not', async () => {
    // A failure the code cannot classify would otherwise lead every sync.
    await seedCivicsTaxonomy(db);
    const timedOut = await seedBill(db, { id: 'a-timed-out' });
    const refused = await seedBill(db, { id: 'b-refused' });
    stubFetchUrlText();
    mockLlm.generate
      .mockRejectedValueOnce(new Error('Request timed out after 120000ms'))
      .mockRejectedValueOnce(new Error('HTTP 403 Forbidden'));

    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);

    const rows = await db.bill.findMany({
      where: { id: { in: [timedOut.id, refused.id] } },
      select: { aiSummaryFailedAt: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.aiSummaryFailedAt !== null)).toBe(true);
  });

  it('does not make a bill wait for a failure while the model is down', async () => {
    await seedCivicsTaxonomy(db);
    const { id } = await seedBill(db);
    stubFetchUrlText();
    mockLlm.isAvailable.mockResolvedValue(false);
    mockLlm.generate.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 127.0.0.1:11434'),
    );

    await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);

    const row = await db.bill.findUniqueOrThrow({ where: { id } });
    expect(row.aiSummaryFailedAt).toBeNull();
  });

  describe('K6: a summary is regenerated when what wrote it changed', () => {
    /** An official bill with two versions; V98 is current (lowest number). */
    const seedOfficial = async (id: string) => {
      const externalId = `202520260AB${id}`;
      await seedBill(db, {
        id,
        externalId,
        billNumber: `AB ${id}`,
        statusSource: 'official',
        status: 'In Committee Process',
      });
      await db.pubinfoBillVersion.createMany({
        data: [
          {
            externalId: `${id}-V99`,
            billId: externalId,
            versionNum: 99,
            billVersionActionDate: new Date('2025-02-01'),
            billXml: '<caml:Bill>introduced</caml:Bill>',
          },
          {
            externalId: `${id}-V98`,
            billId: externalId,
            versionNum: 98,
            billVersionActionDate: new Date('2025-04-01'),
            billXml: '<caml:Bill>amended</caml:Bill>',
          },
        ],
      });
      return { id, current: `${id}-V98`, previous: `${id}-V99` };
    };

    /** A summary as the live prompt, model and current version wrote it. */
    const summarized = (
      sourceVersion: string,
      over: Partial<Prisma.BillUpdateInput> = {},
    ): Prisma.BillUpdateInput => ({
      aiSummary: { plainEnglishSummary: 'Old.' } as Prisma.InputJsonValue,
      aiSummaryPromptHash: 'h',
      aiSummaryLlmDigest: 'sha256:it-digest',
      aiSummarySourceVersion: sourceVersion,
      aiSummaryGeneratedAt: new Date('2026-11-01T00:00:00Z'),
      ...over,
    });

    const summarize = async (bill: { id: string }, data: object) => {
      await db.bill.update({ where: { id: bill.id }, data });
      await seedCivicsTaxonomy(db);
      mockLlm.generate.mockResolvedValue(SUMMARY_RESPONSE);
      await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);
      return db.bill.findUniqueOrThrow({ where: { id: bill.id } });
    };

    it('leaves a summary written under the live prompt, model and version', async () => {
      const bill = await seedOfficial('9101');

      await summarize(bill, summarized(bill.current));

      expect(mockLlm.generate).not.toHaveBeenCalled();
    });

    it('regenerates one written under another prompt template', async () => {
      const bill = await seedOfficial('9102');

      const row = await summarize(
        bill,
        summarized(bill.current, { aiSummaryPromptHash: 'old-template' }),
      );

      expect(mockLlm.generate).toHaveBeenCalledTimes(1);
      expect(row.aiSummaryPromptHash).toBe('h');
    });

    it('regenerates one written by another model build', async () => {
      const bill = await seedOfficial('9103');

      const row = await summarize(
        bill,
        summarized(bill.current, { aiSummaryLlmDigest: 'sha256:old-build' }),
      );

      expect(mockLlm.generate).toHaveBeenCalledTimes(1);
      expect(row.aiSummaryLlmDigest).toBe('sha256:it-digest');
    });

    it('regenerates one of an older version, and records the version it read', async () => {
      const bill = await seedOfficial('9104');

      const row = await summarize(bill, summarized(bill.previous));

      expect(mockLlm.generate).toHaveBeenCalledTimes(1);
      expect(row.aiSummarySourceVersion).toBe(bill.current);
    });

    it('retries a skip sentinel only when the bill has a new version', async () => {
      const same = await seedOfficial('9105');
      const amended = await seedOfficial('9106');
      const skip = { skip: true } as Prisma.InputJsonValue;
      await db.bill.update({
        where: { id: same.id },
        data: summarized(same.current, {
          aiSummary: skip,
          aiSummaryPromptHash: 'old-template',
        }),
      });

      const row = await summarize(
        amended,
        summarized(amended.previous, { aiSummary: skip }),
      );

      expect(mockLlm.generate).toHaveBeenCalledTimes(1);
      expect(row.aiSummarySourceVersion).toBe(amended.current);
    });

    it('selects exactly the bills summaryStateOf calls not current (D7 pin)', async () => {
      // The batch selects in SQL; the reader's page judges one bill in
      // TypeScript. Both encode K6's rule, and must not drift apart.
      await seedCivicsTaxonomy(db);
      const skip = { skip: true } as Prisma.InputJsonValue;
      const cases: [
        string,
        (b: Awaited<ReturnType<typeof seedOfficial>>) => object,
      ][] = [
        ['9201', (b) => summarized(b.current)],
        ['9202', (b) => summarized(b.current, { aiSummaryPromptHash: 'old' })],
        ['9203', (b) => summarized(b.current, { aiSummaryLlmDigest: 'x' })],
        ['9204', (b) => summarized(b.current, { aiSummaryLlmDigest: null })],
        ['9205', (b) => summarized(b.previous)],
        ['9206', () => ({})],
        [
          '9207',
          (b) =>
            summarized(b.current, {
              aiSummary: skip,
              aiSummaryPromptHash: 'old',
            }),
        ],
        ['9208', (b) => summarized(b.previous, { aiSummary: skip })],
      ];
      const expected: string[] = [];
      for (const [id, data] of cases) {
        const bill = await seedOfficial(id);
        await db.bill.update({ where: { id }, data: data(bill) });
        const row = await db.bill.findUniqueOrThrow({ where: { id } });
        const state = summaryStateOf(row, {
          promptHash: 'h',
          modelDigest: 'sha256:it-digest',
          currentVersion: bill.current,
        });
        if (state !== BillSummaryState.CURRENT) expected.push(id);
      }
      mockLlm.generate.mockResolvedValue(SUMMARY_RESPONSE);
      const generated: string[] = [];
      mockPromptClient.getBillStatusSummaryPrompt.mockImplementation(
        async (params: { billNumber: string }) => {
          generated.push(params.billNumber);
          return { promptText: 'p', promptVersion: 'v1', promptHash: 'h' };
        },
      );

      await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);

      const numbers = await db.bill.findMany({
        where: { id: { in: expected } },
        select: { billNumber: true },
      });
      expect(generated.sort()).toEqual(numbers.map((b) => b.billNumber).sort());
      expect(expected).toEqual([
        '9202',
        '9203',
        '9204',
        '9205',
        '9206',
        '9208',
      ]);
    });

    it('skips the pass when the live template hash cannot be read', async () => {
      // Else every summary would look stale and the region be regenerated.
      await seedCivicsTaxonomy(db);
      const bill = await seedOfficial('9107');
      mockPromptClient.getServedPromptHash.mockRejectedValueOnce(
        new Error('prompt service down'),
      );
      mockLlm.generate.mockResolvedValue(SUMMARY_RESPONSE);

      const result = await callEnrich(
        REGION_ID,
        STAGE_PATTERNS,
        STAGE_INPUTS,
        HOT,
      );

      expect(result).toEqual({
        enriched: 0,
        skipped: 0,
        failed: 0,
        tooLarge: 0,
        truncated: 0,
      });
      expect(mockLlm.generate).not.toHaveBeenCalled();
      const row = await db.bill.findUniqueOrThrow({ where: { id: bill.id } });
      expect(row.aiSummary).toBeNull();
    });

    it('under the local fallback, writes missing summaries but refreshes none', async () => {
      // The local copy may have drifted; against it every summary looks stale.
      await seedCivicsTaxonomy(db);
      const stale = await seedOfficial('9108');
      const missing = await seedOfficial('9114');
      await db.bill.update({
        where: { id: stale.id },
        data: summarized(stale.current, { aiSummaryPromptHash: 'old' }),
      });
      mockPromptClient.getServedPromptHash.mockResolvedValueOnce({
        promptHash: 'drifted-local',
        fallback: true,
      });
      mockLlm.generate.mockResolvedValue(SUMMARY_RESPONSE);

      await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);

      expect(mockLlm.generate).toHaveBeenCalledTimes(1);
      const rows = await db.bill.findMany({
        where: { id: { in: [stale.id, missing.id] } },
        select: { id: true, aiSummaryPromptHash: true },
        orderBy: { id: 'asc' },
      });
      expect(rows).toEqual([
        { id: stale.id, aiSummaryPromptHash: 'old' },
        { id: missing.id, aiSummaryPromptHash: 'h' },
      ]);
    });

    it('names the same current version when two share a number (no loop)', async () => {
      const bill = await seedOfficial('9115');
      await db.pubinfoBillVersion.create({
        data: {
          externalId: `9115-V98A`,
          billId: '202520260AB9115',
          versionNum: 98,
          billVersionActionDate: new Date('2025-04-01'),
          billXml: '<caml:Bill>tied</caml:Bill>',
        },
      });
      await summarize(bill, summarized(bill.previous));
      expect(mockLlm.generate).toHaveBeenCalledTimes(1);

      await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);

      expect(mockLlm.generate).toHaveBeenCalledTimes(1);
    });

    it('does not regenerate what it just wrote (no loop)', async () => {
      const bill = await seedOfficial('9109');
      await summarize(bill, summarized(bill.previous));
      expect(mockLlm.generate).toHaveBeenCalledTimes(1);

      await callEnrich(REGION_ID, STAGE_PATTERNS, STAGE_INPUTS, HOT);

      expect(mockLlm.generate).toHaveBeenCalledTimes(1);
    });

    it('does not judge the model build when the live digest is unknown', async () => {
      const bill = await seedOfficial('9110');
      // A summary with no recorded build is not stale while the live build
      // is unknown either: there is nothing to compare.
      mockLlm.getModelDigest.mockResolvedValue(undefined);

      await summarize(
        bill,
        summarized(bill.current, { aiSummaryLlmDigest: null }),
      );

      expect(mockLlm.generate).not.toHaveBeenCalled();
    });

    it('leaves a page-scraped summary under the live prompt alone (no version)', async () => {
      const { id } = await seedBill(db, { id: 'page-bill' });

      await summarize({ id }, summarized('', { aiSummarySourceVersion: null }));

      expect(mockLlm.generate).not.toHaveBeenCalled();
    });

    it('does not chase a newer version that has no text', async () => {
      // It would fail and wait, every week, forever.
      const bill = await seedOfficial('9113');
      await db.pubinfoBillVersion.update({
        where: { externalId: bill.current },
        data: { billXml: null },
      });

      const row = await summarize(bill, summarized(bill.previous));

      expect(mockLlm.generate).not.toHaveBeenCalled();
      expect(row.aiSummaryFailedAt).toBeNull();
    });

    it('summarizes a bill with no summary before refreshing an old one', async () => {
      const stale = await seedOfficial('9111');
      const fresh = await seedOfficial('9112');
      await db.bill.update({
        where: { id: stale.id },
        data: summarized(stale.current, { aiSummaryPromptHash: 'old' }),
      });
      await seedCivicsTaxonomy(db);
      mockLlm.generate.mockResolvedValue(SUMMARY_RESPONSE);

      await (
        service as unknown as { enrichBillSummaries: EnrichFn }
      ).enrichBillSummaries.bind(service)(
        REGION_ID,
        STAGE_PATTERNS,
        STAGE_INPUTS,
        1,
        HOT,
      );

      const row = await db.bill.findUniqueOrThrow({ where: { id: fresh.id } });
      expect(row.aiSummary).not.toBeNull();
    });
  });
});
