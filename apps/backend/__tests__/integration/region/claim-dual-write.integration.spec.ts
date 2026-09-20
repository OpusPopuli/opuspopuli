/**
 * Integration test for claim dual-write (#1293).
 *
 * The unit specs prove each generator calls the recorder. This proves the
 * rows it writes are the ones the epic needs: claims joined to evidence,
 * states assigned only by the gate, and the three families staying
 * distinguishable in what they can support.
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
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const MINUTES_TEXT =
  'The committee convened at nine. After public comment the motion carried ' +
  '5-2 to advance AB 1234 to the floor, and the chair adjourned the session.';
const MINUTES_HASH = createHash('sha256')
  .update(MINUTES_TEXT, 'utf8')
  .digest('hex');

const PROP_TEXT =
  'The measure would raise the documentary transfer tax on residential ' +
  'properties valued over five million dollars, and directs the revenue to ' +
  'affordable housing construction.';
const PROP_HASH = createHash('sha256').update(PROP_TEXT, 'utf8').digest('hex');

describe('claim dual-write (#1293)', () => {
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

  /** Every claim for a subject, with its evidence, in insertion order. */
  async function claimsFor(subjectType: string, subjectId: string) {
    return db.claim.findMany({
      where: { subjectType, subjectId },
      include: { evidence: { include: { evidence: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  describe('minutes — the family that quotes its source', () => {
    it('verifies a claim whose quote is in the text, deriving the span', async () => {
      const outcome = await recordClaims(db, {
        subjectType: 'minutes',
        subjectId: 'min-1',
        claims: normaliseSummaryClaims([
          {
            kind: 'decision',
            title: 'The motion carried 5-2 to advance AB 1234',
            detail: 'Advanced to the floor.',
            citation: { quote: 'the motion carried 5-2 to advance AB 1234' },
          },
        ]),
        sourceText: MINUTES_TEXT,
        sourceTextHash: MINUTES_HASH,
      });

      expect(outcome.written).toBe(1);

      const [claim] = await claimsFor('minutes', 'min-1');
      const evidence = claim.evidence[0].evidence;

      // Minutes store no offsets, so a located quote is a DERIVED span under
      // #1212's contract — not a citation we had to move. Filing this as
      // `snapped` would understate verification for the best-citing family in
      // the platform.
      expect(evidence.state).toBe('verified');
      expect(evidence.spanStart).toBe(
        MINUTES_TEXT.indexOf('the motion carried'),
      );
      expect(evidence.quotedText).toBe(
        'the motion carried 5-2 to advance AB 1234',
      );
    });

    it('refuses a quote that is not in the minutes', async () => {
      await recordClaims(db, {
        subjectType: 'minutes',
        subjectId: 'min-2',
        claims: normaliseSummaryClaims([
          {
            kind: 'decision',
            title: 'The committee rejected the budget',
            detail: 'x',
            citation: { quote: 'the budget was rejected unanimously' },
          },
        ]),
        sourceText: MINUTES_TEXT,
        sourceTextHash: MINUTES_HASH,
      });

      const [claim] = await claimsFor('minutes', 'min-2');
      // Text that reads as a citation and is not one.
      expect(claim.evidence[0].evidence.state).toBe('unverified');
    });
  });

  describe('propositions — the offsets corpus', () => {
    it('refuses an in-range span that supports nothing in particular', async () => {
      const start = PROP_TEXT.indexOf('affordable');
      await recordClaims(db, {
        subjectType: 'proposition',
        subjectId: 'prop-1',
        claims: normaliseAnalysisClaims([
          {
            claim: 'The measure raises the documentary transfer tax.',
            field: 'fiscalImpact',
            sourceStart: start,
            sourceEnd: PROP_TEXT.length,
            confidence: 'high',
          },
        ]),
        sourceText: PROP_TEXT,
        sourceTextHash: PROP_HASH,
      });

      const [claim] = await claimsFor('proposition', 'prop-1');
      // The write path clamps offsets into range, so "in range" is guaranteed
      // by construction and proves nothing — the failure the gate exists for.
      expect(claim.evidence[0].evidence.state).toBe('unverified');
      // The ordinal is stored as the generator said it, not as a float.
      expect(claim.confidence).toBe('high');
      expect(claim.subjectField).toBe('fiscalImpact');
    });

    it('will not verify a claim against text rewritten since it was made', async () => {
      const amended = PROP_TEXT.replace('five million', 'three million');
      const start = PROP_TEXT.indexOf('raise');

      await recordClaims(db, {
        subjectType: 'proposition',
        subjectId: 'prop-2',
        claims: normaliseAnalysisClaims([
          {
            claim: 'The measure raises the documentary transfer tax.',
            field: 'fiscalImpact',
            sourceStart: start,
            sourceEnd: start + 60,
          },
        ]),
        // The row as sync left it, against the analysis's own recorded hash —
        // the shape #1294's backfill reads. At dual-write time the two hashes
        // are equal by construction, so this is the only way the staleness
        // axis is reachable at all.
        sourceText: amended,
        sourceTextHash: createHash('sha256')
          .update(amended, 'utf8')
          .digest('hex'),
        claimSourceTextHash: PROP_HASH,
      });

      const [claim] = await claimsFor('proposition', 'prop-2');
      // Nothing can be verified against text the claim never saw, however
      // well the offsets happen to line up (#1279).
      expect(claim.evidence[0].evidence.state).toBe('unverified');

      // The stored hash is the text the SPAN was resolved against — the
      // schema's own definition, "SHA-256 of the derived text spanStart/
      // spanEnd index into". The staleness is carried by the state, not by
      // this column. For any row where the span means anything the two are
      // the same value, because a cited-version mismatch is exactly what
      // stops a row reaching `verified`; they differ only on rows whose span
      // has already been disclaimed.
      expect(claim.evidence[0].evidence.sourceTextHash).toBe(
        createHash('sha256')
          .update(PROP_TEXT.replace('five million', 'three million'), 'utf8')
          .digest('hex'),
      );
    });
  });

  describe('representatives — claims that cite fields, not text', () => {
    it('keeps a recalled claim distinct from an uncheckable cited one', async () => {
      await recordClaims(db, {
        subjectType: 'representative',
        subjectId: 'rep-1',
        claims: normaliseBioClaims([
          {
            sentence: 'Represents District 5.',
            origin: 'source',
            sourceField: 'district',
          },
          {
            sentence: 'Widely regarded as a moderate.',
            origin: 'training',
            sourceHint: 'press coverage of the 2022 election',
          },
        ]),
        sourceText: null,
        sourceTextHash: null,
      });

      const claims = await claimsFor('representative', 'rep-1');
      const states = claims.map((c) => c.evidence[0].evidence.state);

      // #1208's requirement: a model's recollection must never read as a
      // citation that merely failed a check.
      expect(states).toEqual(['unverified', 'unsourced']);
    });
  });

  describe('replacing a subject’s claims', () => {
    it('supersedes the previous generation rather than accumulating', async () => {
      const input = (title: string) => ({
        subjectType: 'minutes' as const,
        subjectId: 'min-3',
        claims: normaliseSummaryClaims([
          {
            kind: 'decision' as const,
            title,
            detail: 'x',
            citation: { quote: 'the motion carried 5-2' },
          },
        ]),
        sourceText: MINUTES_TEXT,
        sourceTextHash: MINUTES_HASH,
      });

      await recordClaims(db, input('First generation'));
      await recordClaims(db, input('Second generation'));

      const claims = await claimsFor('minutes', 'min-3');
      // Leaving both would put two versions of the same claim side by side,
      // indistinguishable and both apparently current.
      expect(claims).toHaveLength(1);
      expect(claims[0].text).toBe('Second generation');

      // The superseded evidence goes with it — `evidence` has no foreign key
      // back to a claim, so cascading the claim delete alone would strand it.
      const orphans = await db.evidence.count({
        where: { claims: { none: {} } },
      });
      expect(orphans).toBe(0);
    });
  });

  it('leaves evidence another claim still cites when replacing a subject', async () => {
    const input = {
      subjectType: 'minutes' as const,
      subjectId: 'min-4',
      claims: normaliseSummaryClaims([
        {
          kind: 'decision' as const,
          title: 'The motion carried 5-2',
          detail: 'x',
          citation: { quote: 'the motion carried 5-2' },
        },
      ]),
      sourceText: MINUTES_TEXT,
      sourceTextHash: MINUTES_HASH,
    };
    await recordClaims(db, input);

    // A second subject citing the same evidence row. Nothing produces this
    // today — one evidence row per claim — but `claim_evidence` is
    // many-to-many and dedup across claims (#1294 onward) is likely to.
    const [first] = await claimsFor('minutes', 'min-4');
    const shared = first.evidence[0].evidenceId;
    const other = await db.claim.create({
      data: {
        subjectType: 'minutes',
        subjectId: 'min-5',
        text: 'A different claim citing the same passage.',
      },
    });
    await db.claimEvidence.create({
      data: { claimId: other.id, evidenceId: shared },
    });

    await recordClaims(db, { ...input, claims: input.claims });

    // Replacing min-4 must not pull the row out from under min-5.
    await expect(
      db.evidence.findUnique({ where: { id: shared } }),
    ).resolves.not.toBeNull();
  });

  it('serialises concurrent regenerations of the same subject', async () => {
    const input = (title: string) => ({
      subjectType: 'minutes' as const,
      subjectId: 'min-race',
      claims: normaliseSummaryClaims([
        {
          kind: 'decision' as const,
          title,
          detail: 'x',
          citation: { quote: 'the motion carried 5-2' },
        },
      ]),
      sourceText: MINUTES_TEXT,
      sourceTextHash: MINUTES_HASH,
    });

    // Two writers racing on one subject. Under READ COMMITTED without the
    // advisory lock both read the same stale id set, one delete wins and both
    // inserts land, leaving two complete sets of claims side by side — both
    // apparently current. The realistic collision is #1294's backfill sweeping
    // a family while a generator regenerates a row in it.
    await Promise.all([
      recordClaims(db, input('Writer A')),
      recordClaims(db, input('Writer B')),
    ]);

    const claims = await claimsFor('minutes', 'min-race');
    expect(claims).toHaveLength(1);
    // Whichever committed second is the survivor; which one is not the point.
    expect(['Writer A', 'Writer B']).toContain(claims[0].text);

    const orphans = await db.evidence.count({
      where: { claims: { none: {} } },
    });
    expect(orphans).toBe(0);
  });

  it('clears superseded claims when a regeneration produces none', async () => {
    const seeded = {
      subjectType: 'representative' as const,
      subjectId: 'rep-empty',
      claims: normaliseBioClaims([
        {
          sentence: 'Represents District 5.',
          origin: 'source' as const,
          sourceField: 'district',
        },
      ]),
      sourceText: null,
      sourceTextHash: null,
    };
    await recordClaims(db, seeded);
    expect(await claimsFor('representative', 'rep-empty')).toHaveLength(1);

    await recordClaims(db, { ...seeded, claims: [] });

    // An empty generation supersedes the previous one. Leaving the old claims
    // standing would keep the relational model asserting what the blob no
    // longer says.
    expect(await claimsFor('representative', 'rep-empty')).toHaveLength(0);
    expect(await db.evidence.count({ where: { claims: { none: {} } } })).toBe(
      0,
    );
  });

  it('keeps a claim whose confidence will not fit the column', async () => {
    await recordClaims(db, {
      subjectType: 'proposition',
      subjectId: 'prop-conf',
      claims: normaliseAnalysisClaims([
        {
          claim: 'The measure raises the documentary transfer tax.',
          field: 'fiscalImpact',
          sourceStart: PROP_TEXT.indexOf('raise'),
          sourceEnd: PROP_TEXT.indexOf('raise') + 60,
          confidence:
            'extremely high indeed, beyond all reasonable doubt' as never,
        },
      ]),
      sourceText: PROP_TEXT,
      sourceTextHash: PROP_HASH,
    });

    const [claim] = await claimsFor('proposition', 'prop-conf');
    // The claim survives; only the advisory field is dropped. Losing a claim
    // over a value that is explicitly never a substitute for verification
    // would be the wrong trade, and the dual-write swallows its own errors.
    expect(claim).toBeDefined();
    expect(claim.confidence).toBeNull();
  });

  it('treats a hostile subject id as data in the advisory lock', async () => {
    // subjectId is a database-derived row id, so this is defence in depth
    // rather than a live vector — but the lock is the one place the value
    // reaches raw SQL, and `$executeRaw`'s parameterisation is worth proving
    // rather than assuming.
    const hostile = "x'); DROP TABLE claims; --";

    await recordClaims(db, {
      subjectType: 'minutes',
      subjectId: hostile,
      claims: normaliseSummaryClaims([
        {
          kind: 'decision',
          title: 'Still here',
          detail: 'x',
          citation: { quote: 'the motion carried 5-2' },
        },
      ]),
      sourceText: MINUTES_TEXT,
      sourceTextHash: MINUTES_HASH,
    });

    // The table survives and the id round-trips verbatim.
    const claims = await claimsFor('minutes', hostile);
    expect(claims).toHaveLength(1);
    expect(claims[0].subjectId).toBe(hostile);
  });

  it('makes the verdict distribution a query across all three families', async () => {
    await recordClaims(db, {
      subjectType: 'minutes',
      subjectId: 'min-9',
      claims: normaliseSummaryClaims([
        {
          kind: 'decision',
          title: 'The motion carried 5-2 to advance AB 1234',
          detail: 'x',
          citation: { quote: 'the motion carried 5-2 to advance AB 1234' },
        },
      ]),
      sourceText: MINUTES_TEXT,
      sourceTextHash: MINUTES_HASH,
    });
    await recordClaims(db, {
      subjectType: 'proposition',
      subjectId: 'prop-9',
      claims: normaliseAnalysisClaims([
        {
          claim: 'The measure raises the documentary transfer tax.',
          field: 'fiscalImpact',
          sourceStart: PROP_TEXT.indexOf('affordable'),
          sourceEnd: PROP_TEXT.length,
        },
      ]),
      sourceText: PROP_TEXT,
      sourceTextHash: PROP_HASH,
    });
    await recordClaims(db, {
      subjectType: 'representative',
      subjectId: 'rep-9',
      claims: normaliseBioClaims([
        { sentence: 'A moderate.', origin: 'training', sourceHint: 'press' },
      ]),
      sourceText: null,
      sourceTextHash: null,
    });

    const rows = await db.evidence.groupBy({
      by: ['state'],
      _count: { state: true },
    });

    // The shape the epic asks to be answerable as a query rather than a
    // report: one family can be checked, one is cited but unsupported, one
    // never offered a citation at all.
    expect(
      Object.fromEntries(rows.map((r) => [r.state, r._count.state])),
    ).toEqual({ verified: 1, unverified: 1, unsourced: 1 });
  });
});
