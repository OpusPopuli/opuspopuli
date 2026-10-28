import {
  ActivitySummaryProcessor,
  CommitteeDescriptionProcessor,
  CommitteeSummaryProcessor,
  RepresentativeBioProcessor,
} from './representative-output.processors';

/** Access the private `process` handler without going through BullMQ. */
function invoke(proc: unknown, data: object): Promise<string> {
  return (
    proc as {
      process(job: { id: string; data: object }): Promise<string>;
    }
  ).process({ id: 'job-1', data });
}

const connection = {} as never;
const config = { get: () => undefined } as never;

describe('representatives S4 processors', () => {
  it.each([
    [
      'representative-bio',
      (generateOne: jest.Mock) =>
        new RepresentativeBioProcessor(
          { generateOne } as never,
          connection,
          config,
        ),
      { representativeId: 'rep-1', regionName: 'California' },
      ['rep-1', 'California'],
    ],
    [
      'committee-summary',
      (generateOne: jest.Mock) =>
        new CommitteeSummaryProcessor(
          { generateOne } as never,
          connection,
          config,
        ),
      { representativeId: 'rep-1' },
      ['rep-1'],
    ],
    [
      'committee-description',
      (generateOne: jest.Mock) =>
        new CommitteeDescriptionProcessor(
          { generateOne } as never,
          connection,
          config,
        ),
      { committeeId: 'com-1' },
      ['com-1'],
    ],
    [
      'activity-summary',
      (generateOne: jest.Mock) =>
        new ActivitySummaryProcessor(
          { generateOne } as never,
          connection,
          config,
        ),
      { entityType: 'committee', entityId: 'com-1' },
      ['committee', 'com-1'],
    ],
  ])(
    '%s returns the outcome as the job result — the sync reads it off the completed event',
    async (_queue, build, data, args) => {
      const generateOne = jest.fn().mockResolvedValue('updated');

      await expect(invoke(build(generateOne), data)).resolves.toBe('updated');
      expect(generateOne).toHaveBeenCalledWith(...args);
    },
  );

  it('lets a transient failure fail the job, so the queue retries it', async () => {
    const generateOne = jest
      .fn()
      .mockRejectedValue(new Error('failed transiently (llm_error)'));
    const proc = new RepresentativeBioProcessor(
      { generateOne } as never,
      connection,
      config,
    );

    await expect(invoke(proc, { representativeId: 'rep-1' })).rejects.toThrow(
      'llm_error',
    );
  });
});
