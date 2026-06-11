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
 *   - `status.raw` lands in `bills.status` and the runtime-validated
 *     stage id lands in `bills.currentStageId`
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

import { Test, TestingModule } from '@nestjs/testing';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  PluginLoaderService,
  PluginRegistryService,
  type IRegionPlugin,
} from '@opuspopuli/region-provider';
import { RegionSyncService } from '../../../src/apps/region/src/domains/region-sync.service';
import { RegionCacheService } from '../../../src/apps/region/src/domains/region-cache.service';
import { REGION_CACHE } from '../../../src/apps/region/src/domains/region.tokens';
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
      isActive: true,
      isDead: false,
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
  let mockLlm: { generate: jest.Mock };

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
    mockLlm = { generate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionSyncService,
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
  type EnrichFn = (
    regionId: string,
    stagePatterns: StagePattern[],
    lifecycleStages: LifecycleStageInput[] | null,
    maxBills?: number,
  ) => Promise<{ enriched: number; skipped: number; failed: number }>;

  const callEnrich = (
    regionId: string,
    stagePatterns: StagePattern[],
    lifecycleStages: LifecycleStageInput[] | null,
  ): Promise<{ enriched: number; skipped: number; failed: number }> =>
    (
      service as unknown as { enrichBillSummaries: EnrichFn }
    ).enrichBillSummaries.bind(service)(
      regionId,
      stagePatterns,
      lifecycleStages,
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

  it('writes the merged response shape — summary JSONB + status + stage + lastActionDate (happy path)', async () => {
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

    expect(result).toEqual({ enriched: 1, skipped: 0, failed: 0 });

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
    // status.raw lands verbatim in bills.status
    expect(row.status).toBe('Senate - Held in Committee');
    // status.stage lands in bills.currentStageId after taxonomy validation
    expect(row.currentStageId).toBe('in_committee');
    // status.lastActionSnippet lands in bills.lastAction (S-2: keeps the
    // bill-extraction view + the merged-call view in lockstep)
    expect(row.lastAction).toBe('Referred to Com. on JUD.');
    // status.lastActionDate is parsed to a Date
    expect(row.lastActionDate?.toISOString()).toBe('2026-05-30T00:00:00.000Z');
    // summary block round-trips as JSONB — drop-in shape for #745 consumer
    expect(row.aiSummary).toMatchObject({
      plainEnglishSummary: 'Caps ADU fees at $1000.',
      topics: ['housing'],
      whoItAffects: ['homeowners'],
      fiscalImpact: { level: 'low', summary: 'Negligible state cost.' },
      stakeholderImpact: 'Homeowners benefit.',
    });
    expect(row.aiSummaryVersion).toBe('v1');
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
    // raw status text "Passed Assembly" matches the pattern matcher's
    // `passed_first_chamber` regex.
    await seedCivicsTaxonomy(db);
    const { id } = await seedBill(db);
    stubFetchUrlText();
    mockLlm.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        status: {
          raw: 'Passed Assembly',
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
    expect(row.status).toBe('Some weird status string no pattern catches');
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

    expect(result).toEqual({ enriched: 0, skipped: 0, failed: 0 });
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
});
