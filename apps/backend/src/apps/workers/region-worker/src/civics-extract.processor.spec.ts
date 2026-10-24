import { CivicsExtractProcessor } from './civics-extract.processor';
import type { CivicsSyncService } from 'src/apps/region/src/domains/civics-sync.service';
import type { CivicsExtractJobData } from '@opuspopuli/queue-provider';

/** Access the private `process` handler without going through BullMQ. */
function invoke(
  proc: CivicsExtractProcessor,
  data: CivicsExtractJobData,
): Promise<string> {
  return (
    proc as unknown as { process(job: { data: typeof data }): Promise<string> }
  ).process({ data });
}

const JOB: CivicsExtractJobData = {
  regionId: 'california',
  sourceUrl: 'https://www.senate.ca.gov/citizens-guide',
  sourceVersionId: 'sv-1',
  source: { url: 'https://www.senate.ca.gov', contentGoal: 'how a bill' },
};

describe('CivicsExtractProcessor', () => {
  it('returns the page outcome as the job result — the sync reads it off the completed event', async () => {
    const extractPage = jest.fn().mockResolvedValue('updated');
    const proc = new CivicsExtractProcessor(
      { extractPage } as unknown as CivicsSyncService,
      {} as never,
      { get: () => undefined } as never,
    );

    await expect(invoke(proc, JOB)).resolves.toBe('updated');
    expect(extractPage).toHaveBeenCalledWith(JOB);
  });

  it('lets a thrown error fail the job, so the queue retries it', async () => {
    const proc = new CivicsExtractProcessor(
      {
        extractPage: jest.fn().mockRejectedValue(new Error('runner died')),
      } as unknown as CivicsSyncService,
      {} as never,
      { get: () => undefined } as never,
    );

    await expect(invoke(proc, JOB)).rejects.toThrow('runner died');
  });
});
