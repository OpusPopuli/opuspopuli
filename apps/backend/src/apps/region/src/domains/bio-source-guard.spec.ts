import type { BioClaim } from '@opuspopuli/common';
import { dropUnsupportedSentences } from './bio-source-guard';

/** The exact four-field shape `formatRepData` sends for 109 of 125 reps. */
const FOUR_FIELDS = [
  'Name: Heather Hadwick',
  'Jurisdiction: California State Assembly',
  'District: 1',
  'Party: Republican',
].join('\n');

const claim = (sentence: string, origin: BioClaim['origin']): BioClaim => ({
  sentence,
  origin,
  sourceField: origin === 'source' ? 'Name' : null,
  sourceHint: origin === 'training' ? 'press coverage' : null,
  confidence: 'high',
});

describe('dropUnsupportedSentences', () => {
  it('drops an election year the four source fields cannot support', () => {
    // Verbatim nemotron output under prompt v2 — the residual failure the
    // guard exists for. Hadwick was elected in 2024, not 2022.
    const bio =
      'Heather Hadwick is a Republican member of the California State ' +
      'Assembly representing District 1. She was first elected in 2022.';

    const result = dropUnsupportedSentences(bio, FOUR_FIELDS);

    expect(result.bio).toBe(
      'Heather Hadwick is a Republican member of the California State ' +
        'Assembly representing District 1.',
    );
    expect(result.dropped).toEqual([
      { sentence: 'She was first elected in 2022.', reasons: ['year'] },
    ]);
  });

  it('keeps a year the source data actually states', () => {
    // The scraped-bio path: once the source supplies the year, the same
    // sentence is evidence-backed and must survive.
    const source = `${FOUR_FIELDS}\nBio: Hadwick was elected in 2024.`;
    const bio = 'Hadwick represents District 1. She was elected in 2024.';

    const result = dropUnsupportedSentences(bio, source);

    expect(result.bio).toBe(bio);
    expect(result.dropped).toEqual([]);
  });

  it('drops a different year even when the source states one', () => {
    // The guard compares years, not their presence. A source saying 2024
    // must not license a sentence claiming 2020.
    const source = `${FOUR_FIELDS}\nBio: Hadwick was elected in 2024.`;
    const bio =
      'Hadwick represents District 1. She was elected in 2024. ' +
      'She previously served on a city council from 2020.';

    const result = dropUnsupportedSentences(bio, source);

    expect(result.bio).toBe(
      'Hadwick represents District 1. She was elected in 2024.',
    );
    expect(result.dropped).toEqual([
      {
        sentence: 'She previously served on a city council from 2020.',
        reasons: ['year'],
      },
    ]);
  });

  it('drops the claim belonging to a dropped sentence', () => {
    // A surviving claim for a removed sentence would attest to text that is
    // no longer in the bio — the attribution chain pointing at nothing.
    const bio = 'Hadwick represents District 1. She was first elected in 2022.';
    const claims = [
      claim('Hadwick represents District 1.', 'source'),
      claim('She was first elected in 2022.', 'source'),
    ];

    const result = dropUnsupportedSentences(bio, FOUR_FIELDS, claims);

    expect(result.claims).toEqual([
      claim('Hadwick represents District 1.', 'source'),
    ]);
  });

  it('matches a claim whose whitespace differs from the bio', () => {
    const bio = 'Hadwick represents District 1.\nShe was elected in 2022.';
    const claims = [claim('She was  elected   in 2022.', 'source')];

    const result = dropUnsupportedSentences(bio, FOUR_FIELDS, claims);

    expect(result.claims).toEqual([]);
  });

  it('does not split a sentence on an initial or an honorific', () => {
    // The year must sit in the SAME sentence as the abbreviation for this to
    // bite. Without the abbreviation guard the boundary regex splits after
    // "Dr." and after "Q.", so only the final fragment is dropped and the
    // bio is published as the stranded "Dr. Jane Q." — a severed clause
    // under a representative's name. A mis-split away from a year rejoins
    // losslessly and would make this test vacuous.
    const bio = 'Dr. Jane Q. Public was first elected in 2022.';

    const result = dropUnsupportedSentences(bio, FOUR_FIELDS);

    expect(result.bio).toBe('');
    expect(result.dropped).toEqual([
      {
        sentence: 'Dr. Jane Q. Public was first elected in 2022.',
        reasons: ['year'],
      },
    ]);
  });

  it('drops the whole sentence when an abbreviation precedes the year', () => {
    const bio =
      'Hadwick represents District 1. She served in the U.S. Army and was ' +
      'first elected in 2022.';

    const result = dropUnsupportedSentences(bio, FOUR_FIELDS);

    // Not 'Hadwick represents District 1. She served in the U.S.'
    expect(result.bio).toBe('Hadwick represents District 1.');
  });

  it('removes a paragraph left empty, not a blank gap', () => {
    const bio =
      'Hadwick represents District 1.\n\nShe was first elected in 2022.' +
      '\n\nShe resides in Modoc County.';

    const result = dropUnsupportedSentences(bio, FOUR_FIELDS);

    expect(result.bio).toBe(
      'Hadwick represents District 1.\n\nShe resides in Modoc County.',
    );
  });

  it('returns an empty bio when every sentence is unsupported', () => {
    // The caller stores no bio at all in this case rather than a fragment.
    const result = dropUnsupportedSentences(
      'She was first elected in 2022. She was re-elected in 2024.',
      FOUR_FIELDS,
    );

    expect(result.bio).toBe('');
    expect(result.dropped).toHaveLength(2);
  });

  it('leaves a bio with no years untouched, object identity included', () => {
    const bio = 'Hadwick represents California Assembly District 1.';
    const claims = [claim(bio, 'source')];

    const result = dropUnsupportedSentences(bio, FOUR_FIELDS, claims);

    expect(result.bio).toBe(bio);
    expect(result.claims).toBe(claims);
    expect(result.dropped).toEqual([]);
  });

  it('drops a term count, which four fields cannot support', () => {
    // Measured: Jones, Bennett and Carrillo were each given "his first term".
    // Jones has served since 2018.
    const bio =
      'Brian Jones is a Republican member of the California State Senate ' +
      'representing District 40. He is currently serving his first term in ' +
      'the Senate.';

    const result = dropUnsupportedSentences(bio, FOUR_FIELDS);

    expect(result.bio).toBe(
      'Brian Jones is a Republican member of the California State Senate ' +
        'representing District 40.',
    );
  });

  it('drops an ordinal term count written in digits', () => {
    const result = dropUnsupportedSentences(
      'Hadwick represents District 1. She is serving her 3rd term.',
      FOUR_FIELDS,
    );

    expect(result.bio).toBe('Hadwick represents District 1.');
  });

  it('drops a leadership post', () => {
    // Measured: Grove was named "the current Senate Republican Leader", a
    // post she left in 2022. Leadership also belongs to the committee
    // summary, which the bio prompt forbids duplicating.
    const bio =
      'Shannon Grove is a Republican member of the California State Senate ' +
      'representing District 12. She is the current Senate Republican Leader.';

    const result = dropUnsupportedSentences(bio, FOUR_FIELDS);

    expect(result.bio).toBe(
      'Shannon Grove is a Republican member of the California State Senate ' +
        'representing District 12.',
    );
  });

  it('drops a precedence claim', () => {
    // Measured on Cervantes: "the first woman to represent the district".
    //
    // The source is Cervantes's own, not `FOUR_FIELDS`: that fixture is
    // Hadwick, a Republican, so a bio saying "Democrat" was unsupported on
    // the party class too and BOTH sentences went — the test passed for the
    // wrong reason once party became enforced.
    const source = [
      'Name: Sabrina Cervantes',
      'Jurisdiction: California State Senate',
      'District: 31',
      'Party: Democrat',
    ].join('\n');
    const bio =
      "Sabrina Cervantes represents California's 31st Senate district as a " +
      'Democrat. She is the first woman to represent the district in the ' +
      'State Senate.';

    const result = dropUnsupportedSentences(bio, source);

    expect(result.bio).toBe(
      "Sabrina Cervantes represents California's 31st Senate district as a " +
        'Democrat.',
    );
    expect(result.dropped[0].reasons).toEqual(['precedence claim']);
  });

  it('keeps a leadership post the source data states', () => {
    const source = `${FOUR_FIELDS}\nBio: Grove is the Senate Republican Leader.`;
    const bio =
      'Grove represents District 12. She is the Senate Republican Leader.';

    expect(dropUnsupportedSentences(bio, source).bio).toBe(bio);
  });

  it('drops a DIFFERENT leadership post than the one the source states', () => {
    // Presence of one post must not license another: the match is compared,
    // not the fact class.
    const source = `${FOUR_FIELDS}\nBio: Grove is the Senate Republican Leader.`;
    const bio =
      'Grove represents District 12. She is the Senate Republican Leader. ' +
      'She serves as Minority Whip.';

    expect(dropUnsupportedSentences(bio, source).bio).toBe(
      'Grove represents District 12. She is the Senate Republican Leader.',
    );
  });

  it('does not treat an ordinal district as a term count', () => {
    const bio = "Berman represents California's 23rd Assembly District.";

    expect(dropUnsupportedSentences(bio, FOUR_FIELDS).bio).toBe(bio);
  });

  it('names every class that made a sentence unsupported', () => {
    // The first production drop was a term count and the log called it a
    // year, because `dropped` carried only the sentence. A sentence can fail
    // on more than one class at once, and the log should say which.
    const result = dropUnsupportedSentences(
      'Hadwick represents District 1. She is serving her first term since 2022.',
      FOUR_FIELDS,
    );

    expect(result.dropped).toEqual([
      {
        sentence: 'She is serving her first term since 2022.',
        reasons: ['year', 'term count'],
      },
    ]);
  });

  it('reports a class once even when it matches twice', () => {
    // Two unsupported years in one sentence is one reason, not two. Without
    // the per-class break the log reads "[year+year]".
    const result = dropUnsupportedSentences(
      'Aguiar-Curry represents District 4. She was elected in 2016 and re-elected in 2018.',
      FOUR_FIELDS,
    );

    expect(result.dropped[0].reasons).toEqual(['year']);
  });

  it('reports a term count as a term count, not a year', () => {
    const result = dropUnsupportedSentences(
      'Alvarez represents District 80. He is currently serving his first term in the Assembly.',
      FOUR_FIELDS,
    );

    expect(result.dropped[0].reasons).toEqual(['term count']);
  });

  it('drops a party the source does not carry', () => {
    // Measured on the Sonoma supervisors: the party field is absent, and
    // omitting it did not stop the model supplying one — 4 of 5 bios
    // asserted a party for a named non-partisan county official.
    const source = [
      'Name: Lynda Hopkins',
      'Jurisdiction: Sonoma County Board of Supervisors',
      'District: 5',
    ].join('\n');
    const bio =
      'Hopkins represents District 5 on the Sonoma County Board of ' +
      'Supervisors. She is a member of the Republican Party.';

    const result = dropUnsupportedSentences(bio, source);

    expect(result.bio).toBe(
      'Hopkins represents District 5 on the Sonoma County Board of ' +
        'Supervisors.',
    );
    expect(result.dropped[0].reasons).toEqual(['party affiliation']);
  });

  it('keeps the party the source states', () => {
    const bio = 'Hadwick represents District 1 as a Republican.';

    expect(dropUnsupportedSentences(bio, FOUR_FIELDS).bio).toBe(bio);
  });

  it('drops a DIFFERENT party than the one the source states', () => {
    const bio =
      'Hadwick represents District 1 as a Republican. She caucuses with ' +
      'the Democrats.';

    expect(dropUnsupportedSentences(bio, FOUR_FIELDS).bio).toBe(
      'Hadwick represents District 1 as a Republican.',
    );
  });

  it('treats only four-digit years as years', () => {
    // A 2-digit district could never match, so asserting that alone caught
    // almost no mutation. These pin the pattern's bounds: three and five
    // digits, and a year outside the civic range, must all be left alone.
    for (const bio of [
      'Carrillo represents District 39 in the State Assembly.',
      'The committee reviewed 390 bills this session.',
      'The measure allocated 20240 dollars to the district.',
      'The ordinance dates to 1699 under Spanish rule.',
    ]) {
      expect(dropUnsupportedSentences(bio, FOUR_FIELDS).bio).toBe(bio);
    }
  });
});
