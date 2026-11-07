import {
  createMockDbService,
  type MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import type IORedis from 'ioredis';
import { BillSummaryService } from './bill-summary.service';
import { BillSummaryStatus } from './models/bill.model';

/** Redis, as far as the caps use it: INCR, DECR, EXPIRE in MULTI. */
function fakeRedis(failing = false) {
  const counters = new Map<string, number>();
  const multi = () => {
    const ops: (() => [null, number])[] = [];
    const chain = {
      incr: (k: string) => {
        ops.push(() => {
          counters.set(k, (counters.get(k) ?? 0) + 1);
          return [null, counters.get(k)!];
        });
        return chain;
      },
      decr: (k: string) => {
        ops.push(() => {
          counters.set(k, (counters.get(k) ?? 0) - 1);
          return [null, counters.get(k)!];
        });
        return chain;
      },
      expire: () => {
        ops.push(() => [null, 1]);
        return chain;
      },
      exec: async () => {
        if (failing) throw new Error('redis down');
        return ops.map((op) => op());
      },
    };
    return chain;
  };
  const decr = async (k: string) => {
    if (failing) throw new Error('redis down');
    counters.set(k, (counters.get(k) ?? 0) - 1);
    return counters.get(k)!;
  };
  return { redis: { multi, decr } as unknown as IORedis, counters };
}

const PROVENANCE = {
  externalId: 'EXT1',
  statusSource: 'page',
  aiSummary: null as unknown,
  aiSummaryPromptHash: null as string | null,
  aiSummaryLlmDigest: null as string | null,
  aiSummarySourceVersion: null as string | null,
  aiSummaryFailedAt: null as Date | null,
};

describe('BillSummaryService (bills-phase-b.md D7)', () => {
  let db: MockDbClient;
  let queue: { enqueue: jest.Mock; getJobInfo: jest.Mock };
  let prompt: { getServedPromptHash: jest.Mock };
  let regionSync: { summarizeOne: jest.Mock };
  let metrics: { increment: jest.Mock; observe: jest.Mock };

  const build = (redis = fakeRedis().redis) =>
    new BillSummaryService(
      db as unknown as DbService,
      queue as never,
      regionSync as never,
      redis,
      prompt as never,
      { getModelDigest: jest.fn().mockResolvedValue('d') } as never,
      metrics,
    );
  const reader = { session: 'a'.repeat(64) };

  beforeEach(() => {
    db = createMockDbService();
    db.bill.findUnique.mockResolvedValue({ ...PROVENANCE } as never);
    queue = {
      enqueue: jest.fn().mockResolvedValue('job'),
      getJobInfo: jest.fn().mockResolvedValue(null),
    };
    prompt = {
      getServedPromptHash: jest
        .fn()
        .mockResolvedValue({ promptHash: 'h'.repeat(64), fallback: false }),
    };
    regionSync = { summarizeOne: jest.fn().mockResolvedValue('enriched') };
    metrics = { increment: jest.fn(), observe: jest.fn() };
  });

  it('enqueues a missing summary once, under a job id per bill and template', async () => {
    const service = build();

    await expect(service.request('b1', reader)).resolves.toBe(
      BillSummaryStatus.PENDING,
    );

    expect(queue.enqueue).toHaveBeenCalledWith(
      'bill-summary',
      expect.objectContaining({ billId: 'b1' }),
      { jobId: 'bill-summary__b1', removeOnFinish: true },
    );
  });

  it('collapses a second reader onto the job in flight, without spending a cap', async () => {
    const { redis, counters } = fakeRedis();
    queue.getJobInfo.mockResolvedValue({ state: 'active' });

    await expect(build(redis).request('b1', reader)).resolves.toBe(
      BillSummaryStatus.PENDING,
    );

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect([...counters.values()]).toEqual([]);
  });

  it('refuses a reader over the per-reader cap, and gives the count back', async () => {
    process.env.BILL_SUMMARY_LAZY_READER_DAILY_CAP = '1';
    const { redis, counters } = fakeRedis();
    const service = build(redis);
    delete process.env.BILL_SUMMARY_LAZY_READER_DAILY_CAP;

    await service.request('b1', reader);
    await expect(service.request('b2', reader)).resolves.toBe(
      BillSummaryStatus.UNAVAILABLE,
    );

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(Math.max(...counters.values())).toBe(1);
    // Another reader still has their allowance.
    await expect(
      service.request('b3', { session: 'b'.repeat(64) }),
    ).resolves.toBe(BillSummaryStatus.PENDING);
  });

  it('bounds one IP minting fresh sessions, and gives the counts back', async () => {
    process.env.BILL_SUMMARY_LAZY_IP_DAILY_CAP = '2';
    const { redis, counters } = fakeRedis();
    const service = build(redis);
    delete process.env.BILL_SUMMARY_LAZY_IP_DAILY_CAP;
    const fresh = (n: number) => ({
      session: String(n).repeat(64).slice(0, 64),
      ip: '203.0.113.9',
    });

    await service.request('b1', fresh(1));
    await service.request('b2', fresh(2));
    await expect(service.request('b3', fresh(3))).resolves.toBe(
      BillSummaryStatus.UNAVAILABLE,
    );

    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    const globalCount = [...counters.entries()].find(([k]) =>
      k.includes(':global:'),
    )![1];
    expect(globalCount).toBe(2);
  });

  it('creates no reader key for a request the global cap refuses', async () => {
    process.env.BILL_SUMMARY_LAZY_DAILY_CAP = '0';
    const { redis, counters } = fakeRedis();
    const service = build(redis);
    delete process.env.BILL_SUMMARY_LAZY_DAILY_CAP;

    await service.request('b1', reader);

    expect([...counters.keys()].some((k) => k.includes(':reader:'))).toBe(
      false,
    );
  });

  it('gives every count back when the enqueue fails', async () => {
    const { redis, counters } = fakeRedis();
    queue.enqueue.mockRejectedValue(new Error('queue down'));

    await expect(
      build(redis).request('b1', { ...reader, ip: '203.0.113.9' }),
    ).resolves.toBe(BillSummaryStatus.UNAVAILABLE);

    expect([...counters.values()].every((v) => v === 0)).toBe(true);
  });

  it('keys readers by an HMAC, never the id or session itself', async () => {
    const { redis, counters } = fakeRedis();
    await build(redis).request('b1', { userId: 'user-1', ip: '203.0.113.9' });
    const keys = [...counters.keys()].join(' ');
    expect(keys).not.toContain('user-1');
    expect(keys).not.toContain('203.0.113.9');
  });

  it('refuses everyone once the global cap is spent', async () => {
    process.env.BILL_SUMMARY_LAZY_DAILY_CAP = '1';
    const service = build();
    delete process.env.BILL_SUMMARY_LAZY_DAILY_CAP;

    await service.request('b1', reader);
    await expect(
      service.request('b2', { session: 'c'.repeat(64) }),
    ).resolves.toBe(BillSummaryStatus.UNAVAILABLE);
  });

  it('fails closed with no reader identity, or with the counters down', async () => {
    await expect(build().request('b1', {})).resolves.toBe(
      BillSummaryStatus.UNAVAILABLE,
    );
    await expect(
      build(fakeRedis(true).redis).request('b1', reader),
    ).resolves.toBe(BillSummaryStatus.UNAVAILABLE);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue a current summary', async () => {
    db.bill.findUnique.mockResolvedValue({
      ...PROVENANCE,
      aiSummary: { plainEnglishSummary: 'x' },
      aiSummaryPromptHash: 'h'.repeat(64),
      aiSummaryLlmDigest: 'd',
    } as never);

    await expect(build().request('b1', reader)).resolves.toBe(
      BillSummaryStatus.CURRENT,
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('leaves a bill waiting after a failed attempt alone in the worker', async () => {
    queue.getJobInfo.mockResolvedValue({ state: 'active' });
    db.bill.findUnique.mockResolvedValue({
      ...PROVENANCE,
      aiSummaryFailedAt: new Date(),
    } as never);

    await expect(
      build().generate({ billId: 'b1', requestedAt: new Date().toISOString() }),
    ).resolves.toBe('current');
    expect(regionSync.summarizeOne).not.toHaveBeenCalled();
  });

  it('reports a failed generation as failed, observing no ready time', async () => {
    regionSync.summarizeOne.mockResolvedValue('failed');

    await expect(
      build().generate({ billId: 'b1', requestedAt: new Date().toISOString() }),
    ).resolves.toBe('failed');
    expect(metrics.observe).not.toHaveBeenCalled();
  });

  it('counts a request with no reader apart from a capped one', async () => {
    await build().request('b1', {});
    expect(metrics.increment).toHaveBeenCalledWith(
      'lazy_analysis_requests_total',
      1,
      { data_type: 'bills', result: 'no_reader' },
    );
  });

  it('reports a bill waiting after a failed attempt as unavailable', async () => {
    db.bill.findUnique.mockResolvedValue({
      ...PROVENANCE,
      aiSummaryFailedAt: new Date(),
    } as never);

    await expect(build().status('b1')).resolves.toBe(
      BillSummaryStatus.UNAVAILABLE,
    );
  });

  it('shows a stale summary as current while the template is a local fallback', async () => {
    prompt.getServedPromptHash.mockResolvedValue({
      promptHash: 'local',
      fallback: true,
    });
    db.bill.findUnique.mockResolvedValue({
      ...PROVENANCE,
      aiSummary: { plainEnglishSummary: 'x' },
      aiSummaryPromptHash: 'old',
    } as never);

    await expect(build().status('b1')).resolves.toBe(BillSummaryStatus.CURRENT);
  });

  it('writes through the batch path, and skips a bill already current', async () => {
    // In the worker, the queue always holds this very job.
    queue.getJobInfo.mockResolvedValue({ state: 'active' });
    const service = build();
    await expect(
      service.generate({ billId: 'b1', requestedAt: new Date().toISOString() }),
    ).resolves.toBe('enriched');
    expect(regionSync.summarizeOne).toHaveBeenCalledWith('b1');
    expect(metrics.observe).toHaveBeenCalledWith(
      'lazy_analysis_ready_seconds',
      expect.any(Number),
      { data_type: 'bills' },
    );

    db.bill.findUnique.mockResolvedValue({
      ...PROVENANCE,
      aiSummary: { plainEnglishSummary: 'x' },
      aiSummaryPromptHash: 'h'.repeat(64),
      aiSummaryLlmDigest: 'd',
    } as never);
    regionSync.summarizeOne.mockClear();
    await expect(
      service.generate({ billId: 'b1', requestedAt: new Date().toISOString() }),
    ).resolves.toBe('current');
    expect(regionSync.summarizeOne).not.toHaveBeenCalled();
  });
});
