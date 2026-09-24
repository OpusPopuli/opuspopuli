import { Logger } from '@nestjs/common';
import { SyncAbortedError, propositionSyncTracker } from './sync-phase-logger';

/**
 * A run that is failing every item must stop.
 *
 * On 2026-09-22 a civics sync failed item 1 of 24 after 24.5 minutes and
 * carried on — roughly ten hours to produce nothing, with nothing noticing the
 * failure rate was 100%. Stopping it needed hand-edited Redis, because a
 * running job could not be cancelled.
 *
 * Guarded here rather than in each sync service because every family —
 * civics, propositions, bills, representatives, meetings — routes its item
 * outcomes through this tracker. One rule, one place.
 */
describe('sync phase tracker — runaway abort', () => {
  const silentLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;

  const track = (total: number) =>
    propositionSyncTracker(silentLogger, 'extract_and_upsert', total, {
      region: 'california',
    });

  const fail = (t: ReturnType<typeof track>, n: number) =>
    t.item({
      name: `item-${n}`,
      externalId: `x-${n}`,
      outcomeLabel: 'failed: no JSON object',
      outcome: 'error',
    });

  const succeed = (t: ReturnType<typeof track>, n: number) =>
    t.item({
      name: `item-${n}`,
      externalId: `x-${n}`,
      outcomeLabel: 'created',
      outcome: 'created',
    });

  beforeEach(() => jest.clearAllMocks());

  it('aborts once failures run back-to-back', () => {
    const t = track(24);

    for (let i = 1; i <= 4; i++) fail(t, i);
    // Four is not yet a verdict about the run.
    expect(() => fail(t, 5)).toThrow(SyncAbortedError);
  });

  it('names the count and the last failure, so the row says why', () => {
    const t = track(24);

    try {
      for (let i = 1; i <= 5; i++) fail(t, i);
      throw new Error('expected SyncAbortedError');
    } catch (error) {
      const aborted = error as SyncAbortedError;
      expect(aborted).toBeInstanceOf(SyncAbortedError);
      expect(aborted.consecutiveFailures).toBe(5);
      expect(aborted.itemsAttempted).toBe(5);
      expect(aborted.message).toContain('no JSON object');
    }
  });

  it('tolerates scattered failures in an otherwise healthy run', () => {
    const t = track(100);

    // A dead URL here, a malformed record there. Twelve failures overall —
    // far past the threshold cumulatively, never consecutively.
    expect(() => {
      for (let i = 1; i <= 12; i++) {
        fail(t, i);
        succeed(t, i);
      }
    }).not.toThrow();
  });

  it('resets the counter on real progress, not on a skip', () => {
    const t = track(24);

    for (let i = 1; i <= 4; i++) fail(t, i);
    succeed(t, 5);
    // Counter cleared: four more must not trip it.
    expect(() => {
      for (let i = 6; i <= 9; i++) fail(t, i);
    }).not.toThrow();
    expect(() => fail(t, 10)).toThrow(SyncAbortedError);
  });

  it('lets a skip clear the counter, because a skip is a handled item', () => {
    const t = track(24);

    for (let i = 1; i <= 4; i++) fail(t, i);
    t.item({
      name: 'item-5',
      externalId: 'x-5',
      outcomeLabel: 'skipped: already current',
      outcome: 'skipped',
    });

    // Counter cleared: a fifth failure after a skip must not abort.
    expect(() => fail(t, 6)).not.toThrow();
  });

  /**
   * The bills sync walks 5,019 rows and skips most of them as unchanged.
   * Treating a skip as neutral let five errors separated by hundreds of skips
   * accumulate into an abort — stopping a completely healthy 48-hour run.
   */
  it('survives a skip-heavy run with scattered failures', () => {
    const t = track(5019);

    expect(() => {
      for (let round = 0; round < 20; round++) {
        fail(t, round);
        for (let n = 0; n < 50; n++) {
          t.item({
            name: `bill-${round}-${n}`,
            externalId: null,
            outcomeLabel: 'skipped: unchanged',
            outcome: 'skipped',
          });
        }
      }
    }).not.toThrow();
  });

  it('counts an unidentifiable item as handled too', () => {
    const t = track(24);

    for (let i = 1; i <= 4; i++) fail(t, i);
    t.itemUnknown('no external id in URL');

    expect(() => fail(t, 6)).not.toThrow();
  });
});
