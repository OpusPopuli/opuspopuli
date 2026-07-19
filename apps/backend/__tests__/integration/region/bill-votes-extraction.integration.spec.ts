/**
 * Integration tests for votes_only extraction (#889).
 *
 * Complements the unit tests at
 * `apps/backend/src/apps/region/src/domains/region-sync.service.spec.ts`
 * (which mock `DbService`). These use the real `postgres_test` database to
 * assert that `extractVotesOnlyPage` → `linkBillVotes` actually writes
 * `bill_votes` rows — the end-to-end path that regressed to 0 rows in #889
 * because votes_only reused the bill-metadata prompt and never emitted a
 * votes[] array.
 *
 * The LLM provider, the prompt client, and the votes-page fetch are stubbed
 * (no Ollama / HTTP IO in CI); the DB writes and the region-sync
 * orchestration are real.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  PluginLoaderService,
  PluginRegistryService,
  type IRegionPlugin,
} from '@opuspopuli/region-provider';
import { RegionSyncService } from '../../../src/apps/region/src/domains/region-sync.service';
import { RegionCacheService } from '../../../src/apps/region/src/domains/region-cache.service';
import { REGION_CACHE } from '../../../src/apps/region/src/domains/region.tokens';
import { PropositionsSyncService } from '../../../src/apps/region/src/domains/propositions-sync.service';
import { MeetingsSyncService } from '../../../src/apps/region/src/domains/meetings-sync.service';
import { RepresentativesSyncService } from '../../../src/apps/region/src/domains/representatives-sync.service';
import { CampaignFinanceSyncService } from '../../../src/apps/region/src/domains/campaign-finance-sync.service';
import { CivicsSyncService } from '../../../src/apps/region/src/domains/civics-sync.service';
import { RegionPluginService } from '../../../src/apps/region/src/domains/region-plugin.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const REGION_ID = 'california';
// A known Chaptered bill from the issue — its votes page returns roll-call
// markup (Ayes/Noes) in the fetched HTML.
const BILL_EXTERNAL_ID = '202520260AB42';
const VOTES_URL = `https://leginfo.legislature.ca.gov/faces/billVotesClient.xhtml?bill_id=${BILL_EXTERNAL_ID}`;

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

/** Seed the bill SHELL the votes page keys off (externalId === bill_id). */
async function seedBillShell(db: DbService, id = 'bill-ab42'): Promise<string> {
  await db.bill.create({
    data: {
      id,
      regionId: REGION_ID,
      externalId: BILL_EXTERNAL_ID,
      billNumber: 'AB 42',
      sessionYear: '2025-2026',
      measureTypeCode: 'AB',
      title: 'A bill whose votes we extract.',
      sourceUrl: `https://leginfo.legislature.ca.gov/faces/billStatusClient.xhtml?bill_id=${BILL_EXTERNAL_ID}`,
      status: 'Chaptered',
      isActive: false,
      isDead: false,
    },
  });
  return id;
}

/** Roll-call JSON as the bill-votes-extraction prompt would have the LLM emit. */
const ROLL_CALL_JSON = JSON.stringify({
  billId: BILL_EXTERNAL_ID,
  votes: [
    {
      chamber: 'Assembly',
      date: '2025-05-01',
      motionText: 'Do Pass',
      yesCount: 2,
      noCount: 1,
      members: [
        { name: 'Alice Smith', position: 'yes', party: 'D' },
        { name: 'Bob Jones', position: 'no', party: 'R' },
        { name: 'Carol Lee', position: 'abstain', party: 'D' },
      ],
    },
  ],
});

describe('votes_only extraction — integration (#889)', () => {
  let service: RegionSyncService;
  let db: DbService;
  let mockPromptClient: { getBillVotesExtractionPrompt: jest.Mock };
  let mockLlm: { generate: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();

    const plugin = buildPlugin();
    const mockRegistry = {
      getActive: jest.fn().mockReturnValue(plugin),
      getLocal: jest.fn().mockReturnValue(plugin),
      getAll: jest
        .fn()
        .mockReturnValue([
          { name: REGION_ID, instance: plugin, status: 'active' },
        ]),
    };
    const mockLoader = { loadPlugin: jest.fn().mockResolvedValue(plugin) };

    mockPromptClient = {
      getBillVotesExtractionPrompt: jest.fn().mockResolvedValue({
        promptText: '[votes prompt]',
        promptVersion: 'v1',
        promptHash: 'h',
      }),
    };
    mockLlm = {
      generate: jest.fn().mockResolvedValue({ text: ROLL_CALL_JSON }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionSyncService,
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

    // Wire the optional (@Optional()) deps after construction.
    (
      service as unknown as { promptClient: unknown; llm: unknown }
    ).promptClient = mockPromptClient;
    (service as unknown as { promptClient: unknown; llm: unknown }).llm =
      mockLlm;

    // Stub the votes-page fetch — the HTML content is irrelevant here since
    // the LLM response is stubbed; only that the fetch resolves matters.
    fetchSpy = jest
      .spyOn(
        service as unknown as { fetchUrlText: (u: string) => Promise<string> },
        'fetchUrlText',
      )
      .mockResolvedValue('<html>Ayes Count 2 Noes Count 1</html>');
  });

  afterEach(() => fetchSpy.mockRestore());

  afterAll(async () => {
    await disconnectDatabase();
  });

  type RepIndex = Map<string, { id: string; chamber: string }>;
  type ExtractFn = (
    regionId: string,
    sourceUrl: string,
    ds: Record<string, unknown>,
    repIndex: RepIndex,
  ) => Promise<{ outcome: string; count: number }>;
  type BuildIndexFn = (regionId: string) => Promise<RepIndex>;

  const buildRepIndex = (): Promise<RepIndex> =>
    (
      service as unknown as { buildRepNameIndex: BuildIndexFn }
    ).buildRepNameIndex.bind(service)(REGION_ID);

  const callExtract = (
    repIndex: RepIndex = new Map(),
  ): Promise<{ outcome: string; count: number }> =>
    (
      service as unknown as { extractVotesOnlyPage: ExtractFn }
    ).extractVotesOnlyPage.bind(service)(REGION_ID, VOTES_URL, {}, repIndex);

  it('writes real bill_votes rows for a bill with a roll-call (the #889 acceptance case)', async () => {
    const billId = await seedBillShell(db);

    const result = await callExtract();

    expect(result).toEqual({ outcome: 'votes-upserted', count: 3 });
    // Uses the votes-specific prompt with the raw bill_id — NOT
    // getBillExtractionPrompt (the original defect).
    expect(mockPromptClient.getBillVotesExtractionPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ billId: BILL_EXTERNAL_ID }),
    );

    const rows = await db.billVote.findMany({
      where: { billId },
      orderBy: { representativeName: 'asc' },
    });
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.representativeName)).toEqual([
      'Alice Smith',
      'Bob Jones',
      'Carol Lee',
    ]);
    const alice = rows.find((r) => r.representativeName === 'Alice Smith')!;
    expect(alice.position).toBe('yes');
    expect(alice.chamber).toBe('Assembly');
    expect(alice.motionText).toBe('Do Pass');
    // No matching Representative seeded → FK left null, raw name preserved.
    expect(alice.representativeId).toBeNull();
  });

  it('resolves representativeId when a matching Representative exists', async () => {
    const billId = await seedBillShell(db);
    await db.representative.create({
      data: {
        regionId: REGION_ID,
        externalId: 'ca-assembly-1',
        name: 'Alice Smith',
        chamber: 'Assembly',
        district: '1',
      },
    });

    const repIndex = await buildRepIndex();
    await callExtract(repIndex);

    const alice = await db.billVote.findFirst({
      where: { billId, representativeName: 'Alice Smith' },
    });
    expect(alice?.representativeId).not.toBeNull();
  });

  it('returns shell-missing and writes nothing when the bill shell does not exist', async () => {
    // No seedBillShell — the bill_id has no row.
    const result = await callExtract();

    expect(result.outcome).toBe('shell-missing');
    const count = await db.billVote.count();
    expect(count).toBe(0);
    // Fetch/LLM never reached — shell check short-circuits first.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockLlm.generate).not.toHaveBeenCalled();
  });

  it('returns no-votes-on-page and writes nothing when the LLM reports { skip: true }', async () => {
    await seedBillShell(db);
    mockLlm.generate.mockResolvedValue({
      text: JSON.stringify({ skip: true }),
    });

    const result = await callExtract();

    expect(result.outcome).toBe('no-votes-on-page');
    expect(await db.billVote.count()).toBe(0);
  });

  it('re-running extraction replaces prior rows (idempotent upsert)', async () => {
    const billId = await seedBillShell(db);

    await callExtract();
    await callExtract();

    // linkBillVotes deletes prior rows before re-inserting → no duplicates.
    const rows = await db.billVote.findMany({ where: { billId } });
    expect(rows.length).toBe(3);
  });

  it('a record with a bad date does not sink the whole bill — good rows still persist (#889 B1)', async () => {
    // Regression guard: pre-fix, one Invalid Date would abort createMany for
    // the entire bill, reintroducing the 0-rows symptom #889 fixes.
    const billId = await seedBillShell(db);
    mockLlm.generate.mockResolvedValue({
      text: JSON.stringify({
        billId: BILL_EXTERNAL_ID,
        votes: [
          {
            chamber: 'Assembly',
            date: 'pending', // unparseable → whole record dropped
            members: [{ name: 'Dropped Member', position: 'yes' }],
          },
          {
            chamber: 'Senate',
            date: '2025-06-02',
            members: [{ name: 'Kept Member', position: 'no' }],
          },
        ],
      }),
    });

    const result = await callExtract();

    expect(result).toEqual({ outcome: 'votes-upserted', count: 1 });
    const rows = await db.billVote.findMany({ where: { billId } });
    expect(rows.map((r) => r.representativeName)).toEqual(['Kept Member']);
  });

  it('persists a verbose (>200 char) motion at full length — the whole vote set is not dropped (#901)', async () => {
    // Pre-fix, motion_text was VARCHAR(200); a real CA reading motion exceeds
    // that and, because createMany is atomic, dropped the bill's entire vote
    // set → extraction-failed, 0 votes. This guards the widen to `text`.
    const billId = await seedBillShell(db);
    const longMotion =
      'Assembly Third Reading. Do pass as amended and re-refer to the ' +
      'Committee on Appropriations, and when so amended the bill shall be ' +
      'ordered to a third reading and re-referred for further consideration ' +
      'consistent with the standing rules of the Assembly and Senate.';
    expect(longMotion.length).toBeGreaterThan(200);
    mockLlm.generate.mockResolvedValue({
      text: JSON.stringify({
        billId: BILL_EXTERNAL_ID,
        votes: [
          {
            chamber: 'Assembly',
            date: '2025-05-01',
            motionText: longMotion,
            members: [
              { name: 'Alice Smith', position: 'yes' },
              { name: 'Bob Jones', position: 'no' },
            ],
          },
        ],
      }),
    });

    const result = await callExtract();

    expect(result).toEqual({ outcome: 'votes-upserted', count: 2 });
    const rows = await db.billVote.findMany({ where: { billId } });
    expect(rows.length).toBe(2);
    // Full motion round-trips — not truncated, not dropped.
    expect(rows[0].motionText).toBe(longMotion);
  });

  it('persists a >20 char chamber label — the whole vote set is not dropped (#905)', async () => {
    // Pre-fix, chamber was VARCHAR(20); once #901 widened motion_text, a
    // longer LLM-emitted chamber label became the next createMany overflow,
    // atomically dropping the bill's votes. This guards the widen to `text`.
    const billId = await seedBillShell(db);
    const longChamber =
      'Assembly Standing Committee on Appropriations Suspense File';
    expect(longChamber.length).toBeGreaterThan(20);
    mockLlm.generate.mockResolvedValue({
      text: JSON.stringify({
        billId: BILL_EXTERNAL_ID,
        votes: [
          {
            chamber: longChamber,
            date: '2025-05-01',
            motionText: 'Do Pass',
            members: [{ name: 'Alice Smith', position: 'yes' }],
          },
        ],
      }),
    });

    const result = await callExtract();

    expect(result).toEqual({ outcome: 'votes-upserted', count: 1 });
    const rows = await db.billVote.findMany({ where: { billId } });
    expect(rows.length).toBe(1);
    expect(rows[0].chamber).toBe(longChamber);
  });
});
