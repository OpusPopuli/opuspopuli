/**
 * Integration test for the unevidenced-assertion gauge (#1296).
 *
 * The number this publishes is the epic's target property — "show every
 * published assertion that lacks primary evidence" — so what matters is not
 * that a gauge was written to, but that the value equals what the database
 * actually holds. One of the three queries spans claims → claim_evidence →
 * evidence in raw SQL, which a mocked DbService cannot exercise at all.
 *
 * Real database, per the integration-test convention.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import {
  normaliseAnalysisClaims,
  normaliseBioClaims,
  normaliseSummaryClaims,
} from '../../../src/apps/region/src/domains/claim-normalisers';
import { recordClaims } from '../../../src/apps/region/src/domains/claim-recorder';
import { ClaimEvidenceMetricsService } from '../../../src/apps/region/src/domains/claim-evidence-metrics.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const PROP_TEXT =
  'The measure would raise the documentary transfer tax on residential ' +
  'properties valued over five million dollars, and directs the revenue to ' +
  'affordable housing construction.';
const MINUTES_TEXT =
  'The committee convened at nine. After public comment the motion carried ' +
  '5-2 to advance AB 1234 to the floor, and the chair adjourned the session.';

const sha256 = (v: string) =>
  createHash('sha256').update(v, 'utf8').digest('hex');

describe('claim evidence metrics (#1296)', () => {
  let db: DbService;
  let total: { set: jest.Mock };
  let unevidenced: { set: jest.Mock };
  let byState: { set: jest.Mock };
  let freshness: { set: jest.Mock };
  let service: ClaimEvidenceMetricsService;

  function valueOf(
    gauge: { set: jest.Mock },
    labels: Record<string, string>,
  ): number | undefined {
    const call = gauge.set.mock.calls.find(([l]) =>
      Object.entries(labels).every(([k, v]) => l[k] === v),
    );
    return call?.[1];
  }

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
    total = { set: jest.fn() };
    unevidenced = { set: jest.fn() };
    byState = { set: jest.fn() };
    freshness = { set: jest.fn() };
    service = new ClaimEvidenceMetricsService(
      db,
      total as never,
      unevidenced as never,
      byState as never,
      freshness as never,
    );
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  /** One supported proposition claim, one unsupported, one quoted minutes claim, one recalled bio claim. */
  async function seed() {
    await recordClaims(db, {
      subjectType: 'proposition',
      subjectId: 'prop-m',
      claims: normaliseAnalysisClaims([
        {
          claim: 'The measure raises the documentary transfer tax.',
          field: 'fiscalImpact',
          sourceStart: PROP_TEXT.indexOf('raise'),
          sourceEnd: PROP_TEXT.indexOf('raise') + 60,
        },
        {
          claim: 'The measure abolishes the vehicle licence fee.',
          field: 'keyProvisions',
          sourceStart: PROP_TEXT.indexOf('affordable'),
          sourceEnd: PROP_TEXT.length,
        },
      ]),
      sourceText: PROP_TEXT,
      sourceTextHash: sha256(PROP_TEXT),
    });

    await recordClaims(db, {
      subjectType: 'minutes',
      subjectId: 'min-m',
      claims: normaliseSummaryClaims([
        {
          kind: 'decision',
          title: 'The motion carried 5-2 to advance AB 1234',
          detail: 'x',
          citation: { quote: 'the motion carried 5-2 to advance AB 1234' },
        },
      ]),
      sourceText: MINUTES_TEXT,
      sourceTextHash: sha256(MINUTES_TEXT),
    });

    await recordClaims(db, {
      subjectType: 'representative',
      subjectId: 'rep-m',
      claims: normaliseBioClaims([
        { sentence: 'Widely regarded as a moderate.', origin: 'training' },
      ]),
      sourceText: null,
      sourceTextHash: null,
    });
  }

  it('counts claims lacking verified evidence, per family', async () => {
    await seed();
    await service.measure();

    expect(valueOf(total, { subject_type: 'proposition' })).toBe(2);
    expect(valueOf(total, { subject_type: 'minutes' })).toBe(1);
    expect(valueOf(total, { subject_type: 'representative' })).toBe(1);

    // One of the two proposition claims verifies; the minutes quote verifies;
    // the recalled bio claim never offered a citation.
    expect(valueOf(unevidenced, { subject_type: 'proposition' })).toBe(1);
    expect(valueOf(unevidenced, { subject_type: 'minutes' })).toBe(0);
    expect(valueOf(unevidenced, { subject_type: 'representative' })).toBe(1);
  });

  it('keeps the families apart rather than aggregating', async () => {
    await seed();
    await service.measure();

    // Bio claims cite structured fields, so that family is unevidenced by
    // construction. Aggregated, it would swamp the families where the number
    // reflects a real check that failed — and the metric would stop meaning
    // anything. Every write carries a subject_type label.
    for (const [labels] of unevidenced.set.mock.calls) {
      expect(labels).toHaveProperty('subject_type');
    }
  });

  it('publishes the full verdict distribution across the join', async () => {
    await seed();
    await service.measure();

    expect(
      valueOf(byState, { subject_type: 'proposition', state: 'verified' }),
    ).toBe(1);
    expect(
      valueOf(byState, { subject_type: 'proposition', state: 'unverified' }),
    ).toBe(1);
    expect(
      valueOf(byState, { subject_type: 'minutes', state: 'verified' }),
    ).toBe(1);
    expect(
      valueOf(byState, { subject_type: 'representative', state: 'unsourced' }),
    ).toBe(1);
  });

  it('writes an explicit zero for a family with no claims', async () => {
    await recordClaims(db, {
      subjectType: 'minutes',
      subjectId: 'min-only',
      claims: normaliseSummaryClaims([
        {
          kind: 'decision',
          title: 'The motion carried 5-2 to advance AB 1234',
          detail: 'x',
          citation: { quote: 'the motion carried 5-2 to advance AB 1234' },
        },
      ]),
      sourceText: MINUTES_TEXT,
      sourceTextHash: sha256(MINUTES_TEXT),
    });

    await service.measure();

    // A gauge holds its last value forever, so a family that stops appearing
    // in the query would otherwise stay frozen at its last non-zero reading.
    expect(valueOf(total, { subject_type: 'proposition' })).toBe(0);
    expect(valueOf(unevidenced, { subject_type: 'proposition' })).toBe(0);
  });

  it('does not silently omit a family it was not told about', async () => {
    // FAMILIES is a hardcoded list, which is what lets a vanished family be
    // zeroed rather than frozen. On its own it would also mean a fourth
    // family never appearing in the number the epic is judged on.
    await recordClaims(db, {
      subjectType: 'bill' as never,
      subjectId: 'bill-x',
      claims: normaliseBioClaims([
        { sentence: 'An assertion about a bill.', origin: 'training' },
      ]),
      sourceText: null,
      sourceTextHash: null,
    });

    await service.measure();

    expect(valueOf(total, { subject_type: 'bill' })).toBe(1);
    expect(valueOf(unevidenced, { subject_type: 'bill' })).toBe(1);
  });

  it('records when the measurement last succeeded', async () => {
    await seed();
    await service.measure();

    expect(freshness.set).toHaveBeenCalledTimes(1);
    const [[seconds]] = freshness.set.mock.calls;
    expect(seconds).toBeGreaterThan(1_700_000_000);
  });

  it('publishes no value at all when the measurement fails', async () => {
    const broken = new ClaimEvidenceMetricsService(
      {
        claim: {
          groupBy: jest.fn().mockRejectedValue(new Error('database is gone')),
        },
        $queryRaw: jest.fn().mockRejectedValue(new Error('database is gone')),
      } as never,
      total as never,
      unevidenced as never,
      byState as never,
      freshness as never,
    );

    await expect(broken.measure()).resolves.toBeUndefined();

    // #1278's lesson, and #1217's 49-day outage: writing zero here would
    // report a fully-evidenced corpus, which is indistinguishable from a
    // healthy one. Leaving the gauges untouched keeps the last good value and
    // lets the freshness gauge go stale, which is the actual signal.
    expect(total.set).not.toHaveBeenCalled();
    expect(unevidenced.set).not.toHaveBeenCalled();
    expect(byState.set).not.toHaveBeenCalled();
    expect(freshness.set).not.toHaveBeenCalled();
  });
});
