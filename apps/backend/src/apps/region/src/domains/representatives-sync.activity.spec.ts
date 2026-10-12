import { Logger } from '@nestjs/common';
import { RepresentativesSyncService } from './representatives-sync.service';

/**
 * Activity summaries are reachable from a SYNC (#665 follow-up).
 *
 * The generator, its prompt wiring and its full provenance columns all
 * existed; nothing called it. Only a hand-invoked one-off script did, so it
 * had never run — **0 of 125 representatives**, against 125 bios and 79
 * committee summaries produced by the generators beside it in this same
 * method. A feature whose only trigger is someone remembering it exists is a
 * feature that stays empty, which is why this is tested through `sync()`
 * rather than by calling the generator directly.
 */
describe('representatives sync — activity summaries', () => {
  const rep = {
    externalId: 'ca-assembly-1',
    name: 'Test Member',
    chamber: 'Assembly',
    district: '1',
  };

  /** The sync's collaborators, reduced to what this path touches. */
  const buildDeps = () => ({
    db: {
      representative: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
      },
    },
    provider: {
      fetchRepresentatives: jest.fn().mockResolvedValue([rep]),
      getName: jest.fn().mockReturnValue('california'),
    },
    upsert: jest
      .fn()
      .mockResolvedValue({ processed: 1, created: 1, updated: 0 }),
  });

  const pluginContext = {
    regionName: 'California',
    regionId: 'california',
  } as never;

  const run = async (activity?: { generateAll: jest.Mock }): Promise<void> => {
    const deps = buildDeps();
    const service = new RepresentativesSyncService(
      deps.db as never,
      undefined, // bioGenerator
      undefined, // committeeSummaryGenerator
      undefined, // legislativeCommitteeLinker
      undefined, // legislativeCommitteeDescriptions
      activity as never,
    );

    await service.sync(
      deps.provider as never,
      undefined,
      'california',
      pluginContext,
      deps.upsert as never,
      () => '1',
    );
  };

  it('invokes the activity summary generator', async () => {
    const generateAll = jest
      .fn()
      .mockResolvedValue({ repsUpdated: 3, committeesUpdated: 2, skipped: 0 });

    await run({ generateAll });

    // The regression: this was never called from any sync, so the column sat
    // empty while every other AI field on the table was populated.
    expect(generateAll).toHaveBeenCalled();
  });

  it('reports the counts it produced', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    try {
      await run({
        generateAll: jest.fn().mockResolvedValue({
          repsUpdated: 3,
          committeesUpdated: 2,
          skipped: 0,
        }),
      });

      const line = log.mock.calls
        .map((c) => c[0])
        .filter((a): a is string => typeof a === 'string')
        .find((a) => a.includes('Activity summaries'));
      expect(line).toContain('3 representative(s)');
      expect(line).toContain('2 committee(s)');
    } finally {
      log.mockRestore();
    }
  });

  it('says WHY zero, so an empty window is not read as a dead feature', async () => {
    // The distinction this exists for: the current corpus's newest action is
    // 2026-08-12 and the default window is 90 days, so the honest answer
    // becomes zero around 2026-11-10. Without this wording, "0" then looks
    // identical to the four months when nothing was calling the generator.
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    try {
      await run({
        generateAll: jest.fn().mockResolvedValue({
          repsUpdated: 0,
          committeesUpdated: 0,
          skipped: 0,
        }),
      });

      const line = log.mock.calls
        .map((c) => c[0])
        .filter((a): a is string => typeof a === 'string')
        .find((a) => a.includes('Activity summaries'));
      expect(line).toContain(
        'no entity had legislative actions inside the window',
      );
    } finally {
      log.mockRestore();
    }
  });

  it('does not fail the roster sync when summary generation throws', async () => {
    // Matches its two siblings in this method: a roster sync that worked must
    // not be reported as failed because a summary pass did not.
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      await expect(
        run({
          generateAll: jest.fn().mockRejectedValue(new Error('ollama down')),
        }),
      ).resolves.toBeUndefined();

      const line = warn.mock.calls
        .map((c) => c[0])
        .filter((a): a is string => typeof a === 'string')
        .find((a) => a.includes('Activity summary generation failed'));
      expect(line).toContain('ollama down');
    } finally {
      warn.mockRestore();
    }
  });

  it('still syncs when no generator is bound at all', async () => {
    // It is @Optional(); an unwired generator must not break the sync.
    await expect(run(undefined)).resolves.toBeUndefined();
  });
});
