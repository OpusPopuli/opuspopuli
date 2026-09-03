/**
 * County threshold schema (#1106, epic #1105) against a real Postgres.
 *
 * The landing page's entire argument rests on §9118 arithmetic being checkable
 * against a county elections office. These tests assert the constraints that
 * make an uncheckable or nonsensical row impossible to store — the database is
 * the last place that can refuse, and the only one that refuses uniformly.
 *
 * Why identity is borrowed rather than restated: all 58 California counties
 * already exist as `jurisdictions` rows with `fips_code`. A second table with
 * its own name and FIPS would give the platform two answers to "what is 06057
 * called", and they would diverge the first time one was reloaded. The foreign
 * key is what makes that structural rather than a convention.
 */
import { getDbService, cleanDatabase, disconnectDatabase } from '../utils';

const FIPS = '06057'; // Nevada County — the canonical verification case in #1107
const UNKNOWN_FIPS = '06999'; // not a real county

describe('county_thresholds schema (#1106, real DB)', () => {
  let db: Awaited<ReturnType<typeof getDbService>>;

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await db.jurisdiction.create({
      data: {
        name: 'Nevada County',
        type: 'COUNTY',
        level: 'COUNTY',
        stateCode: 'CA',
        fipsCode: FIPS,
      },
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  const validRow = {
    fips: FIPS,
    // 50,737 is what the 2022 Statement of Vote records for Nevada County.
    // The county's own guide says 51,370; the state record does not support it.
    gubernatorialVotes: 50737,
    gubernatorialYear: 2022,
    registeredVoters: 70000,
    sourceUrl: 'https://elections.cdn.sos.ca.gov/sov/2022-general/sov/',
    retrievedAt: new Date('2026-09-02T00:00:00Z'),
  };

  it('stores a county threshold that cites its source', async () => {
    const row = await db.countyThreshold.create({ data: validRow });

    expect(row.fips).toBe(FIPS);
    expect(row.gubernatorialVotes).toBe(50737);
    // 5,074 — ceil(50737 * 0.10) — from the state's Statement of Vote, NOT the
    // 5,137 in Nevada County's own guide, which the 2022 record does not
    // support. Derived in the query, never stored, so it cannot drift from the
    // input it claims to describe.
    expect(Math.ceil(row.gubernatorialVotes * 0.1)).toBe(5074);
  });

  it('refuses a county that does not exist in jurisdictions', async () => {
    // Without the FK, a typo'd FIPS becomes an orphan row that renders as an
    // unshaded polygon — which reads as data rather than as absence.
    await expect(
      db.countyThreshold.create({
        data: { ...validRow, fips: UNKNOWN_FIPS },
      }),
    ).rejects.toThrow();
  });

  it('refuses a row that cannot cite itself', async () => {
    // `source_url` and `retrieved_at` are NOT NULL because the page's claim to
    // be checkable is only as good as the weakest row behind it.
    await expect(
      db.$executeRaw`
        INSERT INTO county_thresholds (fips, gubernatorial_votes, gubernatorial_year, retrieved_at)
        VALUES (${FIPS}, 51370, 2022, now())
      `,
    ).rejects.toThrow();
  });

  it('refuses a non-positive vote count', async () => {
    // Zero votes would make the threshold zero, which reads as "anyone can
    // qualify a measure here" — the most damaging possible wrong answer.
    await expect(
      db.countyThreshold.create({
        data: { ...validRow, gubernatorialVotes: 0 },
      }),
    ).rejects.toThrow();
  });

  it('keeps one row per county', async () => {
    await db.countyThreshold.create({ data: validRow });
    await expect(
      db.countyThreshold.create({ data: validRow }),
    ).rejects.toThrow();
  });
});

describe('county_adjacency schema (#1106, real DB)', () => {
  let db: Awaited<ReturnType<typeof getDbService>>;
  const NEIGHBOR = '06061'; // Placer County

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await db.jurisdiction.createMany({
      data: [
        {
          name: 'Nevada County',
          type: 'COUNTY',
          level: 'COUNTY',
          stateCode: 'CA',
          fipsCode: FIPS,
        },
        {
          name: 'Placer County',
          type: 'COUNTY',
          level: 'COUNTY',
          stateCode: 'CA',
          fipsCode: NEIGHBOR,
        },
      ],
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('stores an adjacency in both directions', async () => {
    await db.countyAdjacency.createMany({
      data: [
        { fips: FIPS, neighbor: NEIGHBOR },
        { fips: NEIGHBOR, neighbor: FIPS },
      ],
    });

    // Both directions stored means the primary key alone serves lookups either
    // way, and no second index is needed.
    expect(await db.countyAdjacency.count()).toBe(2);
  });

  it('refuses a county as its own neighbour', async () => {
    // A careless ST_Touches self-join makes every county adjacent to itself,
    // and "cheapest adjacent county" then returns the county you are already
    // looking at. Cheap to prevent here, confusing to debug later.
    await expect(
      db.countyAdjacency.create({ data: { fips: FIPS, neighbor: FIPS } }),
    ).rejects.toThrow();
  });

  it('refuses an adjacency to a county that does not exist', async () => {
    await expect(
      db.countyAdjacency.create({
        data: { fips: FIPS, neighbor: UNKNOWN_FIPS },
      }),
    ).rejects.toThrow();
  });
});
