/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for getCivicsData merge logic and normalizeCivicText helper.
 * Uses prototype-level mock — no NestJS DI needed.
 *
 * After DEBT-030 refactor:
 *   - sanitizeCivicsUrl / normalizeCivicText live on RegionSyncService
 *   - getCivicsData lives on RegionQueryService
 */

import { RegionQueryService } from './region-query.service';

const SRC = 'https://example.gov/page';

/**
 * Build a prototype-level RegionQueryService mock.
 * After DEBT-030: sanitizeCivicsUrl, normalizeCivicText, and getCivicsData
 * all live on RegionQueryService.
 */
function buildSvc(dbRows: any[] = []): any {
  const svc = Object.create(RegionQueryService.prototype);
  Object.assign(svc, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    db: {
      civicsBlock: {
        findMany: jest.fn().mockResolvedValue(dbRows),
      },
    },
  });
  return svc;
}

// ── sanitizeCivicsUrl ─────────────────────────────────────────────────────────

describe('sanitizeCivicsUrl', () => {
  const svc = buildSvc();

  it('passes through https URLs', () => {
    expect(svc.sanitizeCivicsUrl('https://example.gov/contact')).toBe(
      'https://example.gov/contact',
    );
  });

  it('passes through http URLs', () => {
    expect(svc.sanitizeCivicsUrl('http://example.gov/contact')).toBe(
      'http://example.gov/contact',
    );
  });

  it('blocks javascript: URLs', () => {
    expect(svc.sanitizeCivicsUrl('javascript:alert(1)')).toBeUndefined();
  });

  it('blocks javascript: URLs with encoding tricks', () => {
    expect(svc.sanitizeCivicsUrl('javascript\t:alert(1)')).toBeUndefined();
    expect(svc.sanitizeCivicsUrl(' javascript:alert(1)')).toBeUndefined();
  });

  it('blocks data: URLs', () => {
    expect(
      svc.sanitizeCivicsUrl('data:text/html,<script>alert(1)</script>'),
    ).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(svc.sanitizeCivicsUrl(undefined)).toBeUndefined();
  });

  it('returns undefined for malformed URLs', () => {
    expect(svc.sanitizeCivicsUrl('not a url')).toBeUndefined();
  });
});

// ── normalizeCivicText ────────────────────────────────────────────────────────

describe('normalizeCivicText', () => {
  const svc = buildSvc();

  it('returns verbatim/plainLanguage/sourceUrl from a proper CivicText object', () => {
    const result = svc.normalizeCivicText(
      {
        verbatim: 'Original',
        plainLanguage: 'Plain',
        sourceUrl: 'https://x.gov',
      },
      SRC,
    );
    expect(result).toEqual({
      verbatim: 'Original',
      plainLanguage: 'Plain',
      sourceUrl: 'https://x.gov',
    });
  });

  it('uses verbatim as plainLanguage fallback when plainLanguage is missing', () => {
    const result = svc.normalizeCivicText({ verbatim: 'Original' }, SRC);
    expect(result.plainLanguage).toBe('Original');
    expect(result.sourceUrl).toBe(SRC);
  });

  it('uses fallbackSourceUrl when sourceUrl is missing from object', () => {
    const result = svc.normalizeCivicText(
      { verbatim: 'V', plainLanguage: 'P' },
      SRC,
    );
    expect(result.sourceUrl).toBe(SRC);
  });

  it('normalises a plain string to verbatim=plainLanguage=string', () => {
    const result = svc.normalizeCivicText('Introduction', SRC);
    expect(result).toEqual({
      verbatim: 'Introduction',
      plainLanguage: 'Introduction',
      sourceUrl: SRC,
    });
  });

  it('normalises null to empty strings and does not throw', () => {
    const result = svc.normalizeCivicText(null, SRC);
    expect(result.verbatim).toBe('');
    expect(result.plainLanguage).toBe('');
  });

  it('normalises undefined to empty strings', () => {
    const result = svc.normalizeCivicText(undefined, SRC);
    expect(result.verbatim).toBe('');
  });

  it('logs a warning and returns empty strings for an array value', () => {
    const result = svc.normalizeCivicText(['bad'], SRC);
    expect(result.verbatim).toBe('');
    expect(svc.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('array'),
    );
  });

  it('logs a warning and returns empty strings for a boolean value', () => {
    const result = svc.normalizeCivicText(true, SRC);
    expect(result.verbatim).toBe('');
    expect(svc.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('boolean'),
    );
  });
});

// ── getCivicsData ─────────────────────────────────────────────────────────────

describe('getCivicsData', () => {
  it('returns null when no rows exist for the region', async () => {
    const svc = buildSvc([]);
    expect(await svc.getCivicsData('california')).toBeNull();
  });

  it('returns null when all rows have empty arrays and no sessionScheme', async () => {
    const svc = buildSvc([
      {
        sourceUrl: SRC,
        chambers: [],
        measureTypes: [],
        lifecycleStages: [],
        glossary: [],
        sessionScheme: null,
      },
    ]);
    expect(await svc.getCivicsData('california')).toBeNull();
  });

  it('merges glossary entries from a single row', async () => {
    const svc = buildSvc([
      {
        sourceUrl: SRC,
        chambers: null,
        measureTypes: null,
        lifecycleStages: null,
        sessionScheme: null,
        glossary: [
          {
            term: 'Engrossed',
            slug: 'engrossed',
            definition: { verbatim: 'V', plainLanguage: 'P', sourceUrl: SRC },
            relatedTerms: [],
          },
        ],
      },
    ]);
    const result = await svc.getCivicsData('california');
    expect(result).not.toBeNull();
    expect(result!.glossary).toHaveLength(1);
    expect(result!.glossary[0].slug).toBe('engrossed');
  });

  it('deduplicates glossary entries by slug across rows (first wins)', async () => {
    const svc = buildSvc([
      {
        sourceUrl: SRC,
        chambers: null,
        measureTypes: null,
        lifecycleStages: null,
        sessionScheme: null,
        glossary: [
          {
            slug: 'engrossed',
            term: 'Engrossed',
            definition: {
              verbatim: 'First',
              plainLanguage: 'First',
              sourceUrl: SRC,
            },
            relatedTerms: [],
          },
        ],
      },
      {
        sourceUrl: 'https://example.gov/other',
        chambers: null,
        measureTypes: null,
        lifecycleStages: null,
        sessionScheme: null,
        glossary: [
          {
            slug: 'engrossed',
            term: 'Engrossed',
            definition: {
              verbatim: 'Second',
              plainLanguage: 'Second',
              sourceUrl: SRC,
            },
            relatedTerms: [],
          },
        ],
      },
    ]);
    const result = await svc.getCivicsData('california');
    expect(result!.glossary).toHaveLength(1);
    expect(result!.glossary[0].definition.verbatim).toBe('First');
  });

  it('deduplicates measureTypes by code across rows', async () => {
    const svc = buildSvc([
      {
        sourceUrl: SRC,
        chambers: null,
        lifecycleStages: null,
        glossary: null,
        sessionScheme: null,
        measureTypes: [
          {
            code: 'AB',
            name: 'Assembly Bill',
            chamber: 'Assembly',
            votingThreshold: 'majority',
            reachesGovernor: true,
            purpose: 'A bill.',
            lifecycleStageIds: [],
          },
        ],
      },
      {
        sourceUrl: 'https://example.gov/other',
        chambers: null,
        lifecycleStages: null,
        glossary: null,
        sessionScheme: null,
        measureTypes: [
          {
            code: 'AB',
            name: 'Assembly Bill (dup)',
            chamber: 'Assembly',
            votingThreshold: 'majority',
            reachesGovernor: true,
            purpose: 'A bill.',
            lifecycleStageIds: [],
          },
        ],
      },
    ]);
    const result = await svc.getCivicsData('california');
    expect(result!.measureTypes).toHaveLength(1);
    expect(result!.measureTypes[0].name).toBe('Assembly Bill');
  });

  it('first non-null sessionScheme wins across rows', async () => {
    const svc = buildSvc([
      {
        sourceUrl: SRC,
        chambers: null,
        measureTypes: null,
        lifecycleStages: null,
        glossary: [{ slug: 'x', term: 'X', definition: 'X', relatedTerms: [] }],
        sessionScheme: {
          cadence: 'annual',
          namingPattern: '{year}',
          description: 'First',
        },
      },
      {
        sourceUrl: 'https://example.gov/b',
        chambers: null,
        measureTypes: null,
        lifecycleStages: null,
        glossary: null,
        sessionScheme: {
          cadence: 'biennial',
          namingPattern: '{y1}-{y2}',
          description: 'Second',
        },
      },
    ]);
    const result = await svc.getCivicsData('california');
    expect(result!.sessionScheme?.cadence).toBe('annual');
  });

  it('normalises plain-string lifecycle stage name to CivicText', async () => {
    const svc = buildSvc([
      {
        sourceUrl: SRC,
        chambers: null,
        measureTypes: null,
        glossary: null,
        sessionScheme: null,
        lifecycleStages: [
          {
            id: 'introduction',
            name: 'Introduction',
            shortDescription: 'The bill is introduced.',
            statusStringPatterns: [],
          },
        ],
      },
    ]);
    const result = await svc.getCivicsData('california');
    const stage = result!.lifecycleStages[0];
    expect(stage.name.verbatim).toBe('Introduction');
    expect(stage.name.plainLanguage).toBe('Introduction');
    expect(stage.shortDescription.verbatim).toBe('The bill is introduced.');
  });

  it('uses safe array fallback when leadershipRoles is not an array', async () => {
    const svc = buildSvc([
      {
        sourceUrl: SRC,
        measureTypes: null,
        lifecycleStages: null,
        glossary: null,
        sessionScheme: null,
        chambers: [
          {
            name: 'Assembly',
            abbreviation: 'A',
            size: 80,
            termYears: 2,
            leadershipRoles: 'Speaker',
            description: 'The lower house.',
          },
        ],
      },
    ]);
    const result = await svc.getCivicsData('california');
    expect(result!.chambers[0].leadershipRoles).toEqual([]);
  });

  it('strips javascript: URLs from citizenAction.url (XSS prevention)', async () => {
    const svc = buildSvc([
      {
        sourceUrl: SRC,
        chambers: null,
        measureTypes: null,
        glossary: null,
        sessionScheme: null,
        lifecycleStages: [
          {
            id: 'intro',
            name: 'Introduction',
            shortDescription: 'Introduced.',
            statusStringPatterns: [],
            citizenAction: {
              verb: 'learn',
              label: 'Read the bill',
              urgency: 'passive',
              url: 'javascript:alert(document.cookie)',
            },
          },
        ],
      },
    ]);
    const result = await svc.getCivicsData('california');
    expect(result!.lifecycleStages[0].citizenAction?.url).toBeUndefined();
  });

  it('preserves https: citizenAction URLs', async () => {
    const svc = buildSvc([
      {
        sourceUrl: SRC,
        chambers: null,
        measureTypes: null,
        glossary: null,
        sessionScheme: null,
        lifecycleStages: [
          {
            id: 'intro',
            name: 'Introduction',
            shortDescription: 'Introduced.',
            statusStringPatterns: [],
            citizenAction: {
              verb: 'contact',
              label: 'Contact your rep',
              urgency: 'active',
              url: 'https://example.gov/contact',
            },
          },
        ],
      },
    ]);
    const result = await svc.getCivicsData('california');
    expect(result!.lifecycleStages[0].citizenAction?.url).toBe(
      'https://example.gov/contact',
    );
  });
});

// ── measure-type identity across pages (#1340) ────────────────────────────────

/**
 * Grounding (#1337) makes `code` page-dependent by design: the full name when
 * the page warrants it, the abbreviation when only the source hints do. Keying
 * this merge on `code` therefore served one type twice — 8 of 25 entries on the
 * California region were duplicates.
 *
 * `text` builds the CivicText shape the model requires.
 */
function text(verbatim: string, plainLanguage = 'P', sourceUrl = SRC): any {
  return { verbatim, plainLanguage, sourceUrl };
}

function mtRow(
  sourceUrl: string,
  measureTypes: Record<string, unknown>[],
): any {
  return {
    sourceUrl,
    chambers: null,
    measureTypes,
    lifecycleStages: null,
    glossary: null,
    sessionScheme: null,
  };
}

describe('getCivicsData — measure-type identity', () => {
  it('serves ONE entry for a type that arrives as AB and as Assembly Bill', async () => {
    const svc = buildSvc([
      mtRow('https://a.gov/glossary', [
        {
          code: 'Assembly Bill',
          name: 'Assembly Bill',
          chamber: 'Assembly',
          votingThreshold: 'majority',
          reachesGovernor: true,
          purpose: text('A bill is a proposed law.'),
          lifecycleStageIds: ['introduced'],
        },
      ]),
      mtRow('https://a.gov/process', [
        {
          code: 'AB',
          name: 'Assembly Bill',
          chamber: 'Assembly',
          votingThreshold: 'majority',
          reachesGovernor: true,
          purpose: text('A bill.'),
          lifecycleStageIds: ['policy-committee'],
        },
      ]),
    ]);

    const result = await svc.getCivicsData('california');
    expect(result!.measureTypes).toHaveLength(1);
    expect(result!.measureTypes[0].code).toBe('AB');
    expect(result!.measureTypes[0].name).toBe('Assembly Bill');
  });

  it('reaches the same single entry whichever page was extracted last', async () => {
    const glossary = {
      code: 'Assembly Bill',
      name: 'Assembly Bill',
      chamber: 'Assembly',
      votingThreshold: 'majority',
      reachesGovernor: true,
      purpose: text('A bill is a proposed law.'),
      lifecycleStageIds: ['introduced'],
    };
    const process = {
      code: 'AB',
      name: 'Assembly Bill',
      chamber: 'Assembly',
      votingThreshold: 'majority',
      reachesGovernor: true,
      purpose: text('A bill.'),
      lifecycleStageIds: ['policy-committee'],
    };

    const forward = await buildSvc([
      mtRow('https://a.gov/glossary', [glossary]),
      mtRow('https://a.gov/process', [process]),
    ]).getCivicsData('california');
    const reversed = await buildSvc([
      mtRow('https://a.gov/process', [process]),
      mtRow('https://a.gov/glossary', [glossary]),
    ]).getCivicsData('california');

    expect(forward!.measureTypes).toHaveLength(1);
    expect(reversed!.measureTypes).toHaveLength(1);
    expect(reversed!.measureTypes[0].code).toBe(forward!.measureTypes[0].code);
    expect(reversed!.measureTypes[0].purpose.verbatim).toBe(
      forward!.measureTypes[0].purpose.verbatim,
    );
  });

  it('keeps the richer purpose and unions the stage ids', async () => {
    const svc = buildSvc([
      mtRow('https://a.gov/status', [
        {
          code: 'AB',
          name: 'Assembly Bill',
          purpose: text('A bill.'),
          lifecycleStageIds: ['introduced', 'chaptered'],
        },
      ]),
      mtRow('https://a.gov/glossary', [
        {
          code: 'Assembly Bill',
          name: 'Assembly Bill',
          purpose: text(
            'A bill is a proposed law introduced in either house of the Legislature.',
          ),
          lifecycleStageIds: ['chaptered', 'governor-action'],
        },
      ]),
    ]);

    const result = await svc.getCivicsData('california');
    expect(result!.measureTypes[0].purpose.verbatim).toContain('either house');
    expect(result!.measureTypes[0].lifecycleStageIds).toEqual([
      'introduced',
      'chaptered',
      'governor-action',
    ]);
  });

  /**
   * HR and SR arrive as abbreviations with no spelled-out counterpart on any
   * page. A merge that invented a full-name code for them would be fabricating
   * what no source supplied.
   */
  it('leaves an abbreviation-only type alone', async () => {
    const svc = buildSvc([
      mtRow(SRC, [
        {
          code: 'HR',
          name: 'House Resolution',
          purpose: text('A resolution.'),
          lifecycleStageIds: [],
        },
      ]),
    ]);

    const result = await svc.getCivicsData('california');
    expect(result!.measureTypes).toHaveLength(1);
    expect(result!.measureTypes[0].code).toBe('HR');
  });

  it('still keeps genuinely different types apart', async () => {
    const svc = buildSvc([
      mtRow(SRC, [
        { code: 'AB', name: 'Assembly Bill', purpose: text('A') },
        { code: 'SB', name: 'Senate Bill', purpose: text('B') },
      ]),
    ]);

    const result = await svc.getCivicsData('california');
    expect(result!.measureTypes).toHaveLength(2);
    expect(result!.measureTypes.map((m: any) => m.code).sort()).toEqual([
      'AB',
      'SB',
    ]);
  });

  it('warns when two pages disagree about what the type is', async () => {
    const svc = buildSvc([
      mtRow('https://a.gov/one', [
        {
          code: 'AB',
          name: 'Assembly Bill',
          votingThreshold: 'majority',
          purpose: text('A'),
        },
      ]),
      mtRow('https://a.gov/two', [
        {
          code: 'Assembly Bill',
          name: 'Assembly Bill',
          votingThreshold: 'two-thirds',
          purpose: text('B'),
        },
      ]),
    ]);

    const result = await svc.getCivicsData('california');
    expect(result!.measureTypes).toHaveLength(1);
    expect(result!.measureTypes[0].votingThreshold).toBe('majority');
    expect(svc.logger.warn).toHaveBeenCalled();
    const [meta] = svc.logger.warn.mock.calls[0];
    expect(meta.disagreements).toEqual([
      'votingThreshold: majority vs two-thirds',
    ]);
  });

  it('does not warn when the copies agree', async () => {
    const svc = buildSvc([
      mtRow('https://a.gov/one', [
        { code: 'AB', name: 'Assembly Bill', purpose: text('A') },
      ]),
      mtRow('https://a.gov/two', [
        { code: 'Assembly Bill', name: 'Assembly Bill', purpose: text('B') },
      ]),
    ]);

    await svc.getCivicsData('california');
    expect(svc.logger.warn).not.toHaveBeenCalled();
  });

  it('drops a measure type with no code, as it always has', async () => {
    const svc = buildSvc([
      mtRow(SRC, [{ name: 'Assembly Bill', purpose: text('A') }]),
    ]);

    expect(await svc.getCivicsData('california')).toBeNull();
  });
});
