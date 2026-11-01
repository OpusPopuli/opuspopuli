import { MinutesSummaryProcessor } from './minutes-summary.processor';
import type { GeneratedOutputOutcome } from 'src/apps/region/src/domains/generated-output-key';
import type { MinutesSummaryService } from 'src/apps/region/src/domains/minutes-summary.service';

/** Access the private `process` handler without going through BullMQ. */
function invoke(
  proc: MinutesSummaryProcessor,
  data: { minutesId: string; externalId?: string; force?: boolean },
): Promise<GeneratedOutputOutcome> {
  return (
    proc as unknown as {
      process(job: { data: typeof data }): Promise<GeneratedOutputOutcome>;
    }
  ).process({ data });
}

function build(summarize: jest.Mock): MinutesSummaryProcessor {
  return new MinutesSummaryProcessor(
    { summarize } as unknown as MinutesSummaryService,
    {} as never,
    { get: () => undefined } as never,
  );
}

describe('MinutesSummaryProcessor', () => {
  it('delegates a job to MinutesSummaryService.summarize (force passed through)', async () => {
    const summarize = jest.fn().mockResolvedValue('created');
    const outcome = await invoke(build(summarize), {
      minutesId: 'm-1',
      externalId: 'x',
      force: true,
    });
    expect(summarize).toHaveBeenCalledWith('m-1', true);
    expect(outcome).toBe('created');
  });

  it.each<GeneratedOutputOutcome>(['unchanged', 'failed'])(
    'returns the outcome %s as the job result',
    async (value) => {
      const summarize = jest.fn().mockResolvedValue(value);
      await expect(
        invoke(build(summarize), { minutesId: 'm-2' }),
      ).resolves.toBe(value);
    },
  );

  it('defaults force to false when the job omits it', async () => {
    const summarize = jest.fn().mockResolvedValue('skipped');
    await invoke(build(summarize), { minutesId: 'm-2' });
    expect(summarize).toHaveBeenCalledWith('m-2', false);
  });
});
