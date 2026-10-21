import { Logger } from '@nestjs/common';
import { Prisma } from '@opuspopuli/relationaldb-provider';
import { recordClaims } from './claim-recorder';
import {
  RepresentativesSyncService,
  trimBioChrome,
} from './representatives-sync.service';

jest.mock('./claim-recorder', () => ({
  recordClaims: jest.fn().mockResolvedValue({ written: 0, byState: {} }),
}));

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

// ─── trimBioChrome (#1382 follow-up) ─────────────────────────────────────────

/**
 * A container selector that captures a biography also captures the heading
 * above it and the call-to-action below. Measured across all 20 texts the
 * Senate selector returns: 4 are not biographies at all, and 15 of the
 * remaining 16 carry chrome. Every fixture here is real text from those pages.
 *
 * `trimBioChrome` does NO inference. Two heuristics were tried first and both
 * were wrong — see the function's docblock — so the wording lives in region
 * config and this only applies it.
 */
describe('trimBioChrome', () => {
  /** The California Senate set, as it appears in the region config. */
  const PATTERNS = [
    /^Body\s+/i,
    /^Senate District \d+\s+/i,
    /^Meet Senator\s+/i,
    /^ABOUT YOUR Senator\s+/i,
    /^Representing California Senate District \d+ State Senator\s+/i,
    /^Senate President Pro Tempore Emeritus Senator\s+/i,
    /\s*(?:Read Bio|Read More|Learn More(?:\s+About\s+[\w'’.-]+)?)\s*$/i,
  ];

  const PROSE =
    'was elected in 2022 to represent Sacramento and Elk Grove. The only ' +
    'woman on the Sacramento City Council for over six years, the first-ever ' +
    'in history to give birth while in office.';

  it('trims a "Meet Senator" heading', () => {
    const out = trimBioChrome(
      `Meet Senator Becker Senator Josh Becker ${PROSE}`,
      PATTERNS,
    );

    expect(out.startsWith('Becker Senator Josh Becker')).toBe(true);
    expect(out).not.toContain('Meet Senator');
  });

  it('trims a "Senate District NN" heading', () => {
    const out = trimBioChrome(
      `Senate District 03 Christopher Cabaldon ${PROSE}`,
      PATTERNS,
    );

    expect(out.startsWith('Christopher Cabaldon')).toBe(true);
    expect(out).not.toContain('Senate District 03');
  });

  it('trims the "Representing California Senate District N" heading', () => {
    const out = trimBioChrome(
      `Representing California Senate District 7 State Senator Jesse Arreguín ${PROSE}`,
      PATTERNS,
    );

    expect(out.startsWith('Jesse Arreguín')).toBe(true);
    expect(out).not.toContain('Representing California');
  });

  /**
   * sd18 — the page that exposed a real bug. `^Body\s+` replaced its match
   * with a space, leaving " Meet Senator Steve Padilla…", and every later
   * `^`-anchored pattern then missed. One page of 16 kept its chrome. The fix
   * is collapsing and trimming after EACH pattern, not once at the end.
   */
  it('applies a later anchored pattern after an earlier one matched', () => {
    const out = trimBioChrome(
      `Body Meet Senator Steve Padilla ${PROSE}`,
      PATTERNS,
    );

    expect(out).not.toContain('Body');
    expect(out).not.toContain('Meet Senator');
    expect(out.startsWith('Steve Padilla')).toBe(true);
  });

  it('trims a trailing call-to-action', () => {
    const out = trimBioChrome(`Senator Ashby ${PROSE} Read Bio`, PATTERNS);

    expect(out.endsWith('while in office.')).toBe(true);
    expect(out).not.toContain('Read Bio');
  });

  it('trims "Learn More About <name>"', () => {
    const out = trimBioChrome(
      `Senator Ashby ${PROSE} Learn More About Jesse`,
      PATTERNS,
    );

    // Asserts what SURVIVES, not just that the CTA is gone. A greedy
    // `/.*Learn More.*$/i` would empty the whole bio and still satisfy
    // `not.toContain` — every sibling trim test checks the remainder.
    expect(out).toBe(`Senator Ashby ${PROSE}`);
  });

  /**
   * The case deliberately left alone. sd21 reads "Senate President pro
   * Tempore Monique Limón was elected to…" — the title and name ARE the
   * opening of the prose, so any trim damages the bio. Note this is NOT
   * matched by the Emeritus pattern, which is the point.
   */
  it('leaves a heading alone when it is the start of the prose', () => {
    const bio =
      'Senate President pro Tempore Monique Limón was elected to the ' +
      'California State Senate in 2020 after serving in the Assembly, and ' +
      'represents the central coast.';

    expect(trimBioChrome(bio, PATTERNS)).toBe(bio);
  });

  it('collapses whitespace and is a no-op without chrome', () => {
    expect(trimBioChrome(`Senator Ashby   ${PROSE}`, PATTERNS)).toBe(
      `Senator Ashby ${PROSE}`,
    );
  });

  it('returns the bio unchanged when no patterns are configured', () => {
    const bio = `Meet Senator Becker Senator Josh Becker ${PROSE}`;

    expect(trimBioChrome(bio, [])).toBe(bio);
  });
});

describe('representatives sync — a scraped bio supersedes the AI claims (#1391)', () => {
  const SCRAPED = {
    externalId: 'ca-senate-7',
    name: 'Jesse Arreguín',
    chamber: 'Senate',
    district: '7',
    party: 'Democrat',
    // 100+ chars, so `isLikelyValidBio` admits it — a short fixture would
    // pass this test for the wrong reason.
    bio:
      'Senator Arreguín represents District 7, which covers Berkeley, ' +
      'Oakland, Richmond and the surrounding communities of the East Bay.',
    bioSource: 'scraped',
  };

  const run = async (
    rep: Record<string, unknown>,
    currentClaims: number,
    repRows: { id: string; externalId: string }[] = [
      { id: 'rep-uuid-7', externalId: 'ca-senate-7' },
    ],
  ) => {
    // One grouped query returns the per-rep count of current claims.
    const groupBy = jest.fn().mockResolvedValue(
      currentClaims > 0
        ? repRows.map((row) => ({
            subjectId: row.id,
            _count: { _all: currentClaims },
          }))
        : [],
    );
    const db = {
      representative: {
        findMany: jest.fn().mockResolvedValue(repRows),
        count: jest.fn().mockResolvedValue(1),
        upsert: jest.fn().mockResolvedValue({}),
      },
      claim: { groupBy },
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
  };

  beforeEach(() => {
    (recordClaims as jest.Mock).mockClear();
  });

  it('supersedes the stored claims when the bio arrives scraped', async () => {
    // The real failure: 22 claims for the two reps scraped on 2026-10-20 were
    // still current after their AI bios were replaced, asserting an invented
    // spouse and a school-board seat that does not exist.
    await run(SCRAPED, 13);

    expect(recordClaims).toHaveBeenCalledTimes(1);
    const [, input] = (recordClaims as jest.Mock).mock.calls[0];
    expect(input).toMatchObject({
      subjectType: 'representative',
      subjectId: 'rep-uuid-7',
      // Empty list IS the supersede: the writer closes the current rows and
      // skips the insert on rows.length === 0.
      claims: [],
      // Representative bios cite structured fields, so there is no text to
      // locate a quote in — what ClaimRecordInput documents null for.
      sourceText: null,
      sourceTextHash: null,
    });
  });

  it('does not touch claims when the scrape found no bio', async () => {
    // The precedence rule: a sync that scraped nothing must leave the
    // existing generated bio AND its claims entirely alone.
    //
    // `bioSource` is deliberately LEFT as 'scraped' and only `bio` cleared.
    // Clearing both changed both halves of `r.bio && r.bioSource ===
    // 'scraped'`, so dropping the `r.bio &&` test passed anyway.
    await run({ ...SCRAPED, bio: undefined }, 13);

    expect(recordClaims).not.toHaveBeenCalled();
  });

  it('does not supersede when the bio was AI-generated', async () => {
    await run({ ...SCRAPED, bioSource: 'ai-generated' }, 13);

    expect(recordClaims).not.toHaveBeenCalled();
  });

  it('skips a rep that has no current claims', async () => {
    // Avoids taking the writer's per-subject advisory lock, and keeps the log
    // line honest about how many claims actually moved.
    await run(SCRAPED, 0);

    expect(recordClaims).not.toHaveBeenCalled();
  });

  it('supersedes each rep found, not just the first', async () => {
    await run(SCRAPED, 9, [
      { id: 'rep-uuid-7', externalId: 'ca-senate-7' },
      { id: 'rep-uuid-8', externalId: 'ca-senate-8' },
    ]);

    expect(recordClaims).toHaveBeenCalledTimes(2);
    expect(
      (recordClaims as jest.Mock).mock.calls.map(([, i]) => i.subjectId),
    ).toEqual(['rep-uuid-7', 'rep-uuid-8']);
  });
});
