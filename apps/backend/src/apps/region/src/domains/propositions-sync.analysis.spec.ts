import { PropositionsSyncService } from './propositions-sync.service';
import {
  inlineBatch,
  type ChildJobBatch,
} from 'src/common/child-jobs/child-job-batch';

/**
 * The analysis phase (propositions S4) on its own: the queue path with a
 * scripted batch, a failure to enqueue, and cancellation on the inline path.
 * The real queue is the integration spec's job.
 */
describe('PropositionsSyncService — analysis phase (S4)', () => {
  const pending = [
    { id: 'id-1', externalId: 'M1', fullTextHash: 'h1' },
    { id: 'id-2', externalId: 'M2', fullTextHash: 'h2' },
  ];
  const analysis = () => ({
    stampAndSelectStale: jest.fn().mockResolvedValue({
      live: { promptHash: 'p', modelDigest: 'd', configHash: 'c' },
      pending,
    }),
    analyseOne: jest.fn().mockResolvedValue('updated'),
  });
  const cache = () => ({ invalidateCache: jest.fn() });

  const phase = (
    deps: {
      analysis: ReturnType<typeof analysis>;
      cache?: ReturnType<typeof cache>;
      queues?: unknown;
      pipelineJobs?: unknown;
    },
    pipelineJobId?: string,
  ) =>
    (
      new PropositionsSyncService(
        {} as never,
        deps.analysis as never,
        deps.cache as never,
        undefined,
        undefined,
        undefined,
        deps.queues as never,
        deps.pipelineJobs as never,
      ) as unknown as {
        analyseStale: (r: string, id?: string) => Promise<void>;
      }
    ).analyseStale('california', pipelineJobId);

  it('queues each stale measure on the queue when one is bound, keyed by its analysis job id', async () => {
    const added: Array<[unknown, string]> = [];
    const inline = inlineBatch(async () => 'updated');
    const batch: ChildJobBatch<unknown, string> = {
      ...inline,
      add: async (data, id) => {
        added.push([data, id]);
        return inline.add(data, id);
      },
    };
    const queues = {
      enabled: () => true,
      open: jest.fn().mockResolvedValue(batch),
    };
    const a = analysis();
    const c = cache();

    await phase({ analysis: a, cache: c, queues });

    expect(queues.open).toHaveBeenCalledWith('proposition-analysis');
    expect(added.map(([data]) => data)).toEqual([
      { propositionId: 'id-1' },
      { propositionId: 'id-2' },
    ]);
    expect(added[0][1]).toMatch(/^id-1__analyse__sk1-/);
    // Ran on the queue, not in this process.
    expect(a.analyseOne).not.toHaveBeenCalled();
    expect(c.invalidateCache).toHaveBeenCalledWith('propositions:');
  });

  it('counts a measure it could not queue as failed, and carries on', async () => {
    const inline = inlineBatch(async () => 'updated');
    let calls = 0;
    const batch: ChildJobBatch<unknown, string> = {
      ...inline,
      add: async (data, id) => {
        if (calls++ === 0) throw new Error('redis down');
        return inline.add(data, id);
      },
    };
    const c = cache();

    await phase({
      analysis: analysis(),
      cache: c,
      queues: { enabled: () => true, open: async () => batch },
    });

    // The second measure still ran and was written.
    expect(calls).toBe(2);
    expect(c.invalidateCache).toHaveBeenCalled();
  });

  it('stops analysing inline when the run is cancelled', async () => {
    const a = analysis();

    await phase(
      {
        analysis: a,
        pipelineJobs: { isCancelled: jest.fn().mockResolvedValue(true) },
      },
      'job-1',
    );

    expect(a.analyseOne).not.toHaveBeenCalled();
  });

  it('writes nothing to the cache when nothing was analysed', async () => {
    const a = analysis();
    a.analyseOne.mockResolvedValue('unchanged');
    const c = cache();

    await phase({ analysis: a, cache: c });

    expect(c.invalidateCache).not.toHaveBeenCalled();
  });

  it('counts the measures already current as skipped, without visiting them (K-P2)', async () => {
    const increment = jest.fn();
    const a = analysis();
    a.stampAndSelectStale.mockResolvedValue({
      live: { promptHash: 'p', modelDigest: 'd', configHash: 'c' },
      pending: [],
      current: 69,
    });
    const service = new PropositionsSyncService(
      {} as never,
      a as never,
      undefined,
      undefined,
      undefined,
      { increment, observe: jest.fn() },
    ) as unknown as { analyseStale: (r: string) => Promise<void> };

    await service.analyseStale('california');

    expect(increment).toHaveBeenCalledWith('pipeline_items_total', 69, {
      data_type: 'propositions',
      phase: 'analysis',
      outcome: 'skipped',
      reason: 'analysis_current',
    });
  });

  it('publishes the embedding pass as stage=embed items', () => {
    const increment = jest.fn();
    const service = new PropositionsSyncService(
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      { increment, observe: jest.fn() },
    ) as unknown as {
      countEmbeddings: (r: {
        embedded: number;
        unchanged: number;
        failed: number;
      }) => void;
    };

    service.countEmbeddings({ embedded: 2, unchanged: 69, failed: 0 });

    expect(increment.mock.calls).toEqual([
      [
        'pipeline_items_total',
        2,
        { data_type: 'propositions', stage: 'embed', outcome: 'updated' },
      ],
      [
        'pipeline_items_total',
        69,
        {
          data_type: 'propositions',
          stage: 'embed',
          outcome: 'skipped',
          reason: 'unchanged',
        },
      ],
    ]);
  });
});
