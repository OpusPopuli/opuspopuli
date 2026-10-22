import { Logger } from '@nestjs/common';
import type { MetricsObserver } from '@opuspopuli/common';

import {
  billSyncTracker,
  campaignFinanceSyncTracker,
  civicsSyncTracker,
  meetingSyncTracker,
  minutesSyncTracker,
  propositionSyncTracker,
  repSyncTracker,
} from './sync-phase-logger';

/**
 * M1: the tracker publishes the item outcomes it already counts.
 *
 * It is the one writer for `pipeline_items_total` inside a sync, for the same
 * reason the counts were centralised here in the first place — the log line
 * and the graph cannot then disagree.
 */
describe('SyncPhaseTracker metrics (M1)', () => {
  let logger: Logger;
  let counted: [
    string,
    number | undefined,
    Record<string, string> | undefined,
  ][];
  let observer: MetricsObserver;

  beforeEach(() => {
    logger = { log: jest.fn(), warn: jest.fn() } as unknown as Logger;
    counted = [];
    observer = {
      observe: jest.fn(),
      increment: (m, v, l) => counted.push([m, v, l]),
    };
  });

  const item = (outcome: 'created' | 'updated' | 'skipped' | 'error') => ({
    name: 'AB 1',
    externalId: '202520260AB1',
    outcomeLabel: `${outcome} (LLM)`,
    outcome,
  });

  it('counts each item against its data type and phase', () => {
    const tracker = billSyncTracker(
      logger,
      'extract_and_upsert',
      3,
      undefined,
      observer,
    );

    tracker.item(item('created'));
    tracker.item(item('updated'));

    expect(counted).toEqual([
      [
        'pipeline_items_total',
        1,
        { data_type: 'bills', phase: 'extract_and_upsert', outcome: 'created' },
      ],
      [
        'pipeline_items_total',
        1,
        { data_type: 'bills', phase: 'extract_and_upsert', outcome: 'updated' },
      ],
    ]);
  });

  it('publishes an error as `failed`, the shared vocabulary', () => {
    // The tracker's internal name for the outcome is `error`; withStage and
    // the dashboard both say `failed`. Two spellings would split every
    // failure-rate query in half.
    const tracker = billSyncTracker(
      logger,
      'summarize',
      1,
      undefined,
      observer,
    );

    tracker.item(item('error'));

    expect(counted[0][2]).toEqual({
      data_type: 'bills',
      phase: 'summarize',
      outcome: 'failed',
    });
  });

  it('gives an unidentified item a BOUNDED reason, not the log text', () => {
    // The reason in the log line is prose written per call site. Prose as a
    // label is unbounded cardinality, which is how Prometheus gets
    // OOM-killed and stops delivering alerts (#1343, #1344).
    const tracker = billSyncTracker(logger, 'discover', 1, undefined, observer);

    tracker.itemUnknown('could not extract bill ID from https://example.gov/x');

    expect(counted).toEqual([
      [
        'pipeline_items_total',
        1,
        {
          data_type: 'bills',
          phase: 'discover',
          outcome: 'skipped',
          reason: 'unidentified',
        },
      ],
    ]);
  });

  it('labels all seven data types, not just the ones someone remembered', () => {
    // This test previously exercised three of the seven and still claimed
    // "every tag". Deleting the MeetingSync, MinutesSync and PropositionSync
    // entries from the old lookup table left all 44 tests green while
    // production would have emitted `data_type="meetingsync"` — a label no
    // dashboard variable matches, which renders as an empty panel rather than
    // an error. Enumerate every factory, so adding an eighth and forgetting
    // it is a failure here.
    const factories = [
      ['bills', billSyncTracker],
      ['representatives', repSyncTracker],
      ['meetings', meetingSyncTracker],
      ['minutes', minutesSyncTracker],
      ['propositions', propositionSyncTracker],
      ['civics', civicsSyncTracker],
      ['campaign_finance', campaignFinanceSyncTracker],
    ] as const;

    for (const [, factory] of factories) {
      // `discover` is the one phase every data type declares.
      const tracker = (
        factory as (
          l: Logger,
          p: 'discover',
          t: number,
          a: undefined,
          o: MetricsObserver,
        ) => { item: (x: ReturnType<typeof item>) => void }
      )(logger, 'discover', 1, undefined, observer);
      tracker.item(item('created'));
    }

    expect(counted.map((c) => c[2]?.data_type)).toEqual(
      factories.map(([dataType]) => dataType),
    );
  });

  it('counts an abort separately, and before the throw', () => {
    // An abort is the one outcome that leaves no trace in the item counts:
    // everything after it was never attempted. If this is not published
    // before the throw, nothing records that the phase stopped.
    const tracker = billSyncTracker(
      logger,
      'extract_and_upsert',
      5000,
      undefined,
      observer,
    );

    expect(() => {
      for (let i = 0; i < 100; i++) tracker.item(item('error'));
    }).toThrow(/abort/i);

    const aborts = counted.filter(
      (c) => c[0] === 'pipeline_phase_aborted_total',
    );
    expect(aborts).toEqual([
      [
        'pipeline_phase_aborted_total',
        1,
        { data_type: 'bills', phase: 'extract_and_upsert' },
      ],
    ]);
  });

  it('logs identically whether or not an observer is bound', () => {
    // Measurement is additive, never a condition of the sync running. The
    // earlier version of this test asserted only `toHaveBeenCalled()`, which
    // the CONSTRUCTOR's phase-start line satisfies on its own — deleting the
    // per-item log line entirely would have kept it green. Compare the two
    // runs line for line instead.
    const linesFor = (obs?: MetricsObserver): unknown[] => {
      const log = jest.fn();
      const scoped = { log, warn: jest.fn() } as unknown as Logger;
      const tracker = billSyncTracker(scoped, 'discover', 2, undefined, obs);
      tracker.item(item('created'));
      tracker.itemUnknown('nope');
      tracker.complete();
      // The phase-complete line ends with its own elapsed time
      // (`... in 0ms`), so comparing two runs verbatim compares two clocks —
      // they agree only when both happen to round the same way. Normalise it
      // out: the claim under test is that the LINES are identical, not that
      // two runs took equally long.
      return log.mock.calls
        .flat()
        .map((line) => String(line).replace(/ in \S+$/, ' in <elapsed>'));
    };

    const unmeasured = linesFor(undefined);
    const measured = linesFor(observer);

    expect(unmeasured).toHaveLength(4); // phase-start, item, unknown, complete
    expect(unmeasured[3]).toContain('in <elapsed>'); // normaliser still bites
    expect(measured).toEqual(unmeasured);
  });

  it('never lets a throwing observer break a sync', () => {
    // The MetricsObserver contract says measurement must not take down the
    // thing it measures, but a contract in a doc comment is not enforcement.
    // Unguarded, this would replace SyncAbortedError with a metrics error at
    // the abort site, and kill a healthy sync mid-item from count().
    const hostile: MetricsObserver = {
      observe: () => {
        throw new Error('observe exploded');
      },
      increment: () => {
        throw new Error('increment exploded');
      },
    };
    const tracker = billSyncTracker(logger, 'discover', 1, undefined, hostile);

    expect(() => {
      tracker.item(item('created'));
      tracker.itemUnknown('nope');
      tracker.complete();
    }).not.toThrow();
  });

  it('still aborts when the observer throws on the abort counter', () => {
    // The failure the guard must NOT swallow: the sync has to stop.
    const hostile: MetricsObserver = {
      observe: jest.fn(),
      increment: () => {
        throw new Error('increment exploded');
      },
    };
    const tracker = billSyncTracker(
      logger,
      'extract_and_upsert',
      5000,
      undefined,
      hostile,
    );

    expect(() => {
      for (let i = 0; i < 100; i++) tracker.item(item('error'));
    }).toThrow(/abort/i);
  });

  it('clamps a prose reason and keeps a slug', () => {
    // Call sites write prose for the operator; a label gets a slug or a
    // placeholder. One series per distinct sentence is the #1344 failure.
    const tracker = billSyncTracker(
      logger,
      'summarize',
      2,
      undefined,
      observer,
    );

    tracker.item({ ...item('skipped'), reason: 'hash_unchanged' });
    tracker.item({
      ...item('skipped'),
      reason: 'skipped (empty over existing — row kept, now stale)',
    });

    expect(counted.map((c) => c[2]?.reason)).toEqual([
      'hash_unchanged',
      'unlabelled',
    ]);
  });

  it('agrees with its own summary line', () => {
    // The property that justifies putting the counter here: the number on
    // the graph and the number in the log come from one accounting.
    const tracker = billSyncTracker(
      logger,
      'extract_and_upsert',
      4,
      undefined,
      observer,
    );

    tracker.item(item('created'));
    tracker.item(item('updated'));
    tracker.item(item('skipped'));
    tracker.itemUnknown('no id');

    const summary = tracker.complete();
    const byOutcome = counted.reduce<Record<string, number>>(
      (acc, [, , labels]) => {
        const key = labels?.outcome ?? '?';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {},
    );

    expect(byOutcome).toEqual({ created: 1, updated: 1, skipped: 2 });
    expect(summary.created).toBe(1);
    expect(summary.updated).toBe(1);
    expect(summary.skipped).toBe(2);
  });

  describe('rowsDeleted (F2)', () => {
    it('counts deleted rows against the data type', () => {
      billSyncTracker(
        logger,
        'prune_stale',
        2,
        undefined,
        observer,
      ).rowsDeleted(2);

      expect(counted).toContainEqual([
        'pipeline_rows_deleted_total',
        2,
        { data_type: 'bills' },
      ]);
    });

    it('emits nothing for zero', () => {
      billSyncTracker(
        logger,
        'prune_stale',
        0,
        undefined,
        observer,
      ).rowsDeleted(0);

      expect(
        counted.filter((c) => c[0] === 'pipeline_rows_deleted_total'),
      ).toEqual([]);
    });

    it('swallows an observer that throws', () => {
      const throwing: MetricsObserver = {
        observe: jest.fn(),
        increment: () => {
          throw new Error('registry gone');
        },
      };
      const tracker = billSyncTracker(
        logger,
        'prune_stale',
        1,
        undefined,
        throwing,
      );

      expect(() => tracker.rowsDeleted(3)).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
