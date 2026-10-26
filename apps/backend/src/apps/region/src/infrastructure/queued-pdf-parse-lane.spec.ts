import { QueuedPdfParseLane } from './queued-pdf-parse-lane';
import type { SourceVersionService } from '../domains/source-version.service';
import type { ChildJobQueues } from 'src/common/child-jobs/child-job-queues';
import type { ChildOutcome } from 'src/common/child-jobs/child-job-batch';
import type { QueueService } from '@opuspopuli/queue-provider';

const run = jest.fn<Promise<ChildOutcome<string>>, [string, unknown, number]>();
const close = jest.fn().mockResolvedValue(undefined);
jest.mock('src/common/child-jobs/child-job-waiter', () => ({
  ...jest.requireActual('src/common/child-jobs/child-job-waiter'),
  ChildJobWaiter: jest.fn().mockImplementation(() => ({ run, close })),
}));

const KEY = 'pdf-v3+abc123';
const TIMED_OUT: ChildOutcome<string> = {
  jobId: 'j',
  ok: false,
  reason: 'no outcome within 600000ms',
};

function build(
  opts: {
    enabled?: boolean;
    parsed?: string | undefined;
    jobState?: string | null;
  } = {},
) {
  const getParsedText = jest
    .fn()
    .mockResolvedValue('parsed' in opts ? opts.parsed : 'the text');
  const queues = {
    enabled: jest.fn().mockReturnValue(opts.enabled ?? true),
    open: jest.fn(),
  } as unknown as ChildJobQueues;
  const queueService = {
    getJobInfo: jest
      .fn()
      .mockResolvedValue(
        opts.jobState === undefined || opts.jobState === null
          ? null
          : { state: opts.jobState },
      ),
    removeJobIfPending: jest.fn().mockResolvedValue(true),
  };
  const lane = new QueuedPdfParseLane(
    { getParsedText } as unknown as SourceVersionService,
    queues,
    queueService as unknown as QueueService,
  );
  return { lane, getParsedText, queueService };
}

describe('QueuedPdfParseLane', () => {
  beforeEach(() => {
    run.mockReset();
    delete process.env.PDF_PARSE_LANE_TIMEOUT_MS;
  });

  it('reads the recorded parse back once the job reports it parsed', async () => {
    run.mockResolvedValue({ jobId: 'j', ok: true, value: 'parsed' });
    const { lane, getParsedText } = build();

    await expect(lane.parse('sv-1', KEY)).resolves.toBe('the text');
    expect(getParsedText).toHaveBeenCalledWith('sv-1', KEY);
    const [jobId, data, timeout] = run.mock.calls[0];
    expect(data).toEqual({ sourceVersionId: 'sv-1', parserKey: KEY });
    expect(timeout).toBe(10 * 60 * 1000);
    // One job per artifact and key; no ':' (BullMQ rejects it in custom ids).
    expect(jobId).toMatch(/^sv-1__parse__[0-9a-f]{16}$/);
  });

  it('gives a different job id to the same artifact under another key', async () => {
    run.mockResolvedValue({ jobId: 'j', ok: true, value: 'reused' });
    const { lane } = build();
    await lane.parse('sv-1', KEY);
    await lane.parse('sv-1', 'pdf-v3+other');
    expect(run.mock.calls[0][0]).not.toBe(run.mock.calls[1][0]);
  });

  it.each(['incomplete', 'key_mismatch', 'missing'])(
    'returns undefined on %s, so the provider parses in process',
    async (value) => {
      run.mockResolvedValue({ jobId: 'j', ok: true, value });
      const { lane, getParsedText } = build();
      await expect(lane.parse('sv-1', KEY)).resolves.toBeUndefined();
      expect(getParsedText).not.toHaveBeenCalled();
    },
  );

  describe('when the wait runs out', () => {
    it('removes a job still waiting, so the in-process parse is the only one', async () => {
      run.mockResolvedValue(TIMED_OUT);
      const { lane, queueService } = build({
        jobState: 'waiting',
        parsed: undefined,
      });

      await expect(lane.parse('sv-1', KEY)).resolves.toBeUndefined();
      expect(queueService.removeJobIfPending).toHaveBeenCalledWith(
        'pdf-parse',
        run.mock.calls[0][0],
      );
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('waits once more for a job already running, bounded by the thread timeout', async () => {
      run
        .mockResolvedValueOnce(TIMED_OUT)
        .mockResolvedValueOnce({ jobId: 'j', ok: true, value: 'parsed' });
      const { lane, queueService } = build({ jobState: 'active' });

      await expect(lane.parse('sv-1', KEY)).resolves.toBe('the text');
      expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[1][0]).toBe(run.mock.calls[0][0]);
      expect(run.mock.calls[1][2]).toBe(5 * 60 * 1000 + 60_000);
      expect(queueService.removeJobIfPending).not.toHaveBeenCalled();
    });

    it('waits for a job a consumer claimed between the look and the remove', async () => {
      run
        .mockResolvedValueOnce(TIMED_OUT)
        .mockResolvedValueOnce({ jobId: 'j', ok: true, value: 'parsed' });
      const { lane, queueService } = build({ jobState: 'waiting' });
      queueService.getJobInfo
        .mockResolvedValueOnce({ state: 'waiting' })
        .mockResolvedValueOnce({ state: 'active' });
      queueService.removeJobIfPending.mockResolvedValue(false);

      await expect(lane.parse('sv-1', KEY)).resolves.toBe('the text');
      expect(run).toHaveBeenCalledTimes(2);
    });

    it('takes a parse that landed between the timeout and the check', async () => {
      run.mockResolvedValue(TIMED_OUT);
      const { lane } = build({ jobState: null, parsed: 'landed' });
      await expect(lane.parse('sv-1', KEY)).resolves.toBe('landed');
    });
  });

  it('returns undefined when the job itself failed', async () => {
    run.mockResolvedValue({ jobId: 'j', ok: false, reason: 'thread died' });
    const { lane, queueService } = build({ parsed: undefined });
    await expect(lane.parse('sv-1', KEY)).resolves.toBeUndefined();
    // Not a timeout: nothing to check on or remove.
    expect(queueService.getJobInfo).not.toHaveBeenCalled();
  });

  it('never throws — a Redis error is a fallback, not a failed sync', async () => {
    run.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(build().lane.parse('sv-1', KEY)).resolves.toBeUndefined();
  });

  it('queues nothing when the queue is switched off', async () => {
    const { lane } = build({ enabled: false });
    await expect(lane.parse('sv-1', KEY)).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it('queues nothing without a queue connection (an API process)', async () => {
    const lane = new QueuedPdfParseLane({} as SourceVersionService);
    await expect(lane.parse('sv-1', KEY)).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it('honours PDF_PARSE_LANE_TIMEOUT_MS', async () => {
    process.env.PDF_PARSE_LANE_TIMEOUT_MS = '1500';
    run.mockResolvedValue({ jobId: 'j', ok: true, value: 'parsed' });
    await build().lane.parse('sv-1', KEY);
    expect(run.mock.calls[0][2]).toBe(1500);
  });
});
