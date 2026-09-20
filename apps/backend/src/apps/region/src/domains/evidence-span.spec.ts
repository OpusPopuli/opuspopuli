import {
  CONTEXT_HALF_CHARS,
  MAX_SPAN_CHARS,
  resolveEvidenceSpan,
} from './evidence-span';

describe('resolveEvidenceSpan', () => {
  const TEXT =
    'The measure would raise the transfer tax on properties over $5 million.';
  const HASH = 'a'.repeat(64);

  const span = (start: number, end: number, hash: string | null = HASH) => ({
    sourceTextHash: hash,
    spanStart: start,
    spanEnd: end,
  });

  it('slices the passage out of the live text', () => {
    const result = resolveEvidenceSpan(TEXT, HASH, span(18, 41));

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    // Derived from the text as it is now, not read from a stored copy — a
    // denormalised quote cannot tell you it has gone out of date.
    expect(result.text).toBe(TEXT.slice(18, 41));
  });

  it('reports staleness instead of slicing changed text', () => {
    const result = resolveEvidenceSpan(TEXT, 'b'.repeat(64), span(18, 41));

    // The whole reason sourceTextHash exists (#1279). A claim measured against
    // different text has no valid span into this one, whatever the offsets
    // happen to address.
    expect(result.status).toBe('stale');
    if (result.status !== 'stale') return;
    expect(result.expectedHash).toBe(HASH);
    expect(result.actualHash).toBe('b'.repeat(64));
  });

  it('checks the hash before the span, not after', () => {
    // Offsets that would be valid against this text, but the text is not the
    // one the claim cited. Resolving first and comparing afterwards would
    // still produce a passage the claim never saw — and the tempting thing to
    // do with a passage is show it.
    const result = resolveEvidenceSpan(TEXT, 'c'.repeat(64), span(0, 10));

    expect(result.status).toBe('stale');
  });

  it('refuses a span that does not fit the text', () => {
    const result = resolveEvidenceSpan(TEXT, HASH, span(0, TEXT.length + 50));

    expect(result.status).toBe('out-of-range');
    if (result.status !== 'out-of-range') return;
    expect(result.length).toBe(TEXT.length);
  });

  it('refuses an inverted or empty span', () => {
    expect(resolveEvidenceSpan(TEXT, HASH, span(30, 30)).status).toBe(
      'out-of-range',
    );
    expect(resolveEvidenceSpan(TEXT, HASH, span(40, 10)).status).toBe(
      'out-of-range',
    );
  });

  it('refuses a negative start', () => {
    expect(resolveEvidenceSpan(TEXT, HASH, span(-5, 10)).status).toBe(
      'out-of-range',
    );
  });

  it('reports no-span for evidence that carries none', () => {
    const result = resolveEvidenceSpan(TEXT, HASH, {
      sourceTextHash: HASH,
      spanStart: null,
      spanEnd: null,
    });

    // A citation hint, or a claim that never had a citation. Distinct from a
    // span that failed to resolve.
    expect(result.status).toBe('no-span');
  });

  it('reports no-span when the source text is gone', () => {
    const result = resolveEvidenceSpan(null, HASH, span(0, 10));

    expect(result.status).toBe('no-span');
  });

  it('resolves when no hash was recorded', () => {
    // Legacy claims predate the staleness key. Their spans are still
    // resolvable — they simply cannot be shown to be current, which is what
    // the verifier (#1292) is for.
    const result = resolveEvidenceSpan(TEXT, HASH, span(0, 10, null));

    expect(result.status).toBe('resolved');
  });

  it('caps a long span rather than republishing the document', () => {
    const long = 'x'.repeat(5000);
    const result = resolveEvidenceSpan(long, HASH, span(0, 5000));

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    // A citation shows the sentence a claim rests on. Unbounded, a bad offset
    // becomes a page-sized quote that reads as authoritative.
    expect(result.text).toHaveLength(MAX_SPAN_CHARS);
    expect(result.end).toBe(MAX_SPAN_CHARS);
  });

  it('returns surrounding context so the passage reads in situ', () => {
    const long = `${'word '.repeat(300)}TARGET${' word'.repeat(300)}`;
    const start = long.indexOf('TARGET');
    const result = resolveEvidenceSpan(long, HASH, span(start, start + 6));

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.context).toContain('TARGET');
    expect(result.context.length).toBeGreaterThan(result.text.length);
    expect(result.context.length).toBeLessThanOrEqual(
      result.text.length + CONTEXT_HALF_CHARS * 2,
    );
  });

  it('snaps context to whitespace rather than mid-word', () => {
    const long = `${'alpha '.repeat(200)}TARGET${' beta'.repeat(200)}`;
    const start = long.indexOf('TARGET');
    const result = resolveEvidenceSpan(long, HASH, span(start, start + 6));

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    // Context that begins mid-word reads as corrupted data rather than as a
    // quotation. Matches how LegislativeAction passages already snap.
    expect(result.context.startsWith('alpha')).toBe(true);
  });
});
