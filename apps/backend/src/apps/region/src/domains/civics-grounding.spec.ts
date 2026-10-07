import { groundMeasureTypes } from './civics-grounding';

/**
 * The fixture is the real 2026-10-06 case, not an invented one: the five types
 * the model emitted for the SoS "cleared for circulation" page, against the
 * phrasing that page actually uses. Three names appear on it; `Referendum` and
 * `Recall` do not appear anywhere on it in any form.
 */
const PAGE = [
  'Initiatives and Referenda Cleared for Circulation',
  'CHILD SAFETY REQUIREMENTS FOR ARTIFICIAL INTELLIGENCE PRODUCTS. INITIATIVE STATUTE.',
  'Summary Date: 04/07/26 | Circulation Deadline 10/05/26 | Signatures Required: 874,641',
  'PROHIBITS NEW STATE LAWS. INITIATIVE CONSTITUTIONAL AMENDMENT.',
  'LIMITS ON PROPERTY TAX. INITIATIVE CONSTITUTIONAL AMENDMENT AND STATUTE.',
].join('\n');

const emitted = [
  { code: 'IS', name: 'Initiative Statute', votingThreshold: 'majority' },
  { code: 'ICA', name: 'Initiative Constitutional Amendment' },
  { code: 'ICAAS', name: 'Initiative Constitutional Amendment and Statute' },
  { code: 'IR', name: 'Referendum' },
  { code: 'Recall', name: 'Recall' },
];

describe('groundMeasureTypes', () => {
  it('canonicalises a compressed code to the name the page uses', () => {
    const { types, canonicalised } = groundMeasureTypes(emitted, PAGE);
    const codes = types.map((t) => t.code);
    expect(codes).toContain('Initiative Statute');
    expect(codes).toContain('Initiative Constitutional Amendment');
    expect(codes).toContain('Initiative Constitutional Amendment and Statute');
    expect(codes).not.toContain('IS');
    expect(codes).not.toContain('ICA');
    expect(canonicalised).toHaveLength(3);
    expect(canonicalised.every((c) => c.warrant === 'page')).toBe(true);
  });

  it('drops types the page does not support at all', () => {
    const { types, dropped } = groundMeasureTypes(emitted, PAGE);
    expect(types).toHaveLength(3);
    expect(dropped.sort()).toEqual(['IR', 'Recall']);
  });

  it('preserves fields other than the code', () => {
    const { types } = groundMeasureTypes(emitted, PAGE);
    const statute = types.find((t) => t.code === 'Initiative Statute');
    expect(statute?.votingThreshold).toBe('majority');
    expect(statute?.name).toBe('Initiative Statute');
  });

  it('keeps an abbreviation the page itself defines', () => {
    // The Assembly glossary defines its own shorthand, so AB is warranted
    // there even though the name is not spelled out beside every use.
    const glossaryPage =
      'AB - Assembly Bill. ACA - Assembly Constitutional Amendment.';
    const { types, dropped } = groundMeasureTypes(
      [
        { code: 'AB', name: 'Assembly Bill' },
        { code: 'ACA', name: 'Nothing Like This' },
      ],
      glossaryPage,
    );
    expect(types.map((t) => t.code)).toEqual(['Assembly Bill', 'ACA']);
    expect(dropped).toEqual([]);
  });

  it('does not let a short code match inside a longer word', () => {
    // `IS` inside `THIS`, `AB` inside `ABOUT` — the failure a naive
    // substring check would wave through.
    const page = 'THIS page is ABOUT nothing in particular.';
    const { types, dropped } = groundMeasureTypes(
      [
        { code: 'IS', name: 'Initiative Statute' },
        { code: 'AB', name: 'Assembly Bill' },
      ],
      page,
    );
    expect(types).toHaveLength(0);
    expect(dropped.sort()).toEqual(['AB', 'IS']);
  });

  /**
   * THE regression, from the 2026-10-06 run that had to be stopped. The
   * Assembly legislative-process page does not spell these out, but the
   * source's hint instructs the whole set, so page-only grounding deleted
   * eleven real California measure types and kept one.
   *
   * Verified by reintroducing it: drop the `HINTS` argument below and this
   * case fails with 11 dropped, which is exactly what production did.
   */
  it('keeps types the source hints instruct even when the page omits them', () => {
    const HINTS =
      'Capture all measure-type abbreviations (AB, SB, ACA, SCA, ACR, SCR, ' +
      'AJR, SJR, HR, SR) plus high-leverage procedural terms: engrossed, ' +
      'enrolled, chaptered, gut and amend, urgency clause.';
    const page =
      'How a bill becomes law in California. The process has many steps.';
    const emittedTypes = [
      'AB',
      'ACA',
      'SCA',
      'ACR',
      'SCR',
      'AJR',
      'SJR',
      'HR',
      'SR',
    ].map((code) => ({ code, name: `Something ${code} stands for` }));

    const pageOnly = groundMeasureTypes(emittedTypes, page);
    expect(pageOnly.dropped).toHaveLength(9); // what production did

    const withHints = groundMeasureTypes(emittedTypes, page, HINTS);
    expect(withHints.dropped).toEqual([]);
    expect(withHints.types.map((t) => t.code)).toEqual([
      'AB',
      'ACA',
      'SCA',
      'ACR',
      'SCR',
      'AJR',
      'SJR',
      'HR',
      'SR',
    ]);
  });

  it('still drops a type supported by neither the page nor the hints', () => {
    const HINTS = 'Capture all measure-type abbreviations (AB, SB, ACA).';
    const { types, dropped } = groundMeasureTypes(
      [
        { code: 'AB', name: 'Assembly Bill' },
        { code: 'IR', name: 'Referendum' },
        { code: 'Recall', name: 'Recall' },
      ],
      // Deliberately mentions neither. An earlier version of this fixture
      // said "never mentions referenda or recalls", which the matcher
      // correctly read as the page mentioning them — the fixture was wrong,
      // not the rule.
      'A page about bills and statutes, and the committees that hear them.',
      HINTS,
    );
    expect(dropped.sort()).toEqual(['IR', 'Recall']);
    expect(types).toHaveLength(1);
  });

  it('records which warrant canonicalised a code', () => {
    const { canonicalised } = groundMeasureTypes(
      [{ code: 'SB', name: 'Senate Bill' }],
      'Nothing relevant here.',
      'A Senate Bill originates in the Senate.',
    );
    expect(canonicalised).toEqual([
      { from: 'SB', to: 'Senate Bill', warrant: 'hint' },
    ]);
  });

  it('is a no-op on absent or malformed input', () => {
    expect(groundMeasureTypes(undefined, PAGE).types).toEqual([]);
    expect(groundMeasureTypes([], PAGE).dropped).toEqual([]);
    const odd = groundMeasureTypes([{ code: 42, name: null } as never], PAGE);
    expect(odd.types).toEqual([]);
    expect(odd.dropped).toEqual(['<unnamed>']);
  });
});

describe('groundMeasureTypes — duplicate collapse', () => {
  const PAGE =
    'AB - Assembly Bill. AJR - Assembly Joint Resolution. A resolution expressing an opinion.';

  it('collapses byte-identical duplicates, keeping one', () => {
    // The measured case: 13 identical copies on the Assembly glossary page.
    const thirteen = Array.from({ length: 13 }, () => ({
      code: 'AJR',
      name: 'Assembly Joint Resolution',
      chamber: 'Assembly',
    }));
    const { types, duplicatesRemoved, conflicting } = groundMeasureTypes(
      thirteen,
      PAGE,
    );
    expect(types).toHaveLength(1);
    expect(types[0].code).toBe('Assembly Joint Resolution');
    expect(duplicatesRemoved).toBe(12);
    expect(conflicting).toEqual([]);
  });

  it('collapses an abbreviation and its spelled-out form into one type', () => {
    // They are the same type and only look it after canonicalisation.
    const { types, duplicatesRemoved } = groundMeasureTypes(
      [
        { code: 'AJR', name: 'Assembly Joint Resolution' },
        {
          code: 'Assembly Joint Resolution',
          name: 'Assembly Joint Resolution',
        },
      ],
      PAGE,
    );
    expect(types).toHaveLength(1);
    expect(duplicatesRemoved).toBe(1);
  });

  it('flags duplicates that disagree instead of resolving them quietly', () => {
    const { types, duplicatesRemoved, conflicting } = groundMeasureTypes(
      [
        { code: 'AB', name: 'Assembly Bill', votingThreshold: 'majority' },
        { code: 'AB', name: 'Assembly Bill', votingThreshold: 'two-thirds' },
      ],
      PAGE,
    );
    expect(types).toHaveLength(1);
    expect(types[0].votingThreshold).toBe('majority'); // first wins
    expect(duplicatesRemoved).toBe(1);
    expect(conflicting).toEqual(['Assembly Bill']);
  });

  it('keeps genuinely distinct types', () => {
    const { types, duplicatesRemoved } = groundMeasureTypes(
      [
        { code: 'AB', name: 'Assembly Bill' },
        { code: 'AJR', name: 'Assembly Joint Resolution' },
      ],
      PAGE,
    );
    expect(types).toHaveLength(2);
    expect(duplicatesRemoved).toBe(0);
  });
});
