/**
 * Integration test for claim temporal validity (#1295).
 *
 * Regeneration used to delete a subject's prior claims, which made a model
 * refresh unmeasurable: run N overwrote run N-1, so there was nothing to
 * compare against. These are the properties that replace it — a genuine
 * change is retained as history, an identical re-run costs nothing, and the
 * question "what did we assert about this on date X" has an answer.
 *
 * Real database, per the integration-test convention.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { normaliseSummaryClaims } from '../../../src/apps/region/src/domains/claim-normalisers';
import { recordClaims } from '../../../src/apps/region/src/domains/claim-recorder';
import { ClaimEvidenceMetricsService } from '../../../src/apps/region/src/domains/claim-evidence-metrics.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const TEXT =
  'The committee convened at nine. After public comment the motion carried ' +
  '5-2 to advance AB 1234 to the floor, and the chair adjourned the session.';
const HASH = createHash('sha256').update(TEXT, 'utf8').digest('hex');

describe('claim supersession (#1295)', () => {
  let db: DbService;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  const generation = (title: string) => ({
    subjectType: 'minutes' as const,
    subjectId: 'min-s',
    claims: normaliseSummaryClaims([
      {
        kind: 'decision' as const,
        title,
        detail: 'x',
        citation: { quote: 'the motion carried 5-2 to advance AB 1234' },
      },
    ]),
    sourceText: TEXT,
    sourceTextHash: HASH,
  });

  const current = () =>
    db.claim.findMany({ where: { subjectId: 'min-s', validUntil: null } });
  const all = () =>
    db.claim.findMany({
      where: { subjectId: 'min-s' },
      orderBy: { validFrom: 'asc' },
    });

  it('retains the previous generation instead of deleting it', async () => {
    await recordClaims(db, generation('First'));
    await recordClaims(db, generation('Second'));

    expect((await current()).map((c) => c.text)).toEqual(['Second']);
    // The comparison that iterating on a model depends on.
    expect((await all()).map((c) => c.text)).toEqual(['First', 'Second']);
  });

  it('costs nothing when a regeneration says exactly the same thing', async () => {
    await recordClaims(db, generation('Same'));
    const [first] = await current();

    await recordClaims(db, generation('Same'));
    const [second] = await current();

    // Not a new generation: superseding on every call would pile up a dead
    // generation each time the backfill re-runs, breaking the idempotency
    // #1294 requires. The row is untouched, not replaced with an identical one.
    expect(second.id).toBe(first.id);
    expect(await all()).toHaveLength(1);
  });

  it('treats a changed verdict as a new generation even when the text is identical', async () => {
    // Title shares vocabulary with the quote, so it genuinely verifies
    // first time round — a title that scores 0 support would be `unverified`
    // in both runs and the test would prove nothing.
    const CLAIM = 'The motion carried 5-2 to advance AB 1234';
    await recordClaims(db, generation(CLAIM));

    // Same claim, source text rewritten under it — the citation no longer
    // locates, so the verdict changes. That IS a different assertion about
    // the evidence and must be retained as one.
    const amended = TEXT.replace('the motion carried 5-2', 'the motion failed');
    await recordClaims(db, {
      ...generation(CLAIM),
      sourceText: amended,
      sourceTextHash: createHash('sha256')
        .update(amended, 'utf8')
        .digest('hex'),
    });

    expect(await all()).toHaveLength(2);
    const states = await db.evidence.findMany({ select: { state: true } });
    expect(states.map((s) => s.state).sort()).toEqual([
      'unverified',
      'verified',
    ]);
  });

  it('answers what was asserted at a point in time', async () => {
    await recordClaims(db, generation('First'));
    await recordClaims(db, generation('Second'));

    // Pick the instant from the stored rows rather than the wall clock. An
    // earlier version slept 25ms to separate two `new Date()` stamps, which
    // is a flake waiting for a slow or fast machine; the first generation's
    // own validFrom is inside its window by construction.
    const [retired] = await db.claim.findMany({
      where: { subjectId: 'min-s', validUntil: { not: null } },
    });
    const asOf = retired.validFrom;

    const answer = await db.claim.findMany({
      where: {
        subjectId: 'min-s',
        validFrom: { lte: asOf },
        OR: [{ validUntil: null }, { validUntil: { gt: asOf } }],
      },
    });

    // #1295's first acceptance criterion: a claim's applicability window is
    // expressible and queryable.
    expect(answer.map((c) => c.text)).toEqual(['First']);
  });

  it('notices a citation beyond the first when deciding whether anything changed', async () => {
    const CLAIM = 'The motion carried 5-2 to advance AB 1234';
    await recordClaims(db, generation(CLAIM));
    const [claim] = await current();

    // A second citation IDENTICAL to the first. Identical on purpose: with a
    // differing one the test would pass or fail on which row the relation
    // happened to return first, which nothing orders. Two identical rows make
    // the outcome the same whichever comes back first.
    const original = await db.evidence.findFirstOrThrow({
      where: { claims: { some: { claimId: claim.id } } },
    });
    const { id: _id, createdAt: _createdAt, ...fields } = original;
    const extra = await db.evidence.create({ data: fields });
    await db.claimEvidence.create({
      data: { claimId: claim.id, evidenceId: extra.id },
    });

    await recordClaims(db, generation(CLAIM));

    // The incoming generation carries ONE citation; what is stored carries
    // two. That is a real difference. Reading only `evidence[0]` sees one
    // tuple on each side, finds them equal, and calls the run a no-op — so
    // the extra citation persists as though the generator had produced it.
    expect(await all()).toHaveLength(2);
    expect((await current()).map((c) => c.text)).toEqual([CLAIM]);
  });

  it('keeps superseded evidence rather than orphaning it', async () => {
    await recordClaims(db, generation('First'));
    await recordClaims(db, generation('Second'));

    // Both generations keep their citations — the record of what each one
    // actually cited — and neither is left dangling.
    expect(await db.evidence.count()).toBe(2);
    expect(await db.evidence.count({ where: { claims: { none: {} } } })).toBe(
      0,
    );
  });

  it('counts only the current generation in the gauge', async () => {
    const gauge = () => ({ set: jest.fn() });
    const total = gauge();
    const unevidenced = gauge();
    const superseded = gauge();
    const byState = gauge();
    const freshness = gauge();
    const metrics = new ClaimEvidenceMetricsService(
      db,
      total as never,
      unevidenced as never,
      superseded as never,
      byState as never,
      freshness as never,
    );

    // Both titles share vocabulary with the quote so they genuinely verify —
    // otherwise the state asserted below would be `unverified` and the test
    // would not exercise the path it claims to.
    await recordClaims(
      db,
      generation('The motion carried 5-2 to advance AB 1234'),
    );
    await recordClaims(
      db,
      generation('The motion carried 5-2 to advance AB 1234 to the floor'),
    );
    await metrics.measure();

    const valueOf = (g: { set: jest.Mock }, labels: Record<string, string>) =>
      g.set.mock.calls.find(([l]) =>
        Object.entries(labels).every(([k, v]) => l[k] === v),
      )?.[1];

    // Two generations exist, one is current. Counting both would make the
    // corpus appear to grow with every regeneration, and claims_unevidenced
    // would climb precisely as the corpus improved.
    expect(await all()).toHaveLength(2);
    expect(valueOf(total, { subject_type: 'minutes' })).toBe(1);
    expect(
      valueOf(byState, { subject_type: 'minutes', state: 'verified' }),
    ).toBe(1);
  });
});
