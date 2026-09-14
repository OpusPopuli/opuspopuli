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

  /**
   * #1219. `propositions.summary` is NOT NULL with no database default, so the
   * write must always supply a string.
   *
   * Until #1252 the domain schema guaranteed one by backfilling the title into
   * an empty summary — which was itself the defect that issue removed, because
   * it embedded the title twice and looked like content. Removing it made
   * `undefined` reachable here.
   *
   * In production that took down an entire sync: these upserts run inside a
   * batch transaction, so ONE measure without a summary rolled back every
   * other row in the run. Forty-six correctly-extracted Attorney General
   * measures were discarded because an unrelated SOS measure had no summary,
   * and the sync reported success.
   */
  /**
   * #1219 / E-27. A source that extracted rows and wrote none is a failure,
   * and it was reported as success twice.
   *
   * These upserts run in a batch transaction, so one invalid record rolls back
   * every other row. On 2026-09-14 that discarded 46 Attorney General measures
   * and the 44 summaries that had just taken seven minutes to fetch, because
   * an unrelated measure was missing a required field. The only trace was a
   * `0 created, 0 updated` line among thousands.
   */
  describe('wrote-nothing guard', () => {
    it('logs an error when rows were extracted but none written', async () => {
      const service = await build();
      const spy = jest
        .spyOn(
          (service as never as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);
      const provider = {
        getName: () => 'california-sonoma',
        fetchPropositions: jest.fn().mockResolvedValue([measure]),
      };
      // Upsert harness that reports a rolled-back transaction.
      const rolledBack: UpsertByExternalId = (async () => ({
        processed: 1,
        created: 0,
        updated: 0,
      })) as never;

      await service.sync(provider as never, undefined, [], rolledBack);

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('WROTE NOTHING'),
      );
    });

    it('stays quiet when rows were actually written', async () => {
      const service = await build();
      const spy = jest
        .spyOn(
          (service as never as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);
      const provider = {
        getName: () => 'california-sonoma',
        fetchPropositions: jest.fn().mockResolvedValue([measure]),
      };

      await service.sync(provider as never, undefined, [], upsertByExternalId);

      expect(spy).not.toHaveBeenCalledWith(
        expect.stringContaining('WROTE NOTHING'),
      );
    });

    it('stays quiet when the source legitimately had nothing to sync', async () => {
      const service = await build();
      const spy = jest
        .spyOn(
          (service as never as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);
      const provider = {
        getName: () => 'california-sonoma',
        fetchPropositions: jest.fn().mockResolvedValue([]),
      };

      await service.sync(provider as never, undefined, [], upsertByExternalId);

      expect(spy).not.toHaveBeenCalledWith(
        expect.stringContaining('WROTE NOTHING'),
      );
    });
  });

  describe('summary is always written as a string', () => {
    const noSummary = { ...measure, summary: undefined };

    it('writes an empty string rather than undefined on create', async () => {
      const service = await build();
      const provider = {
        getName: () => 'california-sonoma',
        fetchPropositions: jest.fn().mockResolvedValue([noSummary]),
      };

      await service.sync(provider as never, undefined, [], upsertByExternalId);

      const call = db.proposition.upsert.mock.calls[0][0];
      expect(call.create.summary).toBe('');
      expect(call.update.summary).toBe('');
    });

    /**
     * Empty string, NEVER the title. Restoring a title backfill here would
     * reintroduce the echo #1219 exists to remove.
     */
    it('does not fall back to the title', async () => {
      const service = await build();
      const provider = {
        getName: () => 'california-sonoma',
        fetchPropositions: jest.fn().mockResolvedValue([noSummary]),
      };

      await service.sync(provider as never, undefined, [], upsertByExternalId);

      const call = db.proposition.upsert.mock.calls[0][0];
      expect(call.create.summary).not.toBe(measure.title);
    });

    it('passes a real summary through unchanged', async () => {
      const service = await build();
      const provider = {
        getName: () => 'california-sonoma',
        fetchPropositions: jest.fn().mockResolvedValue([measure]),
      };

      await service.sync(provider as never, undefined, [], upsertByExternalId);

      const call = db.proposition.upsert.mock.calls[0][0];
      expect(call.create.summary).toBe(measure.summary);
    });
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
