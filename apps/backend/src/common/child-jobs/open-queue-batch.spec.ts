import { EventEmitter } from 'node:events';
import { openQueueBatch } from './child-job-batch';

/** A stand-in event stream the test can emit on. */
const streams: EventEmitter[] = [];
let ready: () => Promise<void> = async () => undefined;
jest.mock('bullmq', () => ({
  QueueEvents: jest.fn().mockImplementation(() => {
    const stream = Object.assign(new EventEmitter(), {
      waitUntilReady: jest.fn(() => ready()),
      close: jest.fn().mockResolvedValue(undefined),
    });
    streams.push(stream);
    return stream;
  }),
}));

/**
 * The queue batch's bookkeeping on its event stream. That the events really
 * arrive this way is the integration spec's job, against real BullMQ.
 */
describe('openQueueBatch', () => {
  beforeEach(() => {
    ready = async () => undefined;
  });

  const open = async (enqueue = jest.fn().mockResolvedValue('id')) => {
    const queueService = {
      enqueue,
      removeJobIfPending: jest.fn(
        async (_q: string, id: string) => id === 'waiting',
      ),
    };
    const batch = await openQueueBatch<{ n: number }, string>({
      queueService: queueService as never,
      connection: {} as never,
      prefix: 'p',
      queueName: 'q',
    });
    return { batch, queueService, stream: streams.at(-1)! };
  };

  it('queues each job removed-on-finish, under the id it was given', async () => {
    const { batch, queueService } = await open();

    await batch.add({ n: 1 }, 'a');

    expect(queueService.enqueue).toHaveBeenCalledWith(
      'q',
      { n: 1 },
      { jobId: 'a', removeOnFinish: true },
    );
    expect(batch.pending).toBe(1);
  });

  it('takes outcomes for its own jobs only, once each', async () => {
    const { batch, stream } = await open();
    await batch.add({ n: 1 }, 'a');
    await batch.add({ n: 2 }, 'b');

    stream.emit('completed', { jobId: 'a', returnvalue: 'created' });
    stream.emit('completed', { jobId: 'a', returnvalue: 'again' });
    stream.emit('completed', { jobId: 'someone-elses', returnvalue: 'x' });
    stream.emit('failed', { jobId: 'b', failedReason: 'runner died' });

    expect(batch.take()).toEqual([
      { jobId: 'a', ok: true, value: 'created' },
      { jobId: 'b', ok: false, reason: 'runner died' },
    ]);
    expect(batch.pending).toBe(0);
  });

  it('wakes a waiting parent when an outcome arrives', async () => {
    const { batch, stream } = await open();
    await batch.add({ n: 1 }, 'a');

    const waiting = batch.waitForOutcome(60_000);
    stream.emit('completed', { jobId: 'a', returnvalue: 'updated' });

    await expect(waiting).resolves.toBeUndefined();
  });

  it('forgets a job whose enqueue failed, and rethrows', async () => {
    const { batch } = await open(
      jest.fn().mockRejectedValue(new Error('redis down')),
    );

    await expect(batch.add({ n: 1 }, 'a')).rejects.toThrow('redis down');
    expect(batch.pending).toBe(0);
  });

  it('drops only jobs that have not started', async () => {
    const { batch } = await open();
    await batch.add({ n: 1 }, 'waiting');
    await batch.add({ n: 2 }, 'running');

    await expect(batch.dropWaiting()).resolves.toBe(1);
    expect(batch.pending).toBe(1);
  });

  it('fails what is pending, and removes those not started', async () => {
    const { batch, queueService } = await open();
    await batch.add({ n: 1 }, 'waiting');
    await batch.add({ n: 2 }, 'running');

    await batch.failPending('timed out');

    expect(batch.take()).toEqual([
      { jobId: 'waiting', ok: false, reason: 'timed out' },
      { jobId: 'running', ok: false, reason: 'timed out' },
    ]);
    expect(queueService.removeJobIfPending).toHaveBeenCalledTimes(2);
  });

  it('closes its event stream', async () => {
    const { batch, stream } = await open();

    await batch.close();

    expect(
      (stream as unknown as { close: jest.Mock }).close,
    ).toHaveBeenCalled();
  });

  it('closes the stream it opened when it cannot get ready, and rethrows', async () => {
    ready = async () => {
      throw new Error('redis down');
    };

    await expect(open()).rejects.toThrow('redis down');
    expect(
      (streams.at(-1) as unknown as { close: jest.Mock }).close,
    ).toHaveBeenCalled();
  });

  it('hears a job that finishes before its enqueue has even returned', async () => {
    // The race `add()` is ordered for: the id is pending BEFORE the enqueue,
    // so an event that beats the enqueue's reply still finds it.
    const enqueue = jest.fn(
      async (_q: string, _d: unknown, o: { jobId: string }) => {
        streams.at(-1)!.emit('completed', {
          jobId: o.jobId,
          returnvalue: 'created',
        });
        return o.jobId;
      },
    );
    const opened = await open(enqueue);

    await opened.batch.add({ n: 1 }, 'fast');

    expect(opened.batch.take()).toEqual([
      { jobId: 'fast', ok: true, value: 'created' },
    ]);
    expect(opened.batch.pending).toBe(0);
  });

  it('reports a job someone else removed as failed, rather than waiting for it', async () => {
    const { batch, stream } = await open();
    await batch.add({ n: 1 }, 'a');

    stream.emit('removed', { jobId: 'a' });

    expect(batch.take()).toEqual([
      { jobId: 'a', ok: false, reason: 'removed from the queue' },
    ]);
  });

  it('does not report the jobs it drops itself', async () => {
    const queueService = {
      enqueue: jest.fn().mockResolvedValue('id'),
      removeJobIfPending: jest.fn(async () => {
        // BullMQ writes `removed` to the stream as part of the remove.
        streams.at(-1)!.emit('removed', { jobId: 'waiting' });
        return true;
      }),
    };
    const batch = await openQueueBatch<{ n: number }, string>({
      queueService: queueService as never,
      connection: {} as never,
      prefix: 'p',
      queueName: 'q',
    });
    await batch.add({ n: 1 }, 'waiting');

    await batch.dropWaiting();

    expect(batch.take()).toEqual([]);
    expect(batch.pending).toBe(0);
  });

  it('does not sleep on an outcome that arrived while the caller was busy', async () => {
    const { batch, stream } = await open();
    await batch.add({ n: 1 }, 'a');
    stream.emit('completed', { jobId: 'a', returnvalue: 'x' });

    const started = Date.now();
    await batch.waitForOutcome(60_000);

    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('treats a remove that throws (the job was just claimed) as not removed', async () => {
    const { batch, queueService, stream } = await open();
    queueService.removeJobIfPending.mockRejectedValue(
      new Error('could not be removed because it is locked'),
    );
    await batch.add({ n: 1 }, 'claimed');

    await expect(batch.dropWaiting()).resolves.toBe(0);
    expect(batch.pending).toBe(1);
    // It runs and reports, and a later real removal is still news.
    stream.emit('removed', { jobId: 'claimed' });
    expect(batch.take()).toEqual([
      { jobId: 'claimed', ok: false, reason: 'removed from the queue' },
    ]);
    await expect(batch.failPending('timed out')).resolves.toBeUndefined();
  });

  it('ignores the removal of a job it already reported failed', async () => {
    const { batch, stream } = await open();
    await batch.add({ n: 1 }, 'a');
    await batch.failPending('timed out');
    batch.take();

    stream.emit('removed', { jobId: 'a' });

    expect(batch.take()).toEqual([]);
  });
});
