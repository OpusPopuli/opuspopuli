import { PropositionAnalysisProcessor } from './proposition-analysis.processor';
import type { PropositionAnalysisService } from 'src/apps/region/src/domains/proposition-analysis.service';

/** Access the private `process` handler without going through BullMQ. */
function invoke(
  proc: PropositionAnalysisProcessor,
  data: { propositionId: string },
): Promise<string> {
  return (
    proc as unknown as {
      process(job: { id: string; data: typeof data }): Promise<string>;
    }
  ).process({ id: 'job-1', data });
}

const build = (analyseOne: jest.Mock) =>
  new PropositionAnalysisProcessor(
    { analyseOne } as unknown as PropositionAnalysisService,
    {} as never,
    { get: () => undefined } as never,
  );

describe('PropositionAnalysisProcessor', () => {
  it('returns the measure outcome as the job result — the sync reads it off the completed event', async () => {
    const analyseOne = jest.fn().mockResolvedValue('updated');

    await expect(
      invoke(build(analyseOne), { propositionId: 'p-1' }),
    ).resolves.toBe('updated');
    expect(analyseOne).toHaveBeenCalledWith('p-1');
  });

  it('lets a transient failure fail the job, so the queue retries it', async () => {
    const analyseOne = jest
      .fn()
      .mockRejectedValue(new Error('failed transiently (llm_error)'));

    await expect(
      invoke(build(analyseOne), { propositionId: 'p-1' }),
    ).rejects.toThrow('llm_error');
  });
});
