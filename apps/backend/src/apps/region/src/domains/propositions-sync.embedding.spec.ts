import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { PropositionsSyncService } from './propositions-sync.service';
import { PropositionEmbeddingService } from './proposition-embedding.service';

/**
 * The retrieval corpus has to follow the filed text (#1074, subtask 3).
 *
 * If it does not, a scan gets matched against a measure whose title or summary
 * has since been amended — and the match still reports a confident score,
 * because the vector is stale rather than absent.
 *
 * Scoped to the embedding hook. The rest of `sync()` is covered by the
 * integration specs under `__tests__/integration/region/`.
 */
describe('PropositionsSyncService — retrieval corpus refresh', () => {
  const provider = {
    getName: () => 'california',
    fetchPropositions: jest.fn().mockResolvedValue([]),
  };

  const upsert = jest
    .fn()
    .mockResolvedValue({ processed: 0, created: 0, updated: 0 });

  async function build(embedMissing: jest.Mock | null) {
    const providers: unknown[] = [
      PropositionsSyncService,
      {
        provide: DbService,
        useValue: {
          proposition: { findMany: jest.fn().mockResolvedValue([]) },
        },
      },
    ];
    if (embedMissing) {
      providers.push({
        provide: PropositionEmbeddingService,
        useValue: { embedMissing },
      });
    }

    const moduleRef = await Test.createTestingModule({
      providers: providers as never[],
    }).compile();

    return moduleRef.get(PropositionsSyncService);
  }

  const run = (service: PropositionsSyncService) =>
    service.sync(provider as never, undefined, [], upsert as never);

  beforeEach(() => jest.clearAllMocks());

  it('refreshes the corpus once the propositions are written', async () => {
    const embedMissing = jest
      .fn()
      .mockResolvedValue({ scanned: 2, embedded: 1, unchanged: 1, failed: 0 });

    await run(await build(embedMissing));

    expect(embedMissing).toHaveBeenCalledTimes(1);
  });

  /**
   * A stale vector degrades retrieval for one measure. An aborted sync loses
   * the civic data for all of them, and this runs on the nightly cron. The
   * trade is deliberate, and this test is what stops someone "fixing" it into
   * a throw.
   */
  it('does not fail the sync when the corpus refresh throws', async () => {
    const embedMissing = jest
      .fn()
      .mockRejectedValue(new Error('embeddings provider down'));

    await expect(run(await build(embedMissing))).resolves.toBeDefined();
    expect(embedMissing).toHaveBeenCalled();
  });

  /** The dependency is @Optional — sync must not require it to exist. */
  it('syncs with no embedding service wired in', async () => {
    await expect(run(await build(null))).resolves.toBeDefined();
  });
});
