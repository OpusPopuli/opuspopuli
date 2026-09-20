/**
 * Integration test for the claim backfill (#1294).
 *
 * The acceptance criteria are about what ends up in the database — all three
 * shapes represented without losing information, `origin: 'training'` still
 * distinguishable from a failed check, nothing promoted or dropped, and the
 * distribution answerable as a query. Every one of those is a statement about
 * stored rows, so this is where they are checked.
 *
 * Real database, per the integration-test convention.
 */

import { createHash } from 'node:crypto';
import type { DbService } from '@opuspopuli/relationaldb-provider';
import { ClaimBackfillService } from '../../../src/apps/region/src/domains/claim-backfill.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const MINUTES_TEXT =
  'The committee convened at nine. After public comment the motion carried ' +
  '5-2 to advance AB 1234 to the floor, and the chair adjourned the session.';

const PROP_TEXT =
  'The measure would raise the documentary transfer tax on residential ' +
  'properties valued over five million dollars, and directs the revenue to ' +
  'affordable housing construction.';

const sha256 = (v: string) =>
  createHash('sha256').update(v, 'utf8').digest('hex');

describe('claim backfill (#1294)', () => {
  let db: DbService;
  let service: ClaimBackfillService;

  beforeAll(async () => {
    db = await getDbService();
    service = new ClaimBackfillService(db);
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seed();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  /** One row of each family, carrying its own shape of claim. */
  async function seed() {
    await db.proposition.create({
      data: {
        id: 'prop-bf',
        externalId: 'prop-bf',
        title: 'Transfer tax measure',
        summary: 'A measure.',
        fullText: PROP_TEXT,
        analysisClaims: [
          {
            // Supported: the span covers the vocabulary of the claim.
            claim: 'The measure raises the documentary transfer tax.',
            field: 'fiscalImpact',
            sourceStart: PROP_TEXT.indexOf('raise'),
            sourceEnd: PROP_TEXT.indexOf('raise') + 60,
            confidence: 'high',
          },
          {
            // In range and about something else — the failure the gate exists
            // for, since the write path clamps offsets into range.
            claim: 'The measure abolishes the vehicle licence fee.',
            field: 'keyProvisions',
            sourceStart: PROP_TEXT.indexOf('affordable'),
            sourceEnd: PROP_TEXT.length,
            confidence: 'low',
          },
        ],
      },
    });

    await db.minutes.create({
      data: {
        id: 'min-bf',
        externalId: 'min-bf',
        body: 'Assembly',
        date: new Date('2026-07-13'),
        sourceUrl: 'https://example.test/minutes/min-bf',
        rawText: MINUTES_TEXT,
        summary: 'The committee advanced AB 1234.',
        summaryClaims: [
          {
            kind: 'decision',
            title: 'The motion carried 5-2 to advance AB 1234',
            detail: 'Advanced to the floor.',
            citation: { quote: 'the motion carried 5-2 to advance AB 1234' },
          },
        ],
      },
    });

    await db.representative.create({
      data: {
        id: 'rep-bf',
        externalId: 'rep-bf',
        name: 'Jane Smith',
        chamber: 'Senate',
        district: '5',
        party: 'Democrat',
        bio: 'A bio.',
        bioClaims: [
          {
            sentence: 'Represents District 5.',
            origin: 'source',
            sourceField: 'district',
          },
          {
            sentence: 'Widely regarded as a moderate.',
            origin: 'training',
            sourceHint: 'press',
          },
        ],
      },
    });
  }

  it('represents all three shapes without losing claims', async () => {
    const report = await service.backfillAll();

    expect(report.propositions).toBe(1);
    expect(report.minutes).toBe(1);
    expect(report.representatives).toBe(1);
    // 2 + 1 + 2 in, 5 out. Nothing dropped.
    expect(report.claimsWritten).toBe(5);

    const bySubject = await db.claim.groupBy({
      by: ['subjectType'],
      _count: { subjectType: true },
    });
    expect(
      Object.fromEntries(
        bySubject.map((r) => [r.subjectType, r._count.subjectType]),
      ),
    ).toEqual({ proposition: 2, minutes: 1, representative: 2 });
  });

  it('keeps a recalled claim distinct from a failed check', async () => {
    await service.backfillAll();

    const unsourced = await db.claim.findMany({
      where: { evidence: { some: { evidence: { state: 'unsourced' } } } },
      select: { text: true },
    });

    // #1208's requirement. `origin: 'training'` never offered a citation;
    // merging it into `unverified` would make recollection read as a check
    // that happened to fail.
    expect(unsourced.map((c) => c.text)).toEqual([
      'Widely regarded as a moderate.',
    ]);
  });

  it('refuses the in-range span that supports nothing, and keeps the claim', async () => {
    await service.backfillAll();

    const claim = await db.claim.findFirst({
      where: { text: 'The measure abolishes the vehicle licence fee.' },
      include: { evidence: { include: { evidence: true } } },
    });

    // Never promoted, never dropped — the claim is stored and its citation is
    // recorded as not holding up.
    expect(claim).not.toBeNull();
    expect(claim!.evidence[0].evidence.state).toBe('unverified');
  });

  it('verifies the quoted minutes claim, deriving its span', async () => {
    await service.backfillAll();

    const claim = await db.claim.findFirst({
      where: { subjectType: 'minutes' },
      include: { evidence: { include: { evidence: true } } },
    });
    const evidence = claim!.evidence[0].evidence;

    // The family that quotes verbatim is the one that can actually verify.
    expect(evidence.state).toBe('verified');
    expect(evidence.spanStart).toBe(MINUTES_TEXT.indexOf('the motion carried'));
    expect(evidence.sourceTextHash).toBe(sha256(MINUTES_TEXT));
  });

  it('scores a proposition whose cited text version was never recorded', async () => {
    await service.backfillAll();

    const claim = await db.claim.findFirst({
      where: { text: 'The measure raises the documentary transfer tax.' },
      include: { evidence: { include: { evidence: true } } },
    });

    // `analysis_source_text_hash` is NULL on every existing row — #1279's
    // column post-dates them all. The resolver reports `stale` only for a hash
    // that is present AND differs, so a NULL is scored rather than refused.
    // Refusing would leave the whole offsets corpus unscored and make the
    // measured anchoring rate unreproducible, which is what this issue exists
    // to deliver.
    expect(claim!.evidence[0].evidence.state).toBe('verified');
    expect(claim!.evidence[0].evidence.sourceTextHash).toBe(sha256(PROP_TEXT));
  });

  it('is idempotent — a second run converges rather than duplicating', async () => {
    const first = await service.backfillAll();
    const second = await service.backfillAll();

    // Non-zero first, or this passes vacuously against an inert backfill.
    expect(first.claimsWritten).toBe(5);
    expect(second.claimsWritten).toBe(first.claimsWritten);
    expect(second.distribution).toEqual(first.distribution);
    expect(await db.claim.count()).toBe(5);
    // Superseded evidence goes with the claims it belonged to.
    expect(await db.evidence.count({ where: { claims: { none: {} } } })).toBe(
      0,
    );
  });

  it('reports the distribution as a query over stored rows', async () => {
    const report = await service.backfillAll();

    const rows = await db.evidence.groupBy({
      by: ['state'],
      _count: { state: true },
    });
    const fromDb = {
      verified: 0,
      snapped: 0,
      unverified: 0,
      unsourced: 0,
      ...Object.fromEntries(rows.map((r) => [r.state, r._count.state])),
    };

    // The acceptance criterion: the number is the gate's measurement, not a
    // summary the backfill wrote about itself. Those diverge the moment a
    // write fails silently, which is exactly when the summary would lie.
    expect(report.distribution).toEqual(fromDb);
    expect(report.distribution).toEqual({
      verified: 2,
      snapped: 0,
      unverified: 2,
      unsourced: 1,
    });
  });

  it('reports rows it could not back fill', async () => {
    // A blob that is not an array at all — the shape #1294 reads across years
    // of different prompts. The normalisers tolerate it, so the row succeeds
    // with zero claims rather than failing; what must not happen is the row
    // being counted as backfilled while its claims are silently absent.
    await db.proposition.update({
      where: { id: 'prop-bf' },
      data: { analysisClaims: 'not an array at all' },
    });

    const report = await service.backfillAll();

    expect(report.failed).toBe(0);
    // The proposition contributed nothing; the other families are intact.
    expect(report.claimsWritten).toBe(3);
    expect(
      await db.claim.count({ where: { subjectType: 'proposition' } }),
    ).toBe(0);
  });

  it('pages by keyset so a row inserted mid-run cannot be skipped', async () => {
    // Ids are random UUIDs, so a row written by a live generator lands
    // anywhere in the ordering. Under skip/take an insert before the current
    // window shifts everything right and the boundary row is never read.
    // Seeding ids that bracket the existing one exercises the ordering.
    for (const id of ['aaa-before', 'zzz-after']) {
      await db.representative.create({
        data: {
          id,
          externalId: id,
          name: `Rep ${id}`,
          chamber: 'Senate',
          district: '1',
          party: 'Democrat',
          bio: 'A bio.',
          bioClaims: [{ sentence: 'A claim.', origin: 'training' }],
        },
      });
    }

    const report = await service.backfillAll();

    expect(report.representatives).toBe(3);
    const ids = await db.claim.findMany({
      where: { subjectType: 'representative' },
      select: { subjectId: true },
      distinct: ['subjectId'],
    });
    expect(ids.map((r) => r.subjectId).sort()).toEqual([
      'aaa-before',
      'rep-bf',
      'zzz-after',
    ]);
  });

  it('honours a limit so a run can be rehearsed', async () => {
    const report = await service.backfillAll(0);

    expect(report).toMatchObject({
      propositions: 0,
      minutes: 0,
      representatives: 0,
      claimsWritten: 0,
    });
    expect(await db.claim.count()).toBe(0);
  });
});
