/**
 * A scraped bio clears its AI attribution — against a REAL database (#1391).
 *
 * This file exists because the unit test beside it cannot do this job: it
 * mocks `representative.upsert`, and a mock accepts any payload shape — the
 * same divergence #991 hit, where a mocked `where` hid a column that did not
 * exist until it 500'd every funding page.
 *
 * What it verifies is that the payload production builds actually clears all
 * five columns through a real Prisma client.
 *
 * One thing measured here and worth recording, because the first version of
 * this fix got it wrong in BOTH directions: `bio_claims` is JSONB, and a
 * literal `null` is a COMPILE error (TS2322 — the generated type is
 * `NullableJsonNullValueInput | InputJsonValue | undefined`) while at RUNTIME
 * Prisma accepts it and clears the column. So the original `bioClaims: null`
 * was type-unsound, not crash-inducing, and an earlier version of this file
 * asserted a runtime rejection that does not occur. The protection is
 * therefore type-level: `clearedAiAttribution` returns
 * `Partial<Prisma.RepresentativeUpdateInput>` so the spread is checked, and a
 * literal null fails the build.
 */

import { DbService } from '@opuspopuli/relationaldb-provider';
import { clearedAiAttribution } from '../../../src/apps/region/src/domains/representatives-sync.service';
import { recordClaims } from '../../../src/apps/region/src/domains/claim-recorder';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const EXTERNAL_ID = 'ca-senate-1391';

/** A bio long enough to clear `isLikelyValidBio`'s 100-character floor. */
const SCRAPED_BIO =
  'Senator Ashby was elected in 2022 to represent Sacramento and Elk Grove. ' +
  'The only woman on the Sacramento City Council for over six years.';

describe('scraped bio clears AI attribution (#1391)', () => {
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

  /** A rep as the generator leaves it: bio plus full AI attribution. */
  const seedGenerated = () =>
    db.representative.create({
      data: {
        externalId: EXTERNAL_ID,
        regionId: 'california',
        name: 'Angelique V. Ashby',
        chamber: 'Senate',
        district: '8',
        party: 'Democratic',
        bio: 'Generated prose about a senator, long enough to be retained.',
        bioSource: 'ai-generated',
        bioClaims: [{ origin: 'training', sentence: 'Invented claim.' }],
        bioPromptHash: '833edcbb6b450f3afb329238c182f09b1ec652f7',
        bioPromptVersion: 'v1',
        bioLlmModel: 'nemotron-3.5-lightning:30b-a3b',
        bioLlmDigest: 'e7a64ff15fb174c42b4f',
      },
    });

  it('clears all five columns through a real Prisma update', async () => {
    await seedGenerated();

    const cleared = clearedAiAttribution({
      externalId: EXTERNAL_ID,
      name: 'Angelique V. Ashby',
      bio: SCRAPED_BIO,
      bioSource: 'scraped',
    } as never);

    // The payload production builds, applied by a real client. A literal
    // `null` for bioClaims throws here; `Prisma.DbNull` does not.
    await db.representative.update({
      where: { externalId: EXTERNAL_ID },
      data: {
        bio: SCRAPED_BIO,
        bioSource: 'scraped',
        ...(cleared as object),
      },
    });

    const row = await db.representative.findUniqueOrThrow({
      where: { externalId: EXTERNAL_ID },
    });

    expect(row.bioSource).toBe('scraped');
    expect(row.bio).toBe(SCRAPED_BIO);
    expect(row.bioClaims).toBeNull();
    expect(row.bioPromptHash).toBeNull();
    expect(row.bioPromptVersion).toBeNull();
    expect(row.bioLlmModel).toBeNull();
    expect(row.bioLlmDigest).toBeNull();
  });

  it('leaves a generated bio’s attribution untouched', async () => {
    await seedGenerated();

    const cleared = clearedAiAttribution({
      externalId: EXTERNAL_ID,
      name: 'Angelique V. Ashby',
      bio: 'Still generated prose, long enough to survive the junk-bio guard.',
      bioSource: 'ai-generated',
    } as never);

    expect(cleared).toEqual({});

    const row = await db.representative.findUniqueOrThrow({
      where: { externalId: EXTERNAL_ID },
    });
    expect(row.bioLlmModel).toBe('nemotron-3.5-lightning:30b-a3b');
    expect(row.bioClaims).not.toBeNull();
  });

  /**
   * The SHARED `claims` table, against a real database.
   *
   * `clearedAiAttribution` clears the row's own columns; the claims that
   * attest to the removed text are a separate write and were left current —
   * 22 of them survived on two reps in UAT, asserting an invented spouse and
   * a school-board seat that does not exist.
   *
   * This cannot be done in the unit spec beside it: that one mocks the DB
   * *and* `jest.mock`s the writer, so it can only observe that `recordClaims`
   * was called, never that superseding actually happened. The behaviour under
   * test is bi-temporal SQL — `recordClaims` with an empty claim list must
   * close the current rows and insert nothing — and the repo's convention is
   * that a database behaviour is verified against a database.
   */
  it('supersedes the AI bio claims rather than deleting them', async () => {
    const rep = await seedGenerated();

    await db.claim.createMany({
      data: [
        {
          id: 'claim-1391-a',
          subjectType: 'representative',
          subjectId: rep.id,
          subjectField: 'Name',
          text: 'Ashby represents California State Senate District 8.',
          confidence: 'high',
        },
        {
          id: 'claim-1391-b',
          subjectType: 'representative',
          subjectId: rep.id,
          subjectField: null,
          text: 'She earned a Political Science degree.',
          confidence: 'high',
        },
      ],
    });

    await recordClaims(db, {
      subjectType: 'representative',
      subjectId: rep.id,
      claims: [],
      sourceText: null,
      sourceTextHash: null,
    });

    const current = await db.claim.count({
      where: {
        subjectType: 'representative',
        subjectId: rep.id,
        validUntil: null,
      },
    });
    const total = await db.claim.count({
      where: { subjectType: 'representative', subjectId: rep.id },
    });

    // Nothing current — and nothing deleted. The record of what the v1
    // corpus asserted is what a later audit needs.
    expect(current).toBe(0);
    expect(total).toBe(2);
  });
});
