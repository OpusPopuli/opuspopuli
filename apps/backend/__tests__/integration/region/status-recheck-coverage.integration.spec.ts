/**
 * Integration tests for the unconditional status-only re-check path (#819,
 * generalizing #689).
 *
 * Complements the unit tests at
 * `apps/backend/src/apps/region/src/domains/region-sync.service.spec.ts` —
 * those mock `DbService`, so they cover the gate logic but never exercise
 * the actual Prisma writes or the BillSkipRecord-shape round-trip. These
 * integration cases use the real `postgres_test` database to assert:
 *
 *   - the cheap parse fires for bills with `needsStatusRecheck=false`
 *     (the silent-drift gap closure — the case Mechanism A used to skip)
 *   - matching lastAction + lastActionDate persists no row mutation other
 *     than the idempotent `needsStatusRecheck=false` clear
 *   - any change to lastActionDate OR lastAction text returns `'fall-through'`
 *     so the caller routes to the LLM extract path
 *   - `forceStatusRecheck=true` short-circuits to `'fall-through'` without
 *     even fetching the status page (operator override semantics)
 *
 * The HTTP fetcher is mocked — we don't want leginfo network IO in CI.
 * The DB layer + the gate logic are real.
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

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const REGION_ID = 'california';

/**
 * Real-leginfo-shaped HTML. The status-page parser keys on:
 *   - `<span id="lastAction" class="statusLabel">M/D/YY</span>` → lastActionDate
 *   - first `<td scope="row">DATE</td><td>TEXT</td>` row → lastAction text
 */
function buildStatusHtml(opts: {
  lastActionDate: string; // M/D/YY
  lastAction: string;
}): string {
  return `
    <span id="lastAction" class="statusLabel">${opts.lastActionDate}</span>
    <table><tbody>
      <tr><td scope="row">${opts.lastActionDate}</td><td>${opts.lastAction}</td></tr>
    </tbody></table>
  `;
}

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

async function seedBill(
  db: DbService,
  overrides: Partial<{
    id: string;
    externalId: string;
    billNumber: string;
    status: string | null;
    lastAction: string | null;
    lastActionDate: Date | null;
    needsStatusRecheck: boolean;
  }> = {},
): Promise<{
  id: string;
  externalId: string;
  lastAction: string | null;
  lastActionDate: Date | null;
  needsStatusRecheck: boolean;
  sourcePublishedAt: Date | null;
}> {
  const id = overrides.id ?? `bill-${Math.random().toString(36).slice(2, 10)}`;
  const externalId = overrides.externalId ?? `ext-${id}`;
  await db.bill.create({
    data: {
      id,
      regionId: REGION_ID,
      externalId,
      billNumber: overrides.billNumber ?? 'AB 1',
      sessionYear: '2025-2026',
      measureTypeCode: 'AB',
      title: 'A bill to test the unconditional status-only re-check.',
      sourceUrl: `https://leginfo.legislature.ca.gov/faces/billStatusClient.xhtml?bill_id=${id}`,
      status: overrides.status ?? null,
      lastAction: overrides.lastAction ?? null,
      lastActionDate: overrides.lastActionDate ?? null,
      needsStatusRecheck: overrides.needsStatusRecheck ?? false,
      isActive: true,
      isDead: false,
    },
  });
  return {
    id,
    externalId,
    lastAction: overrides.lastAction ?? null,
    lastActionDate: overrides.lastActionDate ?? null,
    needsStatusRecheck: overrides.needsStatusRecheck ?? false,
    sourcePublishedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('tryStatusOnlyRecheck — integration (#819 silent-drift gap)', () => {
  let service: RegionSyncService;
  let db: DbService;
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionSyncService,
        // Bounded-context services that RegionSyncService now requires
        // post-#828 (partial refactor).
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

    fetchSpy = jest
      .spyOn(
        service as unknown as {
          fetchUrlText: (u: string) => Promise<string>;
        },
        'fetchUrlText',
      )
      .mockResolvedValue('');
  });

  afterEach(() => fetchSpy.mockRestore());

  afterAll(async () => {
    await disconnectDatabase();
  });

  // -----------------------------------------------------------------------
  // Direct-call helpers
  // -----------------------------------------------------------------------

  type BillSkipRecord = {
    id: string;
    externalId: string;
    sourcePublishedAt: Date | null;
    lastAction: string | null;
    lastActionDate: Date | null;
    needsStatusRecheck: boolean;
  };
  type RecheckFn = (
    statusUrl: string,
    forceStatusRecheck: boolean,
    existing: BillSkipRecord | undefined,
  ) => Promise<'unchanged' | 'fall-through'>;

  const callRecheck = (
    statusUrl: string,
    force: boolean,
    existing: BillSkipRecord | undefined,
  ): Promise<'unchanged' | 'fall-through'> =>
    (
      service as unknown as { tryStatusOnlyRecheck: RecheckFn }
    ).tryStatusOnlyRecheck.bind(service)(statusUrl, force, existing);

  // -----------------------------------------------------------------------
  // Tests
  // -----------------------------------------------------------------------

  it('closes the silent-drift gap: unflagged bill + unchanged page → "unchanged" persists flag clear', async () => {
    // The headline scenario #819 was filed to fix. Pre-#819 this bill
    // would never have had the cheap parse run (needsStatusRecheck=false
    // gated it out) — Mechanism B's text-page check would run instead,
    // missing any status-only change. Post-#819 the cheap parse fires
    // unconditionally; with the page matching DB state, we skip cleanly.
    const seeded = await seedBill(db, {
      lastAction: 'Chaptered by Secretary of State - Chapter 472.',
      lastActionDate: new Date(Date.UTC(2025, 9, 9)),
      needsStatusRecheck: false,
    });
    fetchSpy.mockResolvedValueOnce(
      buildStatusHtml({
        lastActionDate: '10/9/25',
        lastAction: 'Chaptered by Secretary of State - Chapter 472.',
      }),
    );

    const result = await callRecheck(
      'https://leginfo.example/billStatusClient.xhtml?bill_id=x',
      false,
      seeded,
    );

    expect(result).toBe('unchanged');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Round-trip the flag clear through real Prisma — confirms the
    // BillSkipRecord shape matches the model.
    const row = await db.bill.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(row.needsStatusRecheck).toBe(false);
    // Status, lastAction, lastActionDate are NOT mutated by the skip path —
    // only the LLM-driven extract path writes those columns.
    expect(row.lastAction).toBe(seeded.lastAction);
    expect(row.lastActionDate?.toISOString()).toBe(
      seeded.lastActionDate?.toISOString(),
    );
  });

  it('catches a status-only change on an unflagged bill — newer lastActionDate → "fall-through"', async () => {
    // The exact silent-drift scenario the issue's "Problem" section
    // describes: a bill gets a new action without its text being
    // republished. Mechanism B's text-page signal would NOT trigger.
    // Mechanism A (post-#819) catches it because the status page's
    // lastActionDate has moved.
    const seeded = await seedBill(db, {
      lastAction: 'Read first time.',
      lastActionDate: new Date(Date.UTC(2026, 2, 1)),
      needsStatusRecheck: false,
    });
    fetchSpy.mockResolvedValueOnce(
      buildStatusHtml({
        lastActionDate: '5/15/26',
        lastAction: 'Amended in Committee on Health.',
      }),
    );

    const result = await callRecheck(
      'https://leginfo.example/billStatusClient.xhtml?bill_id=x',
      false,
      seeded,
    );

    expect(result).toBe('fall-through');

    // DB row not touched by this path — the LLM-driven extract path that
    // the caller routes to next is what actually updates the bill row.
    // We just confirm the row is unchanged here so reviewers can see the
    // separation of concerns.
    const row = await db.bill.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(row.lastAction).toBe(seeded.lastAction);
    expect(row.lastActionDate?.toISOString()).toBe(
      seeded.lastActionDate?.toISOString(),
    );
    expect(row.needsStatusRecheck).toBe(false);
  });

  it('forceStatusRecheck=true bypasses the cheap parse (no fetch, no DB write)', async () => {
    const seeded = await seedBill(db, {
      lastAction: 'Held in Committee.',
      lastActionDate: new Date(Date.UTC(2026, 4, 1)),
      needsStatusRecheck: true,
    });

    const result = await callRecheck(
      'https://leginfo.example/billStatusClient.xhtml?bill_id=x',
      true,
      seeded,
    );

    expect(result).toBe('fall-through');
    // No HTTP, no DB write — caller goes directly to the LLM path which
    // is what does the authoritative update.
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = await db.bill.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(row.needsStatusRecheck).toBe(true);
  });

  it('clears needsStatusRecheck=true when the page matches stored values', async () => {
    // The pre-#819 flag-driven path still works: journal-flagged bills
    // get the flag cleared after a clean skip. The mechanism is just no
    // longer gated on the flag for OTHER bills.
    const seeded = await seedBill(db, {
      lastAction: 'Approved by Governor.',
      lastActionDate: new Date(Date.UTC(2025, 6, 14)),
      needsStatusRecheck: true,
    });
    fetchSpy.mockResolvedValueOnce(
      buildStatusHtml({
        lastActionDate: '7/14/25',
        lastAction: 'Approved by Governor.',
      }),
    );

    const result = await callRecheck(
      'https://leginfo.example/billStatusClient.xhtml?bill_id=x',
      false,
      seeded,
    );

    expect(result).toBe('unchanged');
    const row = await db.bill.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(row.needsStatusRecheck).toBe(false);
  });

  it('falls through when fetch throws (defensive — never silently drifts on transport errors)', async () => {
    const seeded = await seedBill(db, {
      lastAction: 'Some action.',
      lastActionDate: new Date(Date.UTC(2026, 1, 1)),
    });
    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));

    const result = await callRecheck(
      'https://leginfo.example/billStatusClient.xhtml?bill_id=x',
      false,
      seeded,
    );

    expect(result).toBe('fall-through');
  });

  it('falls through when leginfo markup drift breaks the regex parse', async () => {
    const seeded = await seedBill(db, {
      lastAction: 'Action.',
      lastActionDate: new Date(Date.UTC(2026, 1, 1)),
    });
    fetchSpy.mockResolvedValueOnce(
      '<html><body>no useful markup</body></html>',
    );

    const result = await callRecheck(
      'https://leginfo.example/billStatusClient.xhtml?bill_id=x',
      false,
      seeded,
    );

    expect(result).toBe('fall-through');
  });
});
