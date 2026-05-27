/**
 * Personalized Feed Integration Tests (#743)
 *
 * Exercises the cross-service DB read path against a real Postgres.
 * Unit tests cover the scoring + coercion logic exhaustively; this
 * suite specifically validates the Prisma `aiSummary IS NOT NULL`
 * filter, JSONB shape coercion against actual stored payloads, and
 * end-to-end ranking against a heterogeneous bill corpus.
 *
 * Direct-service approach: instantiates `PersonalizedFeedService`
 * against the real DbService rather than going through GraphQL. The
 * resolver layer is covered by its unit spec; the novel concern here
 * is whether the SQL query + coercion behaves correctly with real
 * JSONB-stored values.
 */
import {
  cleanDatabase,
  disconnectDatabase,
  createBill,
  getDbService,
} from '../utils';
import { ScoringService } from '../../../src/apps/knowledge/src/domains/personalized-feed/scoring.service';
import { PersonalizedFeedService } from '../../../src/apps/knowledge/src/domains/personalized-feed/personalized-feed.service';
import type { PersonalizationInputDto } from '../../../src/apps/knowledge/src/domains/personalized-feed/dto/personalization-input.dto';

const FLAGS_OFF: PersonalizationInputDto['flags'] = {
  isRenter: false,
  isHomeowner: false,
  isParent: false,
  isCaregiver: false,
  isStudent: false,
  isEducator: false,
  isWorker: false,
  isBusinessOwner: false,
  isUnionMember: false,
  isGigWorker: false,
  isTransitRider: false,
  isDriver: false,
  hasSpecialLicense: false,
  hasImmigrationConcern: false,
  hasHealthCondition: false,
  hasPublicHealthInsurance: false,
  isVeteran: false,
  hasJusticeInvolvement: false,
  isLowIncome: false,
  receivesPublicBenefits: false,
};

describe('PersonalizedFeedService — integration (real DB)', () => {
  let service: PersonalizedFeedService;

  beforeAll(async () => {
    const db = await getDbService();
    service = new PersonalizedFeedService(db, new ScoringService());
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('returns ranked bills against a real Postgres JSONB corpus', async () => {
    // A renter who cares about housing should see the housing-renter bill
    // first; the agriculture bill should be dropped entirely (no relevance).
    await createBill({
      billNumber: 'AB 100',
      title: 'Housing for renters',
      lastActionDate: new Date(),
      aiSummary: {
        plainEnglishSummary: 'Caps rent increases.',
        topics: ['housing'],
        whoItAffects: ['renters'],
        fiscalImpact: { level: 'low', summary: 'Negligible.' },
        stakeholderImpact: 'Renters gain protections.',
      },
      aiSummaryVersion: 'v1',
    });

    await createBill({
      billNumber: 'AB 200',
      title: 'Pure housing, no stakeholder match',
      lastActionDate: new Date(),
      aiSummary: {
        plainEnglishSummary: 'Reorganizes a housing authority.',
        topics: ['housing'],
        whoItAffects: ['government-operations-staff'], // not in WHO_TO_FLAG
        fiscalImpact: { level: 'none', summary: 'No fiscal impact.' },
        stakeholderImpact: 'Internal admin only.',
      },
      aiSummaryVersion: 'v1',
    });

    await createBill({
      billNumber: 'AB 300',
      title: 'Agricultural subsidies',
      // lastActionDate intentionally null so axis 3 = 0. With no
      // topic or stakeholder overlap either, the composite is 0 and
      // the drop-zero filter excludes this bill. (A recent action
      // date would have given it axis 3 = 1.0 = 0.2 composite, which
      // is correct behavior — recency alone keeps a bill in the feed
      // at low rank — but defeats this test's intent of validating
      // the zero-relevance drop.)
      lastActionDate: null,
      aiSummary: {
        plainEnglishSummary: 'Subsidies for farmers.',
        topics: ['agriculture'],
        whoItAffects: ['farmers'],
        fiscalImpact: { level: 'high', summary: 'Large outlay.' },
        stakeholderImpact: 'Farmers benefit.',
      },
      aiSummaryVersion: 'v1',
    });

    const input: PersonalizationInputDto = {
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    };

    const result = await service.getFeedForUser('u-1', input, 10);

    expect(result).toHaveLength(2);
    expect(result[0].billId).not.toBeFalsy();
    // The renter+housing match outranks the housing-only match.
    expect(result[0].relevanceScore).toBeGreaterThan(result[1].relevanceScore);
    expect(result[0].axisScores.directMaterial).toBe(0.2);
    expect(result[0].axisScores.valuesAlignment).toBe(1.0);
    expect(result[0].axisScores.actionability).toBe(1.0);
    // Agriculture bill drops out entirely (zero overlap with user).
    const ids = result.map((r) => r.billId);
    const billsByNumber = await (
      await getDbService()
    ).bill.findMany({
      where: { id: { in: ids } },
      select: { id: true, billNumber: true },
    });
    expect(billsByNumber.map((b) => b.billNumber)).not.toContain('AB 300');
  });

  it('filters bills with aiSummary IS NULL via the Prisma `not: DbNull` clause', async () => {
    // Two bills: one enriched, one not. The unenriched one must not
    // appear in the feed even though it exists in the table — this
    // is the WHERE filter the unit tests can only mock.
    await createBill({
      billNumber: 'AB 100',
      title: 'Enriched bill',
      lastActionDate: new Date(),
      aiSummary: {
        topics: ['housing'],
        whoItAffects: ['renters'],
      },
      aiSummaryVersion: 'v1',
    });
    await createBill({
      billNumber: 'AB 200',
      title: 'Un-enriched bill (no aiSummary)',
      lastActionDate: new Date(),
      aiSummary: null,
    });

    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: { ...FLAGS_OFF, isRenter: true } },
      10,
    );
    expect(result).toHaveLength(1);
  });

  it('drops bills with the { skip: true } sentinel persisted in JSONB', async () => {
    await createBill({
      billNumber: 'AB 100',
      title: 'LLM said skip',
      lastActionDate: new Date(),
      aiSummary: { skip: true },
      aiSummaryVersion: 'v1',
    });
    await createBill({
      billNumber: 'AB 200',
      title: 'Actually rankable',
      lastActionDate: new Date(),
      aiSummary: { topics: ['housing'], whoItAffects: ['renters'] },
      aiSummaryVersion: 'v1',
    });

    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: { ...FLAGS_OFF, isRenter: true } },
      10,
    );
    expect(result).toHaveLength(1);
  });

  it('returns an empty feed when no enriched bills exist (cold start)', async () => {
    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: { ...FLAGS_OFF, isRenter: true } },
      5,
    );
    expect(result).toEqual([]);
  });

  it('respects the requested limit against a larger corpus', async () => {
    // Seed 10 matching bills; ask for top 3.
    for (let i = 0; i < 10; i++) {
      await createBill({
        billNumber: `AB ${i + 1}`,
        title: `Housing bill ${i + 1}`,
        lastActionDate: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
        aiSummary: { topics: ['housing'], whoItAffects: ['renters'] },
        aiSummaryVersion: 'v1',
      });
    }
    const result = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: { ...FLAGS_OFF, isRenter: true } },
      3,
    );
    expect(result).toHaveLength(3);
  });
});
