import { MinutesSummaryProcessor } from './minutes-summary.processor';
import type { MinutesSummaryService } from 'src/apps/region/src/domains/minutes-summary.service';

/** Access the private `process` handler without going through BullMQ. */
function invoke(
  proc: MinutesSummaryProcessor,
  data: { minutesId: string; externalId?: string; force?: boolean },
): Promise<boolean> {
  return (
    proc as unknown as { process(job: { data: typeof data }): Promise<boolean> }
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
    const summarize = jest.fn().mockResolvedValue(true);
    const wrote = await invoke(build(summarize), {
      minutesId: 'm-1',
      externalId: 'x',
      force: true,
    });
    expect(summarize).toHaveBeenCalledWith('m-1', true);
    expect(wrote).toBe(true);
  });

  it('defaults force to false when the job omits it', async () => {
    const summarize = jest.fn().mockResolvedValue(false);
    await invoke(build(summarize), { minutesId: 'm-2' });
    expect(summarize).toHaveBeenCalledWith('m-2', false);
  });
});
