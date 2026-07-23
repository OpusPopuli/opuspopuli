import { DbService } from '@opuspopuli/relationaldb-provider';
import { QueueService } from '@opuspopuli/queue-provider';
import { MeetingsSyncService } from './meetings-sync.service';

interface Built {
  svc: MeetingsSyncService;
  enqueue: jest.Mock;
  findMany: jest.Mock;
}

function build(rows: { id: string }[] = [{ id: 'a' }, { id: 'b' }]): Built {
  const findMany = jest.fn().mockResolvedValue(rows);
  const enqueue = jest.fn().mockResolvedValue('job');
  const db = { minutes: { findMany } } as unknown as DbService;
  const queue = { enqueue } as unknown as QueueService;
  const svc = new MeetingsSyncService(db, undefined, queue);
  return { svc, enqueue, findMany };
}

describe('MeetingsSyncService.regenerateSummaries (#813)', () => {
  it('enqueues a force job per matching minutes row (no deduped id, no colon)', async () => {
    const { svc, enqueue } = build();
    const n = await svc.regenerateSummaries();
    expect(n).toBe(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    // (queueName, data, opts)
    expect(enqueue.mock.calls[0][1]).toEqual({ minutesId: 'a', force: true });
    // force omits the job id so a re-run isn't deduped against a retained job.
    expect(enqueue.mock.calls[0][2]).toBeUndefined();
    // Any custom job id must never contain ':' (BullMQ rejects it).
    for (const call of enqueue.mock.calls) {
      const jobId = call[2]?.jobId as string | undefined;
      if (jobId) expect(jobId).not.toContain(':');
    }
  });

  it('applies the body + limit filters to the query', async () => {
    const { svc, findMany } = build([{ id: 'a' }]);
    await svc.regenerateSummaries('Assembly', 5);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.body).toBe('Assembly');
    expect(arg.where.isActive).toBe(true);
    expect(arg.take).toBe(5);
  });

  it('is a no-op returning 0 when no QueueService is wired', async () => {
    const db = {
      minutes: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }]) },
    } as unknown as DbService;
    const svc = new MeetingsSyncService(db);
    await expect(svc.regenerateSummaries()).resolves.toBe(0);
  });
});
