import { Logger } from '@nestjs/common';
import { MinutesSummaryProcessor } from './minutes-summary.processor';
import type { GeneratedOutputOutcome } from 'src/apps/region/src/domains/generated-output-key';
import type { MinutesSummaryService } from 'src/apps/region/src/domains/minutes-summary.service';

/** Access the private `process` handler without going through BullMQ. */
function invoke(
  proc: MinutesSummaryProcessor,
  data: {
    minutesId: string;
    externalId?: string;
    force?: boolean;
    selectedUnderConfigHash?: string;
  },
): Promise<GeneratedOutputOutcome> {
  return (
    proc as unknown as {
      process(job: { data: typeof data }): Promise<GeneratedOutputOutcome>;
    }
  ).process({ data });
}

function build(summarize: jest.Mock): MinutesSummaryProcessor {
  return new MinutesSummaryProcessor(
    {
      summarize,
      configHash: () => 'own-config',
    } as unknown as MinutesSummaryService,
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

  describe('selection config (§4d)', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    it('warns once, naming the settings, when region selected under another config', async () => {
      const proc = build(jest.fn().mockResolvedValue('unchanged'));
      const job = {
        minutesId: 'm-1',
        selectedUnderConfigHash: 'region-config',
      };

      await invoke(proc, job);
      await invoke(proc, job);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(
        'MINUTES_SUMMARY_MAX_TOKENS',
      );
    });

    it.each([['own-config'], [undefined]])(
      'is quiet when the configs agree, or the job predates the field (%s)',
      async (selected) => {
        await invoke(build(jest.fn().mockResolvedValue('created')), {
          minutesId: 'm-1',
          selectedUnderConfigHash: selected,
        });
        expect(warn).not.toHaveBeenCalled();
      },
    );
  });

  it('defaults force to false when the job omits it', async () => {
    const summarize = jest.fn().mockResolvedValue('skipped');
    await invoke(build(summarize), { minutesId: 'm-2' });
    expect(summarize).toHaveBeenCalledWith('m-2', false);
  });
});
