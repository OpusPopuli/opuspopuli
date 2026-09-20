import { createHash } from 'node:crypto';
import { MIN_SUPPORT } from '@opuspopuli/common';
import { verifyEvidence, type VerifiableEvidence } from './evidence-verifier';

const SOURCE =
  'The measure would raise the documentary transfer tax on residential ' +
  'properties valued over five million dollars, and directs the revenue to ' +
  'affordable housing construction.';

const sha256 = (v: string) =>
  createHash('sha256').update(v, 'utf8').digest('hex');
const HASH = sha256(SOURCE);

function evidence(over: Partial<VerifiableEvidence> = {}): VerifiableEvidence {
  return {
    sourceTextHash: HASH,
    spanStart: null,
    spanEnd: null,
    quotedText: null,
    citationHint: null,
    ...over,
  };
}

describe('verifyEvidence', () => {
  describe('offset citations — the legacy shape', () => {
    it('verifies a span that shares the claim vocabulary', () => {
      const claim = 'The measure raises the documentary transfer tax.';
      const start = SOURCE.indexOf('raise');
      const out = verifyEvidence(
        claim,
        evidence({ spanStart: start, spanEnd: start + 60 }),
        SOURCE,
        HASH,
      );

      expect(out.state).toBe('verified');
      expect(out.support).toBeGreaterThanOrEqual(MIN_SUPPORT);
    });

    it('refuses a span that is in range but about something else', () => {
      const claim = 'The measure raises the documentary transfer tax.';
      const start = SOURCE.indexOf('affordable');
      const out = verifyEvidence(
        claim,
        evidence({ spanStart: start, spanEnd: SOURCE.length }),
        SOURCE,
        HASH,
      );

      // The failure this gate exists for. The write path clamps offsets into
      // range, so "in range" is guaranteed by construction and proves nothing.
      expect(out.state).toBe('unverified');
      expect(out.reason).toBe('unsupported');
    });

    it('refuses a span that does not fit the text', () => {
      const out = verifyEvidence(
        'Anything.',
        evidence({ spanStart: 0, spanEnd: SOURCE.length + 500 }),
        SOURCE,
        HASH,
      );

      expect(out.state).toBe('unverified');
      expect(out.reason).toBe('out-of-range');
    });

    it('refuses to verify against text that changed after the claim', () => {
      const amended = SOURCE.replace('five million', 'three million');
      const out = verifyEvidence(
        'The measure raises the documentary transfer tax.',
        evidence({ spanStart: 0, spanEnd: 60 }),
        amended,
        sha256(amended),
      );

      // Nothing can be verified against text the claim never saw, however well
      // the offsets happen to line up (#1279, #1291).
      expect(out.state).toBe('unverified');
      expect(out.reason).toBe('stale-source');
    });

    it('never snaps an offset-only citation', () => {
      const claim = 'The measure raises the documentary transfer tax.';
      const start = SOURCE.indexOf('raise');
      const out = verifyEvidence(
        claim,
        evidence({ spanStart: start, spanEnd: start + 60 }),
        SOURCE,
        HASH,
      );

      // With offsets alone there is nothing to snap TO — no quote to relocate.
      expect(out.state).not.toBe('snapped');
      expect(out.correctedSpan).toBeUndefined();
    });
  });

  describe('quoted citations — the #1212 shape', () => {
    const claim = 'The measure raises the documentary transfer tax.';
    const QUOTE = 'raise the documentary transfer tax';

    it('verifies a quote that is where it says it is', () => {
      const start = SOURCE.indexOf(QUOTE);
      const out = verifyEvidence(
        claim,
        evidence({
          quotedText: QUOTE,
          spanStart: start,
          spanEnd: start + QUOTE.length,
        }),
        SOURCE,
        HASH,
      );

      expect(out.state).toBe('verified');
    });

    it('snaps a quote found somewhere other than the stored span', () => {
      const out = verifyEvidence(
        claim,
        evidence({ quotedText: QUOTE, spanStart: 0, spanEnd: 10 }),
        SOURCE,
        HASH,
      );

      // Recorded as a correction rather than merged into `verified`: silently
      // rewriting the span would make the model look more accurate than it was.
      expect(out.state).toBe('snapped');
      expect(out.reason).toBe('quote-relocated');
      expect(out.correctedSpan).toEqual({
        start: SOURCE.indexOf(QUOTE),
        end: SOURCE.indexOf(QUOTE) + QUOTE.length,
      });
    });

    it('verifies a quote that carried no span, deriving the offsets', () => {
      const out = verifyEvidence(
        claim,
        evidence({ quotedText: QUOTE, spanStart: null, spanEnd: null }),
        SOURCE,
        HASH,
      );

      // `minutes.summary_claims` quotes verbatim and stores no offsets. A
      // citation that never pointed anywhere was not *moved*, so calling this
      // `snapped` would file the best-cited family in the platform as
      // corrections — understating verification for exactly the claims that
      // cite properly (#1293). Deriving offsets from a quote IS the #1212
      // contract.
      expect(out.state).toBe('verified');
      expect(out.reason).toBe('supported');
      expect(out.correctedSpan).toEqual({
        start: SOURCE.indexOf(QUOTE),
        end: SOURCE.indexOf(QUOTE) + QUOTE.length,
      });
    });

    it('refuses a quote that is not in the source at all', () => {
      const out = verifyEvidence(
        claim,
        evidence({ quotedText: 'repeals the estate tax entirely' }),
        SOURCE,
        HASH,
      );

      // Text that reads as a citation and is not one.
      expect(out.state).toBe('unverified');
      expect(out.reason).toBe('quote-not-found');
    });

    it('scores support on the quote, not the span containing it', () => {
      // A quote that is genuinely in the source but has nothing to do with the
      // claim. Scoring the surrounding span could rescue it; scoring the quote
      // does not.
      const out = verifyEvidence(
        'The measure abolishes the vehicle licence fee.',
        evidence({ quotedText: 'affordable housing construction' }),
        SOURCE,
        HASH,
      );

      expect(out.state).toBe('unverified');
      expect(out.reason).toBe('unsupported');
    });
  });

  describe('claims with no machine-checkable citation', () => {
    it('reports a claim that never had a citation as unsourced', () => {
      const out = verifyEvidence('Served two terms.', evidence(), SOURCE, HASH);

      // bio_claims' origin:'training'. Not a failed check — a claim that never
      // offered a source, and #1208 requires the difference to survive.
      expect(out.state).toBe('unsourced');
      expect(out.reason).toBe('no-citation');
    });

    it('reports a free-text citation hint as unverified, not unsourced', () => {
      const out = verifyEvidence(
        'The board approved the contract.',
        evidence({ citationHint: 'see page 4' }),
        SOURCE,
        HASH,
      );

      // A citation was offered and cannot be checked. That is different from
      // never having offered one.
      expect(out.state).toBe('unverified');
    });
  });

  it('always reports the support score, including on failure', () => {
    const start = SOURCE.indexOf('affordable');
    const out = verifyEvidence(
      'The measure raises the documentary transfer tax.',
      evidence({ spanStart: start, spanEnd: SOURCE.length }),
      SOURCE,
      HASH,
    );

    // The number is what makes the gate's behaviour auditable rather than
    // taken on trust — and what keeps the harness's measured rate reproducible
    // from stored rows.
    expect(typeof out.support).toBe('number');
    expect(out.support).toBeLessThan(MIN_SUPPORT);
  });
});
