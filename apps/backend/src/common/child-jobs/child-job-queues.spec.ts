import { ChildJobQueues } from './child-job-queues';

describe('ChildJobQueues.enabled', () => {
  const queues = new ChildJobQueues({} as never, {} as never);

  afterEach(() => {
    delete process.env.BULLMQ_QUEUE_PROPOSITION_ANALYSIS_ENABLED;
  });

  it('is on unless the queue is switched off — the same switch that stops its consumer', () => {
    expect(queues.enabled('proposition-analysis')).toBe(true);

    process.env.BULLMQ_QUEUE_PROPOSITION_ANALYSIS_ENABLED = 'false';

    expect(queues.enabled('proposition-analysis')).toBe(false);
    expect(queues.enabled('civics-extract')).toBe(true);
  });
});
