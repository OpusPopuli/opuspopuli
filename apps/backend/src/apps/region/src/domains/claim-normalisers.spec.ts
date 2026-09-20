import type {
  BioClaim,
  MinutesSummaryClaim,
  PropositionAnalysisClaim,
} from '@opuspopuli/common';
import {
  normaliseAnalysisClaims,
  normaliseBioClaims,
  normaliseSummaryClaims,
} from './claim-normalisers';

describe('normaliseAnalysisClaims', () => {
  const base: PropositionAnalysisClaim = {
    claim: 'The measure raises the transfer tax.',
    field: 'fiscalImpact',
    sourceStart: 10,
    sourceEnd: 60,
  };

  it('carries offsets, field and confidence through', () => {
    const [out] = normaliseAnalysisClaims([{ ...base, confidence: 'high' }]);

    expect(out.text).toBe('The measure raises the transfer tax.');
    expect(out.subjectField).toBe('fiscalImpact');
    expect(out.confidence).toBe('high');
    expect(out.citation.spanStart).toBe(10);
    expect(out.citation.spanEnd).toBe(60);
  });

  it('carries the quote through when the claim has one', () => {
    const [out] = normaliseAnalysisClaims([
      { ...base, sourceQuote: 'raises the transfer tax' },
    ]);

    // Both are passed on: the verifier prefers the quote precisely because
    // model-asserted offsets measured ~2% accurate (#1212).
    expect(out.citation.quotedText).toBe('raises the transfer tax');
    expect(out.citation.spanStart).toBe(10);
  });

  it('rejects non-integer offsets rather than storing them', () => {
    const [out] = normaliseAnalysisClaims([
      { ...base, sourceStart: 1.5 as number, sourceEnd: NaN as number },
    ]);

    expect(out.citation.spanStart).toBeNull();
    expect(out.citation.spanEnd).toBeNull();
  });

  it('drops a claim with no assertion text', () => {
    expect(normaliseAnalysisClaims([{ ...base, claim: '   ' }])).toEqual([]);
  });
});

describe('normaliseSummaryClaims', () => {
  const base: MinutesSummaryClaim = {
    kind: 'decision',
    title: 'Voted 5-2 to advance AB 1234',
    detail: 'The committee advanced the bill after public comment.',
    citation: { quote: 'the motion carried 5-2', pageHint: 'p. 12' },
  };

  it('uses the title as the assertion and the quote as the citation', () => {
    const [out] = normaliseSummaryClaims([base]);

    expect(out.text).toBe('Voted 5-2 to advance AB 1234');
    expect(out.citation.quotedText).toBe('the motion carried 5-2');
    expect(out.citation.citationHint).toBe('p. 12');
    expect(out.subjectField).toBe('decision');
  });

  it('does not fold detail into the assertion', () => {
    const [out] = normaliseSummaryClaims([base]);

    // Detail is context the citation was never meant to support. Folding it in
    // would dilute the vocabulary overlap the gate scores with, so a good
    // citation would start reading as unsupported.
    expect(out.text).not.toContain('public comment');
  });

  it('survives a claim whose citation object is absent', () => {
    const withoutCitation = { ...base };
    delete (withoutCitation as Partial<MinutesSummaryClaim>).citation;
    const [out] = normaliseSummaryClaims([withoutCitation]);

    expect(out.citation.quotedText).toBeNull();
    expect(out.citation.citationHint).toBeNull();
  });
});

describe('normaliseBioClaims', () => {
  it('maps a source-origin claim to a citation hint', () => {
    const claim: BioClaim = {
      sentence: 'Chairs the budget committee.',
      origin: 'source',
      sourceField: 'committees[0].name',
      confidence: 'high',
    };
    const [out] = normaliseBioClaims([claim]);

    expect(out.citation.citationHint).toBe('committees[0].name');
    expect(out.subjectField).toBe('committees[0].name');
    expect(out.confidence).toBe('high');
  });

  it('leaves a training-origin claim with no citation at all', () => {
    const claim: BioClaim = {
      sentence: 'Widely regarded as a moderate.',
      origin: 'training',
      sourceHint: 'press coverage of the 2022 election',
    };
    const [out] = normaliseBioClaims([claim]);

    // `sourceHint` is the model describing what it believes it is recalling,
    // not a citation it offered. Carrying it into `citationHint` would flip
    // the verdict from `unsourced` to `unverified` and make an uncited
    // assertion read as a checked one that merely failed (#1208).
    expect(out.citation.citationHint).toBeNull();
    expect(out.citation.quotedText).toBeNull();
    expect(out.citation.spanStart).toBeNull();
  });

  it('never produces offsets — bios cite fields, not text', () => {
    const claims: BioClaim[] = [
      { sentence: 'A.', origin: 'source', sourceField: 'party' },
      { sentence: 'B.', origin: 'training', sourceHint: 'news' },
    ];

    for (const out of normaliseBioClaims(claims)) {
      expect(out.citation.spanStart).toBeNull();
      expect(out.citation.spanEnd).toBeNull();
    }
  });
});

describe('malformed JSONB', () => {
  // These take raw JSONB: a generator can emit `"claims": "none"` and the blob
  // stores it verbatim, and #1294's backfill reads columns written by years of
  // different prompts. The typed signature is an assertion, not a guarantee.
  const JUNK = [null, undefined, 'none', 42, { claim: 'not an array' }];

  it.each(JUNK)('returns nothing for %p rather than throwing', (junk) => {
    expect(normaliseAnalysisClaims(junk as never)).toEqual([]);
    expect(normaliseSummaryClaims(junk as never)).toEqual([]);
    expect(normaliseBioClaims(junk as never)).toEqual([]);
  });

  it('keeps the well-formed claims alongside a malformed one', () => {
    const out = normaliseBioClaims([
      {
        sentence: 'Represents District 5.',
        origin: 'source',
        sourceField: 'district',
      },
      null as never,
      { sentence: 'Chairs the budget committee.', origin: 'training' },
    ]);

    // A single bad element must not cost the subject its other claims — the
    // caller swallows errors, so a throw here would silently discard all of
    // them.
    expect(out.map((c) => c.text)).toEqual([
      'Represents District 5.',
      'Chairs the budget committee.',
    ]);
  });
});
