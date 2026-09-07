import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  PropositionsSyncService,
  type UpsertByExternalId,
} from './propositions-sync.service';

/**
 * Every proposition row carries the plugin that ingested it (#1164, the
 * minimal slice of #1139). Without the stamp, the first county sync would
 * land county measures in one table with statewide ones, indistinguishable —
 * and the briefing could show a Sonoma user another county's measures.
 *
 * Scoped to the jurisdiction stamp + the region-scoped stage backfill.
 * The rest of `sync()` is covered by the embedding spec and the
 * integration specs under `__tests__/integration/region/`.
 */
describe('PropositionsSyncService — regionPluginName stamp', () => {
  const measure = {
    externalId: 'california-sonoma-2026-11-03-measure-e',
    title: 'Measure E: Waugh School District Bond',
    summary: 'Waugh School District bond measure',
    status: 'pending',
    electionDate: new Date('2026-11-03'),
    sourceUrl: 'https://county.gov/measures',
  };

  // Executes the service-supplied upsert builder so db.proposition.upsert
  // captures the exact write payload, mirroring the orchestrator's helper.
  const upsertByExternalId: UpsertByExternalId = (async (
    items: never[],
    _find: unknown,
    build: (items: never[]) => unknown[],
  ) => {
    build(items);
    return { processed: items.length, created: items.length, updated: 0 };
  }) as never;

  let db: {
    proposition: {
      findMany: jest.Mock;
      upsert: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  async function build() {
    db = {
      proposition: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockReturnValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PropositionsSyncService,
        { provide: DbService, useValue: db },
      ],
    }).compile();
    return moduleRef.get(PropositionsSyncService);
  }

  beforeEach(() => jest.clearAllMocks());

  it('stamps the county plugin name and keys the upsert on the jurisdiction', async () => {
    const service = await build();
    const provider = {
      getName: () => 'california-sonoma',
      fetchPropositions: jest.fn().mockResolvedValue([measure]),
    };

    await service.sync(provider as never, undefined, [], upsertByExternalId);

    expect(db.proposition.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        // Compound key — a county's "Measure A" must never match another
        // jurisdiction's row and overwrite it (#1164).
        where: {
          regionPluginName_externalId: {
            regionPluginName: 'california-sonoma',
            externalId: measure.externalId,
          },
        },
        create: expect.objectContaining({
          regionPluginName: 'california-sonoma',
        }),
      }),
    );
  });

  it('scopes the created-vs-updated lookup to the jurisdiction', async () => {
    const service = await build();
    const provider = {
      getName: () => 'california-sonoma',
      fetchPropositions: jest.fn().mockResolvedValue([measure]),
    };

    await service.sync(provider as never, undefined, [], upsertByExternalId);

    // Another county owning the same measure letter must not make this one
    // report as an update.
    expect(db.proposition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          regionPluginName: 'california-sonoma',
        }),
      }),
    );
  });

  it('stamps the state plugin name for statewide syncs', async () => {
    const service = await build();
    const provider = {
      getName: () => 'california',
      fetchPropositions: jest.fn().mockResolvedValue([measure]),
    };

    await service.sync(provider as never, undefined, [], upsertByExternalId);

    const args = db.proposition.upsert.mock.calls[0][0];
    expect(args.create.regionPluginName).toBe('california');
    expect(args.where.regionPluginName_externalId.regionPluginName).toBe(
      'california',
    );
    // The update branch deliberately does NOT re-stamp: the compound key
    // already pins the row's jurisdiction, so writing it again could only
    // ever relabel a row that matched — which must be impossible.
    expect(args.update).not.toHaveProperty('regionPluginName');
  });

  it('refuses to write when the provider cannot name itself', async () => {
    const service = await build();
    const provider = {
      fetchPropositions: jest.fn().mockResolvedValue([measure]),
    };

    // The jurisdiction is half the upsert key, so an unnamed provider must
    // fail before writing rather than mislabel rows as statewide.
    await expect(
      service.sync(provider as never, undefined, [], upsertByExternalId),
    ).rejects.toThrow(/named region plugin/);
    expect(db.proposition.upsert).not.toHaveBeenCalled();
  });

  it('scopes the stage backfill to the syncing plugin rows', async () => {
    const service = await build();
    const provider = {
      getName: () => 'california-sonoma',
      fetchPropositions: jest.fn().mockResolvedValue([]),
    };
    const stagePatterns = [{ stageId: 'qualified', regex: /pending/i }];

    await service.sync(
      provider as never,
      undefined,
      stagePatterns,
      upsertByExternalId,
    );

    // A county sync's civics stage patterns must not rewrite statewide rows.
    expect(db.proposition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          lifecycleStageId: null,
          regionPluginName: 'california-sonoma',
        }),
      }),
    );
  });
});
