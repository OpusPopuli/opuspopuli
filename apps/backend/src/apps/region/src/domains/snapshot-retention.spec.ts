import {
  MONTHLY_RETENTION_MONTHS,
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

  it('breaks ties deterministically regardless of input order', () => {
    const same = '2026-09-19T00:00:00Z';
    const items = [snapshot('aaa', same), snapshot('zzz', same)];

    // findMany guarantees no ordering, so a tie resolved by arrival order
    // would keep a different snapshot on each sweep — nondeterminism in a
    // destructive operation.
    const forward = selectRetainedSnapshots(items);
    const reversed = selectRetainedSnapshots([...items].reverse());

    expect([...forward]).toEqual([...reversed]);
    expect(forward.has('zzz')).toBe(true);
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

/**
 * The YEARLY tier (tiered retention).
 *
 * Every pre-existing test in this file uses recent dates, so the monthly tier
 * claims them all and they passed unchanged when tiering was introduced —
 * which is exactly why these exist. A destructive rule needs tests that
 * exercise the branch that deletes more, not only the branch that keeps.
 *
 * `now` is injected throughout. Relying on the real clock would make these
 * pass for a year and then start pruning fixtures as they aged past the
 * window — a test that rots into a false negative.
 */
describe('selectRetainedSnapshots — yearly tier', () => {
  const NOW = new Date('2026-10-15T00:00:00Z');

  it('keeps only ONE snapshot for a year beyond the monthly window', () => {
    const keep = selectRetainedSnapshots(
      [
        snapshot('2024-mar', '2024-03-10T00:00:00Z'),
        snapshot('2024-jun', '2024-06-10T00:00:00Z'),
        snapshot('2024-dec', '2024-12-20T00:00:00Z'),
        snapshot('current', '2026-10-14T00:00:00Z'),
      ],
      NOW,
    );

    // All of 2024 is older than 12 months, so it collapses to its newest.
    expect(keep.has('2024-dec')).toBe(true);
    expect(keep.has('2024-mar')).toBe(false);
    expect(keep.has('2024-jun')).toBe(false);
    expect(keep.has('current')).toBe(true);
  });

  it('keeps the newest IN the year, not December specifically', () => {
    // The reason for newest-per-year over a fixed month: a node down over a
    // year-end keeps nothing for that year under a December rule. FileVault
    // blocking boot before login has already caused exactly that outage here.
    const keep = selectRetainedSnapshots(
      [
        snapshot('2023-feb', '2023-02-01T00:00:00Z'),
        snapshot('2023-sep', '2023-09-30T00:00:00Z'),
        snapshot('current', '2026-10-14T00:00:00Z'),
      ],
      NOW,
    );

    expect(keep.has('2023-sep')).toBe(true);
    expect(keep.has('2023-feb')).toBe(false);
  });

  it('still keeps one per MONTH inside the window', () => {
    const keep = selectRetainedSnapshots(
      [
        snapshot('aug', '2026-08-04T00:00:00Z'),
        snapshot('sep', '2026-09-04T00:00:00Z'),
        snapshot('oct', '2026-10-04T00:00:00Z'),
      ],
      NOW,
    );

    expect([...keep].sort()).toEqual(['aug', 'oct', 'sep']);
  });

  it('does not let the yearly tier swallow a month inside the window', () => {
    // A snapshot must be claimed by exactly one tier. If the yearly index also
    // saw in-window snapshots, two months of the same year would collapse to
    // one and a month's only payload would be pruned.
    const keep = selectRetainedSnapshots(
      [
        snapshot('2026-aug', '2026-08-04T00:00:00Z'),
        snapshot('2026-sep', '2026-09-04T00:00:00Z'),
      ],
      NOW,
    );

    expect(keep.size).toBe(2);
  });

  it('keeps the newest overall even when it is older than the window', () => {
    // A source that stopped updating must not lose its last payload just
    // because every snapshot it has is beyond 12 months. Both fixtures are in
    // the SAME year, so only the yearly slot is in play and this isolates the
    // newest-per-source guarantee.
    const keep = selectRetainedSnapshots(
      [
        snapshot('early-2022', '2022-01-01T00:00:00Z'),
        snapshot('last-2022', '2022-05-01T00:00:00Z'),
      ],
      NOW,
    );

    expect(keep.has('last-2022')).toBe(true);
    expect(keep.has('early-2022')).toBe(false);
  });

  it('keeps one per year across SEVERAL dormant years', () => {
    // Distinct years each earn a slot — this is the growth the sizing
    // estimate assumes (~1.5 GB per year after the first), and the reason
    // the schedule is bounded in practice rather than flat.
    const keep = selectRetainedSnapshots(
      [
        snapshot('2021', '2021-06-01T00:00:00Z'),
        snapshot('2022', '2022-06-01T00:00:00Z'),
        snapshot('2023', '2023-06-01T00:00:00Z'),
        snapshot('current', '2026-10-14T00:00:00Z'),
      ],
      NOW,
    );

    expect([...keep].sort()).toEqual(['2021', '2022', '2023', 'current']);
  });

  it('tiers each source independently', () => {
    const other = 'https://example.gov/other.zip';
    const keep = selectRetainedSnapshots(
      [
        snapshot('a-2024', '2024-04-01T00:00:00Z'),
        snapshot('a-now', '2026-10-01T00:00:00Z'),
        snapshot('b-2024-mar', '2024-03-01T00:00:00Z', other),
        snapshot('b-2024-nov', '2024-11-01T00:00:00Z', other),
      ],
      NOW,
    );

    expect(keep.has('a-2024')).toBe(true); // only 2024 snapshot for source a
    expect(keep.has('a-now')).toBe(true);
    expect(keep.has('b-2024-nov')).toBe(true); // newest 2024 for source b
    expect(keep.has('b-2024-mar')).toBe(false);
  });

  it('uses calendar months for the cutoff, not a 30-day approximation', () => {
    // Exactly MONTHLY_RETENTION_MONTHS back is still inside the window. A
    // fixed day count drifts against month lengths and would drop a month's
    // only snapshot a day early.
    const cutoff = new Date(NOW);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - MONTHLY_RETENTION_MONTHS);

    const keep = selectRetainedSnapshots(
      [
        snapshot('at-cutoff', cutoff.toISOString()),
        snapshot('older-same-year', '2025-10-01T00:00:00Z'),
        snapshot('current', '2026-10-14T00:00:00Z'),
      ],
      NOW,
    );

    // `at-cutoff` sits in the monthly tier, so the older one in that same
    // calendar year takes the yearly slot rather than being merged with it.
    expect(keep.has('at-cutoff')).toBe(true);
    expect(keep.has('current')).toBe(true);
  });

  it('never prunes everything for a source, however old', () => {
    const snaps = [snapshot('only', '2019-01-01T00:00:00Z')];
    const keep = selectRetainedSnapshots(snaps, NOW);

    expect(() => assertRetainsSomething(snaps, keep)).not.toThrow();
    expect(keep.has('only')).toBe(true);
  });
});
