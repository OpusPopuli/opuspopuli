import {
  assertRetainsSomething,
  selectRetainedSnapshots,
  type RetainableSnapshot,
} from './snapshot-retention';

function snapshot(
  id: string,
  fetchedAt: string,
  sourceUrl = 'https://netfile.com/export.zip',
): RetainableSnapshot {
  return { id, sourceUrl, fetchedAt: new Date(fetchedAt) };
}

describe('selectRetainedSnapshots', () => {
  it('keeps the newest snapshot', () => {
    const keep = selectRetainedSnapshots([
      snapshot('old', '2026-09-01T00:00:00Z'),
      snapshot('newest', '2026-09-19T00:00:00Z'),
      snapshot('middle', '2026-09-10T00:00:00Z'),
    ]);

    expect(keep.has('newest')).toBe(true);
  });

  it('keeps one snapshot per calendar month', () => {
    const keep = selectRetainedSnapshots([
      snapshot('jul-early', '2026-07-02T00:00:00Z'),
      snapshot('jul-late', '2026-07-28T00:00:00Z'),
      snapshot('aug', '2026-08-15T00:00:00Z'),
      snapshot('sep', '2026-09-19T00:00:00Z'),
    ]);

    // Newest within each month wins, so July keeps the 28th, not the 2nd.
    expect([...keep].sort()).toEqual(['aug', 'jul-late', 'sep']);
  });

  it('prunes the rest of a busy month', () => {
    const weekly = [
      snapshot('w1', '2026-09-01T00:00:00Z'),
      snapshot('w2', '2026-09-08T00:00:00Z'),
      snapshot('w3', '2026-09-15T00:00:00Z'),
      snapshot('w4', '2026-09-22T00:00:00Z'),
    ];

    const keep = selectRetainedSnapshots(weekly);

    // The growth driver this tier exists to bound: weekly immutability would
    // be ~50 GB/yr, and one month of it collapses to a single payload.
    expect(keep.size).toBe(1);
    expect(keep.has('w4')).toBe(true);
  });

  it('keeps per source, not globally', () => {
    const keep = selectRetainedSnapshots([
      snapshot('a-new', '2026-09-19T00:00:00Z', 'https://a.example/x.zip'),
      snapshot('b-old', '2026-07-01T00:00:00Z', 'https://b.example/y.zip'),
    ]);

    // A source that stopped publishing must not lose its last snapshot just
    // because another source has a newer one.
    expect(keep.has('a-new')).toBe(true);
    expect(keep.has('b-old')).toBe(true);
  });

  it('buckets months in UTC', () => {
    // 2026-08-31T23:00 UTC is September in a +02:00 local zone. Bucketing
    // locally would move it into September and could drop August's only
    // snapshot.
    const keep = selectRetainedSnapshots([
      snapshot('aug-edge', '2026-08-31T23:00:00Z'),
      snapshot('sep', '2026-09-19T00:00:00Z'),
    ]);

    expect(keep.has('aug-edge')).toBe(true);
  });

  it('is order-independent', () => {
    const items = [
      snapshot('a', '2026-09-01T00:00:00Z'),
      snapshot('b', '2026-09-19T00:00:00Z'),
      snapshot('c', '2026-08-04T00:00:00Z'),
    ];

    const forward = selectRetainedSnapshots(items);
    const reversed = selectRetainedSnapshots([...items].reverse());

    expect([...forward].sort()).toEqual([...reversed].sort());
  });

  it('returns nothing for no input', () => {
    expect(selectRetainedSnapshots([]).size).toBe(0);
  });

  it('keeps a lone snapshot', () => {
    const keep = selectRetainedSnapshots([
      snapshot('only', '2026-09-19T00:00:00Z'),
    ]);

    expect(keep.has('only')).toBe(true);
  });
});

describe('assertRetainsSomething', () => {
  it('accepts a selection that keeps every source', () => {
    const items = [
      snapshot('a', '2026-09-19T00:00:00Z', 'https://a.example/x.zip'),
      snapshot('b', '2026-09-19T00:00:00Z', 'https://b.example/y.zip'),
    ];

    expect(() =>
      assertRetainsSomething(items, selectRetainedSnapshots(items)),
    ).not.toThrow();
  });

  it('refuses a selection that would prune a source entirely', () => {
    const items = [snapshot('a', '2026-09-19T00:00:00Z')];

    // The backstop for a bug in the rules. "Delete every payload" is never a
    // correct outcome, so the sweep refuses rather than proceeding.
    expect(() => assertRetainsSomething(items, new Set())).toThrow(
      /Refusing to sweep/,
    );
  });

  it('names the sources it would have emptied', () => {
    const items = [
      snapshot('a', '2026-09-19T00:00:00Z', 'https://a.example/x.zip'),
      snapshot('b', '2026-09-19T00:00:00Z', 'https://b.example/y.zip'),
    ];

    expect(() => assertRetainsSomething(items, new Set(['a']))).toThrow(
      /b\.example/,
    );
  });

  it('accepts an empty sweep', () => {
    expect(() => assertRetainsSomething([], new Set())).not.toThrow();
  });
});
