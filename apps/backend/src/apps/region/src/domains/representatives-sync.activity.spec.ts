import { Logger } from '@nestjs/common';
import { Prisma } from '@opuspopuli/relationaldb-provider';
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

/**
 * `maxReps` reaches the FETCH, not just bio generation (#1387).
 *
 * It used to cap generation only, so a 5-rep smoke test still performed 120
 * detail fetches plus 80 secondary `/biography` fetches with retries against
 * two government sites. The reason to ask for 5 reps is to try a change
 * cheaply; the cap has to reduce requests, not just discard their results.
 */
describe('representatives sync — maxReps bounds the fetch (#1387)', () => {
  const rep = {
    externalId: 'ca-assembly-1',
    name: 'Test Member',
    chamber: 'Assembly',
    district: '1',
  };

  const run = async (maxReps: number | undefined) => {
    const provider = {
      fetchRepresentatives: jest.fn().mockResolvedValue([rep]),
      getName: jest.fn().mockReturnValue('california'),
    };
    const db = {
      representative: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new RepresentativesSyncService(
      db as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    await service.sync(
      provider as never,
      maxReps,
      'california',
      { regionName: 'California', regionId: 'california' } as never,
      jest
        .fn()
        .mockResolvedValue({ processed: 1, created: 1, updated: 0 }) as never,
      () => '1',
    );

    return provider.fetchRepresentatives;
  };

  it('passes the cap into fetchRepresentatives', async () => {
    const fetchRepresentatives = await run(5);

    expect(fetchRepresentatives).toHaveBeenCalledWith(5);
  });

  // This adds a bound; it must not introduce a default. An uncapped sync has
  // to keep sweeping the whole roster.
  it('passes nothing when no cap was asked for', async () => {
    const fetchRepresentatives = await run(undefined);

    expect(fetchRepresentatives).toHaveBeenCalledWith(undefined);
  });
});

/**
 * A scraped bio must carry NO AI attribution (#1391).
 *
 * `bioClaims`, `bioPromptHash`, `bioPromptVersion`, `bioLlmModel` and
 * `bioLlmDigest` are written only by the generation path, and the upsert
 * passes `undefined` — which Prisma reads as "leave alone" — so a scraped bio
 * inherited whatever the last generated one claimed: a verbatim government
 * page attributed to nemotron, with per-sentence claims for sentences no
 * longer present. #1281 made attribution structural so an output could not be
 * unattributable; this keeps it from becoming misattributable.
 */
describe('representatives sync — AI attribution on a scraped bio (#1391)', () => {
  /** `String?` columns, where a literal null is the correct clear. */
  const STRING_FIELDS = [
    'bioPromptHash',
    'bioPromptVersion',
    'bioLlmModel',
    'bioLlmDigest',
  ] as const;

  /**
   * `bio_claims` is JSONB, and Prisma rejects a literal `null` there — it
   * needs `Prisma.DbNull`. Asserted separately and explicitly, because the
   * first version of this fix used `null` and would have thrown
   * PrismaClientValidationError on every scraped-bio upsert. The mocked
   * `upsert` below cannot catch that, which is why the integration test
   * beside this file exists.
   */
  const JSON_FIELD = 'bioClaims';

  const run = async (rep: Record<string, unknown>) => {
    const upsert = jest.fn().mockResolvedValue({});
    const db = {
      representative: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
        upsert,
      },
    };
    const service = new RepresentativesSyncService(
      db as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    await service.sync(
      {
        fetchRepresentatives: jest.fn().mockResolvedValue([rep]),
        getName: jest.fn().mockReturnValue('california'),
      } as never,
      undefined,
      'california',
      { regionName: 'California', regionId: 'california' } as never,
      (async (
        reps: unknown[],
        _find: unknown,
        map: (items: unknown[]) => unknown[],
      ) => {
        await Promise.all(map(reps) as Promise<unknown>[]);
        return { processed: reps.length, created: 0, updated: reps.length };
      }) as never,
      () => '1',
    );

    return (upsert.mock.calls[0][0] as { update: Record<string, unknown> })
      .update;
  };

  const base = {
    externalId: 'ca-senate-8',
    name: 'Angelique V. Ashby',
    chamber: 'Senate',
    district: '8',
    party: 'Democratic',
  };

  it('nulls every AI attribution field when the bio was scraped', async () => {
    const update = await run({
      ...base,
      // Must clear 100 chars or `isLikelyValidBio` discards it as junk —
      // which silently made an earlier version of this test pass for the
      // wrong reason. Real text from sd08.senate.ca.gov.
      bio:
        'Senator Ashby was elected in 2022 to represent Sacramento and Elk ' +
        'Grove. The only woman on the Sacramento City Council for over six ' +
        'years, the first-ever in history to give birth while in office.',
      bioSource: 'scraped',
    });

    expect(update.bioSource).toBe('scraped');
    // Explicitly cleared, NOT undefined: Prisma reads undefined as "leave
    // alone", which is the bug.
    for (const field of STRING_FIELDS) {
      expect(update[field]).toBeNull();
    }
    expect(update[JSON_FIELD]).toBe(Prisma.DbNull);
  });

  // Clearing unconditionally would wipe attribution off every legitimately
  // generated bio on the next sync — the opposite failure.
  it('leaves attribution alone for a generated bio', async () => {
    const update = await run({
      ...base,
      bio:
        'Angelique V. Ashby represents California State Senate District 8 as ' +
        'a Democrat. She was first elected to the State Senate in 2020 and ' +
        'is currently serving her second term.',
      bioSource: 'ai-generated',
    });

    for (const field of STRING_FIELDS) {
      expect(update[field]).not.toBeNull();
    }
    expect(update[JSON_FIELD]).not.toBe(Prisma.DbNull);
  });

  // A sync that scraped nothing must not touch the stored bio or its
  // attribution — `undefined` = skip is correct here.
  it('leaves bio and attribution alone when no bio was scraped', async () => {
    const update = await run({ ...base });

    expect(update.bio).toBeUndefined();
    for (const field of STRING_FIELDS) {
      expect(update[field]).not.toBeNull();
    }
    expect(update[JSON_FIELD]).not.toBe(Prisma.DbNull);
  });
});
