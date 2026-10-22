/**
 * F2 — the bills prune, against a real database
 * (`docs/plans/F2-bill-prune-scope.md`).
 *
 * The unit tests in `region-sync.service.spec.ts` answer the prune's queries
 * with a hand-written filter. That proves the prune ASKS for the right scope;
 * it cannot prove Postgres returns it. The scope is built from a `distinct`
 * over `session_year` and a `notIn` over the discovered ids, and a mistake in
 * either deletes real bills — chaptered laws and their voting records — so
 * the queries run for real here.
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

type Prune = (
  regionId: string,
  discovered: Set<string>,
  maxBills?: number,
) => Promise<void>;

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

/** `n` bills of one session; external ids `<session prefix>AB<1..n>`. */
async function seedSession(
  db: DbService,
  sessionYear: string,
  n: number,
): Promise<string[]> {
  const prefix = sessionYear.replace('-', '') + '0';
  const ids = Array.from({ length: n }, (_, i) => `${prefix}AB${i + 1}`);
  await db.bill.createMany({
    data: ids.map((externalId, i) => ({
      externalId,
      regionId: REGION_ID,
      billNumber: `AB ${i + 1}`,
      sessionYear,
      measureTypeCode: 'AB',
      title: `Test bill ${externalId}`,
      sourceUrl: `https://leginfo.legislature.ca.gov/faces/billStatusClient.xhtml?bill_id=${externalId}`,
    })),
  });
  return ids;
}

async function remaining(db: DbService, sessionYear: string): Promise<number> {
  return db.bill.count({ where: { regionId: REGION_ID, sessionYear } });
}

describe('bills prune scope — integration (F2)', () => {
  let db: DbService;
  let prune: (discovered: string[]) => Promise<void>;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();

    const plugin = buildPlugin();
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
        {
          provide: PluginRegistryService,
          useValue: {
            getActive: jest.fn().mockReturnValue(plugin),
            getLocal: jest.fn().mockReturnValue(plugin),
            getAll: jest
              .fn()
              .mockReturnValue([
                { name: REGION_ID, instance: plugin, status: 'active' },
              ]),
          },
        },
        {
          provide: PluginLoaderService,
          useValue: { loadPlugin: jest.fn().mockResolvedValue(plugin) },
        },
        { provide: REGION_CACHE, useValue: { get: jest.fn(), set: jest.fn() } },
        RegionCacheService,
      ],
    }).compile();

    const service = module.get<RegionSyncService>(RegionSyncService);
    prune = (discovered) =>
      (service as unknown as { pruneStaleBills: Prune }).pruneStaleBills(
        REGION_ID,
        new Set(discovered),
      );
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('keeps the previous session when the source flips to the next one', async () => {
    // The December 2026 failure: the first full sync after the source moves
    // to 2027-28 discovers only 2027-28 bills, which phase 2 has just
    // created. The old prune deleted every 2025-26 bill.
    //
    // The old session is kept UNDER the guard's floor of 10 on purpose. With
    // a large one, the guard refuses the prune and this passes with the
    // session filter removed — it did, on the first version of this test.
    await seedSession(db, '2025-2026', 8);
    const next = await seedSession(db, '2027-2028', 30);

    await prune(next);

    expect(await remaining(db, '2025-2026')).toBe(8);
    expect(await remaining(db, '2027-2028')).toBe(30);
  });

  it('deletes only the undiscovered bills of the covered session', async () => {
    const ids = await seedSession(db, '2025-2026', 600);
    await seedSession(db, '2023-2024', 50);

    // 600 in scope → limit max(12, 10) = 12; 5 undiscovered is under it.
    await prune(ids.slice(0, 595));

    expect(await remaining(db, '2025-2026')).toBe(595);
    expect(await remaining(db, '2023-2024')).toBe(50);
    const gone = await db.bill.findMany({
      where: { externalId: { in: ids.slice(595) } },
    });
    expect(gone).toHaveLength(0);
  });

  it('refuses a prune over the guard and deletes nothing', async () => {
    const ids = await seedSession(db, '2025-2026', 600);

    // 300 undiscovered against a limit of 12: a discovery pass that lost a
    // source, not 300 delisted bills.
    await prune(ids.slice(0, 300));

    expect(await remaining(db, '2025-2026')).toBe(600);
  });
});
