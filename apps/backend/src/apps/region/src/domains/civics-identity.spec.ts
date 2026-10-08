import {
  measureTypeKey,
  mergeMeasureTypes,
  normaliseIdentity,
  reconcileMeasureType,
  type MergeableMeasureType,
} from './civics-identity';

/**
 * The fixtures below are the real California rows, trimmed. `AB` arrived from
 * the legislative-process pages (abbreviation warranted by the source hints)
 * and `Assembly Bill` from the Assembly glossary page (full name warranted by
 * the page). Both are correct per page; serving both is the defect.
 */
function measureType(
  over: Partial<MergeableMeasureType> = {},
): MergeableMeasureType {
  return {
    code: 'AB',
    name: 'Assembly Bill',
    chamber: 'Assembly',
    votingThreshold: 'majority',
    reachesGovernor: true,
    purpose: {
      verbatim: 'A bill introduced in the Assembly.',
      plainLanguage: 'A proposed law starting in the Assembly.',
      sourceUrl: 'https://www.assembly.ca.gov/resources/legislative-process',
    },
    lifecycleStageIds: ['introduced', 'policy-committee'],
    ...over,
  };
}

describe('normaliseIdentity', () => {
  it('folds case and collapses whitespace', () => {
    expect(normaliseIdentity('  Assembly   BILL ')).toBe('assembly bill');
  });

  it('leaves an empty string empty', () => {
    expect(normaliseIdentity('   ')).toBe('');
  });
});

describe('measureTypeKey', () => {
  it('keys on the name, which is what agrees across pages', () => {
    expect(measureTypeKey('Assembly Bill', 'AB')).toBe('assembly bill');
    expect(measureTypeKey('Assembly Bill', 'Assembly Bill')).toBe(
      'assembly bill',
    );
  });

  it('gives the two split codes the SAME key — the whole point', () => {
    expect(measureTypeKey('Assembly Bill', 'AB')).toBe(
      measureTypeKey('Assembly Bill', 'Assembly Bill'),
    );
  });

  /**
   * Without this fallback every name-less row collapses into one entry keyed on
   * the empty string, which would merge unrelated types together — a worse bug
   * than the one being fixed.
   */
  it('falls back to the code when the name is missing', () => {
    expect(measureTypeKey('', 'HR')).toBe('hr');
  });

  it('does not collide two genuinely different types', () => {
    expect(measureTypeKey('Senate Bill', 'SB')).not.toBe(
      measureTypeKey('Assembly Bill', 'AB'),
    );
  });
});

describe('reconcileMeasureType', () => {
  it('prefers the abbreviation over a code that repeats its own name', () => {
    const degenerate = measureType({ code: 'Assembly Bill' });
    const abbreviated = measureType({ code: 'AB' });

    expect(reconcileMeasureType(degenerate, abbreviated).merged.code).toBe(
      'AB',
    );
    expect(reconcileMeasureType(degenerate, abbreviated).merged.name).toBe(
      'Assembly Bill',
    );
  });

  it('keeps the abbreviation when the incumbent already has it', () => {
    const abbreviated = measureType({ code: 'AB' });
    const degenerate = measureType({ code: 'Assembly Bill' });

    expect(reconcileMeasureType(abbreviated, degenerate).merged.code).toBe(
      'AB',
    );
  });

  /**
   * Order-independence is the property that makes the result trustworthy:
   * `getCivicsData` reads rows `orderBy extractedAt desc`, so without this the
   * served code would depend on which page was scraped last.
   */
  it('reaches the same code whichever copy arrives first', () => {
    const a = measureType({ code: 'AB' });
    const b = measureType({ code: 'Assembly Bill' });

    expect(reconcileMeasureType(a, b).merged.code).toBe(
      reconcileMeasureType(b, a).merged.code,
    );
  });

  it('leaves both degenerate copies alone — nothing better is on offer', () => {
    const a = measureType({ code: 'Assembly Bill' });
    const b = measureType({ code: 'Assembly Bill' });

    expect(reconcileMeasureType(a, b).merged.code).toBe('Assembly Bill');
  });

  it('keeps the more informative purpose', () => {
    const thin = measureType({
      purpose: { verbatim: 'A bill.', plainLanguage: '', sourceUrl: 'a' },
    });
    const rich = measureType({
      purpose: {
        verbatim:
          'A bill is a proposed law introduced in either house of the Legislature.',
        plainLanguage: 'A proposal that becomes law if it passes both houses.',
        sourceUrl: 'b',
      },
    });

    expect(reconcileMeasureType(thin, rich).merged.purpose.verbatim).toContain(
      'either house',
    );
    expect(reconcileMeasureType(rich, thin).merged.purpose.verbatim).toContain(
      'either house',
    );
  });

  /**
   * The attestation test. `sourceUrl` is the claim about where the text beside
   * it came from, so the whole CivicText has to move together — splicing the
   * longer `verbatim` onto the other copy's `sourceUrl` would attribute a quote
   * to a page that does not contain it.
   */
  it('carries purpose as one object, so the text keeps its own sourceUrl', () => {
    const thin = measureType({
      purpose: { verbatim: 'Short.', plainLanguage: '', sourceUrl: 'page-a' },
    });
    const rich = measureType({
      purpose: {
        verbatim: 'A considerably longer explanation of the measure type.',
        plainLanguage: 'Longer plain-language text as well.',
        sourceUrl: 'page-b',
      },
    });

    const { purpose } = reconcileMeasureType(thin, rich).merged;
    expect(purpose.sourceUrl).toBe('page-b');
    expect(purpose.verbatim).toBe(
      'A considerably longer explanation of the measure type.',
    );
  });

  /**
   * Measured: Assembly Bill arrived with 9, 11 and 8 stage ids from three pages.
   * Picking one set discarded stages the other pages had correctly linked.
   */
  it('unions the lifecycle stage ids rather than picking a set', () => {
    const a = measureType({ lifecycleStageIds: ['introduced', 'chaptered'] });
    const b = measureType({
      lifecycleStageIds: ['chaptered', 'governor-action'],
    });

    expect(reconcileMeasureType(a, b).merged.lifecycleStageIds).toEqual([
      'introduced',
      'chaptered',
      'governor-action',
    ]);
  });

  it('reports no disagreement when the classifying fields agree', () => {
    expect(
      reconcileMeasureType(measureType(), measureType({ code: 'AB' }))
        .disagreements,
    ).toEqual([]);
  });

  /**
   * No pair in the measured data disagrees, which is exactly why this is
   * reported rather than silently resolved: it will only ever fire on something
   * new, and a contradiction about what a measure type IS should not be a
   * silent coin flip.
   */
  it('reports a disagreement about what the type is, and keeps the first', () => {
    const majority = measureType({ votingThreshold: 'majority' });
    const twoThirds = measureType({
      code: 'Assembly Bill',
      votingThreshold: 'two-thirds',
    });

    const { merged, disagreements } = reconcileMeasureType(majority, twoThirds);
    expect(disagreements).toEqual(['votingThreshold: majority vs two-thirds']);
    expect(merged.votingThreshold).toBe('majority');
  });

  it('reports every disagreeing field, not just the first', () => {
    const { disagreements } = reconcileMeasureType(
      measureType(),
      measureType({
        chamber: 'Senate',
        votingThreshold: 'two-thirds',
        reachesGovernor: false,
      }),
    );
    expect(disagreements).toHaveLength(3);
    expect(disagreements.join(' ')).toContain('chamber: Assembly vs Senate');
    expect(disagreements.join(' ')).toContain('reachesGovernor: true vs false');
  });

  it('fills a missing name from the other copy', () => {
    const nameless = measureType({ name: '' });
    expect(reconcileMeasureType(nameless, measureType()).merged.name).toBe(
      'Assembly Bill',
    );
  });

  it('does not mutate either input', () => {
    const a = measureType({ code: 'Assembly Bill' });
    const b = measureType({ code: 'AB', lifecycleStageIds: ['chaptered'] });
    reconcileMeasureType(a, b);

    expect(a.code).toBe('Assembly Bill');
    expect(a.lifecycleStageIds).toEqual(['introduced', 'policy-committee']);
    expect(b.lifecycleStageIds).toEqual(['chaptered']);
  });
});

describe('mergeMeasureTypes', () => {
  it('collapses the same-name pair into one entry keeping the abbreviation', () => {
    const { types } = mergeMeasureTypes([
      measureType({ code: 'Assembly Bill' }),
      measureType({ code: 'AB' }),
    ]);

    expect(types).toHaveLength(1);
    expect(types[0].code).toBe('AB');
  });

  /**
   * The direction an existing test caught. Two pages can agree on the code and
   * disagree on the name; keying on name alone split those, which is this
   * module's own defect mirrored.
   */
  it('collapses a same-CODE pair whose names differ', () => {
    const { types } = mergeMeasureTypes([
      measureType({ code: 'AB', name: 'Assembly Bill' }),
      measureType({ code: 'AB', name: 'Assembly Bill (as amended)' }),
    ]);

    expect(types).toHaveLength(1);
    expect(types[0].code).toBe('AB');
  });

  /**
   * Transitivity: the third copy matches the group by the alias the SECOND copy
   * contributed, not by anything the first had. Without re-registering aliases
   * after a merge this lands in its own group.
   */
  it('absorbs a copy matching an alias an earlier merge contributed', () => {
    const { types } = mergeMeasureTypes([
      measureType({ code: 'Assembly Bill', name: 'Assembly Bill' }),
      measureType({ code: 'AB', name: 'Assembly Bill' }),
      measureType({ code: 'AB', name: 'Assembly Bill (amended)' }),
    ]);

    expect(types).toHaveLength(1);
    expect(types[0].code).toBe('AB');
  });

  it('keeps genuinely different types apart', () => {
    const { types } = mergeMeasureTypes([
      measureType({ code: 'AB', name: 'Assembly Bill' }),
      measureType({ code: 'SB', name: 'Senate Bill' }),
      measureType({ code: 'HR', name: 'House Resolution' }),
    ]);

    expect(types.map((t) => t.code)).toEqual(['AB', 'SB', 'HR']);
  });

  it('preserves order of first appearance', () => {
    const { types } = mergeMeasureTypes([
      measureType({ code: 'SB', name: 'Senate Bill' }),
      measureType({ code: 'AB', name: 'Assembly Bill' }),
      measureType({ code: 'Senate Bill', name: 'Senate Bill' }),
    ]);

    expect(types.map((t) => t.name)).toEqual(['Senate Bill', 'Assembly Bill']);
  });

  /**
   * An empty alias must never be a match key, or every entry missing a name
   * would collapse into whichever other entry also lacked one.
   */
  it('does not merge two name-less types on their shared empty name', () => {
    const { types } = mergeMeasureTypes([
      measureType({ code: 'AB', name: '' }),
      measureType({ code: 'SB', name: '' }),
    ]);

    expect(types).toHaveLength(2);
  });

  it('reports conflicts with the type they belong to', () => {
    const { types, conflicts } = mergeMeasureTypes([
      measureType({ code: 'AB', votingThreshold: 'majority' }),
      measureType({ code: 'Assembly Bill', votingThreshold: 'two-thirds' }),
    ]);

    expect(types).toHaveLength(1);
    expect(conflicts).toEqual([
      {
        type: 'assembly bill',
        disagreements: ['votingThreshold: majority vs two-thirds'],
      },
    ]);
  });

  it('reports nothing for agreeing copies', () => {
    expect(
      mergeMeasureTypes([
        measureType({ code: 'AB' }),
        measureType({ code: 'Assembly Bill' }),
      ]).conflicts,
    ).toEqual([]);
  });

  it('handles an empty input', () => {
    expect(mergeMeasureTypes([])).toEqual({ types: [], conflicts: [] });
  });

  /**
   * The measured shape of the real California data: three Assembly Bill copies
   * across pages, with complementary stage sets and purposes of very different
   * richness. One entry, the abbreviation, the best purpose, all nine stages.
   */
  it('reproduces the measured California case', () => {
    const { types } = mergeMeasureTypes([
      measureType({
        code: 'AB',
        purpose: {
          verbatim: 'A bill.',
          plainLanguage: '',
          sourceUrl: 'status',
        },
        lifecycleStageIds: ['introduced', 'policy-committee'],
      }),
      measureType({
        code: 'AB',
        purpose: {
          verbatim: 'A bill is a proposed law.',
          plainLanguage: '',
          sourceUrl: 'process',
        },
        lifecycleStageIds: ['second-reading', 'third-reading'],
      }),
      measureType({
        code: 'Assembly Bill',
        purpose: {
          verbatim:
            'A bill is a proposed law introduced in either house of the Legislature, which becomes a statute if passed and signed.',
          plainLanguage:
            'A proposal that becomes law if it passes both houses.',
          sourceUrl: 'glossary',
        },
        lifecycleStageIds: ['governor-action', 'chaptered'],
      }),
    ]);

    expect(types).toHaveLength(1);
    expect(types[0].code).toBe('AB');
    expect(types[0].name).toBe('Assembly Bill');
    expect(types[0].purpose.sourceUrl).toBe('glossary');
    expect(types[0].lifecycleStageIds).toEqual([
      'introduced',
      'policy-committee',
      'second-reading',
      'third-reading',
      'governor-action',
      'chaptered',
    ]);
  });
});
