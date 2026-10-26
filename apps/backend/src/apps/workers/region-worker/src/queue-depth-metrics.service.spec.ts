import { QueueDepthMetricsService } from './queue-depth-metrics.service';
import type { QueueService } from '@opuspopuli/queue-provider';

function build(queues: Partial<Record<keyof QueueService, jest.Mock>>) {
  const jobs = { set: jest.fn(), remove: jest.fn() };
  const oldest = { set: jest.fn(), remove: jest.fn() };
  const service = new QueueDepthMetricsService(
    queues as unknown as QueueService,
    jobs as never,
    oldest as never,
  );
  return { service, jobs, oldest };
}

describe('QueueDepthMetricsService', () => {
  it('sets each queue’s per-state count and oldest-waiting age', async () => {
    const { service, jobs, oldest } = build({
      listQueueNames: jest.fn().mockResolvedValue(['pdf-parse']),
      getDepth: jest.fn().mockResolvedValue({
        waiting: 4,
        active: 1,
        delayed: 0,
        failed: 2,
        oldestWaitingSeconds: 90,
      }),
    });

    await service.sample();

    expect(jobs.set).toHaveBeenCalledWith(
      { queue: 'pdf-parse', state: 'waiting' },
      4,
    );
    expect(jobs.set).toHaveBeenCalledWith(
      { queue: 'pdf-parse', state: 'failed' },
      2,
    );
    expect(jobs.set).toHaveBeenCalledTimes(4);
    expect(oldest.set).toHaveBeenCalledWith({ queue: 'pdf-parse' }, 90);
  });

  it('re-reads the queue list only every 10th sample, and drops a vanished queue’s series', async () => {
    const listQueueNames = jest
      .fn()
      .mockResolvedValueOnce(['pdf-parse', 'old-queue'])
      .mockResolvedValueOnce(['pdf-parse']);
    const getDepth = jest.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      oldestWaitingSeconds: 0,
    });
    const { service, jobs, oldest } = build({ listQueueNames, getDepth });

    for (let i = 0; i < 10; i++) await service.sample();
    expect(listQueueNames).toHaveBeenCalledTimes(1);
    expect(jobs.remove).not.toHaveBeenCalled();

    await service.sample();
    expect(listQueueNames).toHaveBeenCalledTimes(2);
    expect(jobs.remove).toHaveBeenCalledWith({
      queue: 'old-queue',
      state: 'waiting',
    });
    expect(oldest.remove).toHaveBeenCalledWith({ queue: 'old-queue' });
  });

  it('swallows a Redis failure — a missed sample is a gap, not a crash', async () => {
    const { service, jobs } = build({
      listQueueNames: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    await expect(service.sample()).resolves.toBeUndefined();
    expect(jobs.set).not.toHaveBeenCalled();
  });

  it('does not start when QUEUE_DEPTH_SAMPLE_MS is 0', () => {
    process.env.QUEUE_DEPTH_SAMPLE_MS = '0';
    const listQueueNames = jest.fn().mockResolvedValue([]);
    const { service } = build({ listQueueNames });
    service.onApplicationBootstrap();
    expect(listQueueNames).not.toHaveBeenCalled();
    delete process.env.QUEUE_DEPTH_SAMPLE_MS;
  });
});
