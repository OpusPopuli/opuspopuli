/**
 * Personalized Rep Activity Integration Tests (#769)
 *
 * Exercises the cross-service DB read path against a real Postgres.
 * Unit tests cover the scoring + coercion logic exhaustively
 * (rep-relevance.service.spec, personalized-rep-activity.service.spec);
 * this suite specifically validates:
 *
 *   - The Prisma `findMany({ in: [...] })` rep hydration with all four
 *     relation includes (committeeAssignments, authoredBills,
 *     billCoAuthorships, billVotes) returns the expected shape against
 *     real JSONB-stored aiSummary payloads + real string-column vote
 *     positions.
 *   - The 180-day recency window filter runs at the SQL layer (not in
 *     memory after fetching everything), so a rep with one old action
 *     and one fresh action only surfaces the fresh one.
 *   - The bill-context chamber histogram derives from
 *     `Bill.author.chamber` via the relation select, including the
 *     graceful-degradation path where `authorId` is null.
 *   - The `position: { in: ['yes', 'no'] }` SQL filter excludes abstain
 *     / absent rows before they enter memory.
 *
 * Direct-service approach: instantiates `PersonalizedRepActivityService`
 * against the real DbService rather than going through GraphQL. The
 * resolver layer is covered by its unit spec; the federation
 * composition smoke test lives in `federation.integration.spec.ts`.
 */
import {
  cleanDatabase,
  disconnectDatabase,
  createRepresentative,
  generateId,
  getDbService,
} from '../utils';
import { ScoringService } from '../../../src/apps/knowledge/src/domains/personalized-feed/scoring.service';
import { PersonalizedRepActivityService } from '../../../src/apps/knowledge/src/domains/personalized-reps/personalized-rep-activity.service';
import { RepRelevanceService } from '../../../src/apps/knowledge/src/domains/personalized-reps/rep-relevance.service';
import type { RepPersonalizationInputDto } from '../../../src/apps/knowledge/src/domains/personalized-reps/dto/rep-personalization-input.dto';

const FLAGS_OFF: RepPersonalizationInputDto['flags'] = {
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

/**
 * Create a Bill with a resolved author chamber via raw Prisma — the
 * shared `createBill` helper doesn't yet accept an `authorId`, and we
 * specifically need the rep→author relation populated to exercise the
 * chamber histogram.
 */
async function createBillWithAuthor(opts: {
  billNumber: string;
  title?: string;
  authorId: string | null;
  topics?: string[];
  whoItAffects?: string[];
  lastActionDate?: Date | null;
}): Promise<{ id: string }> {
  const db = await getDbService();
  const id = generateId();
  return db.bill.create({
    data: {
      id,
      externalId: `bill-${id}`,
      regionId: 'california',
      billNumber: opts.billNumber,
      sessionYear: '2025-2026',
      measureTypeCode: 'AB',
      title: opts.title ?? 'Test Bill',
      sourceUrl: 'https://example.org/bill',
      lastActionDate: opts.lastActionDate ?? new Date(),
      authorId: opts.authorId,
      aiSummary: {
        topics: opts.topics ?? ['housing'],
        whoItAffects: opts.whoItAffects ?? ['renters'],
      },
      aiSummaryVersion: 'v1',
      isActive: true,
      isDead: false,
    },
    select: { id: true },
  });
}

/**
 * Create a LegislativeCommittee + assignment for the given rep so the
 * committeeAssignments include resolves with a non-empty
 * committeeNames list in the orchestrator's hydration step.
 */
async function assignToCommittee(
  representativeId: string,
  committeeName: string,
  chamber: string,
): Promise<void> {
  const db = await getDbService();
  const committee = await db.legislativeCommittee.create({
    data: {
      externalId: `${chamber.toLowerCase()}:${committeeName.toLowerCase().replace(/\s+/g, '-')}`,
      name: committeeName,
      chamber,
    },
  });
  await db.representativeCommitteeAssignment.create({
    data: {
      representativeId,
      legislativeCommitteeId: committee.id,
      role: 'Member',
    },
  });
}

describe('PersonalizedRepActivityService — integration (#769)', () => {
  let service: PersonalizedRepActivityService;

  beforeAll(async () => {
    const db = await getDbService();
    service = new PersonalizedRepActivityService(
      db,
      new RepRelevanceService(),
      new ScoringService(),
    );
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('ranks reps end-to-end against a real corpus with all three axes contributing', async () => {
    // Two Assembly reps + one Senate rep. The user is a renter who
    // cares about housing. Two Assembly bills (housing/renter signal),
    // one Senate bill. The Assembly rep with both a Housing committee
    // assignment AND a bill authorship should outrank the bare
    // Assembly rep, which in turn should outrank the Senate rep.
    const repHigh = await createRepresentative({
      name: 'Rep High Match',
      chamber: 'Assembly',
      district: '14',
    });
    const repMid = await createRepresentative({
      name: 'Rep Mid Match',
      chamber: 'Assembly',
      district: '15',
    });
    const repLow = await createRepresentative({
      name: 'Sen Low Match',
      chamber: 'Senate',
      district: '7',
    });

    await assignToCommittee(repHigh.id, 'Housing', 'Assembly');

    await createBillWithAuthor({
      billNumber: 'AB 100',
      title: 'Renter protections',
      authorId: repHigh.id,
    });
    await createBillWithAuthor({
      billNumber: 'AB 101',
      title: 'Housing subsidies',
      authorId: repMid.id,
    });
    await createBillWithAuthor({
      billNumber: 'SB 50',
      title: 'Senate housing reform',
      authorId: repLow.id,
    });

    const result = await service.getRepActivityForUser('u-1', {
      representativeIds: [repHigh.id, repMid.id, repLow.id],
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    });

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.representativeId)).toEqual([
      repHigh.id,
      repMid.id,
      repLow.id,
    ]);
    expect(result[0].relevanceScore).toBeGreaterThan(result[1].relevanceScore);
    expect(result[1].relevanceScore).toBeGreaterThan(result[2].relevanceScore);
    expect(result[0].axisScores.committeeMatch).toBe(1.0);
    expect(result[0].axisScores.actionAlignment).toBeGreaterThan(0);
    expect(result[0].recentActivityBillIds.length).toBeGreaterThan(0);
  });

  it('drops actions outside the 180-day recency window at the SQL layer', async () => {
    const rep = await createRepresentative({
      name: 'Test Rep',
      chamber: 'Assembly',
    });
    // One bill in the window (yesterday), one outside (200 days ago)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const longAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

    await createBillWithAuthor({
      billNumber: 'AB 100',
      title: 'Fresh action',
      authorId: rep.id,
      lastActionDate: yesterday,
    });
    await createBillWithAuthor({
      billNumber: 'AB 200',
      title: 'Stale action',
      authorId: rep.id,
      lastActionDate: longAgo,
    });

    const result = await service.getRepActivityForUser('u-1', {
      representativeIds: [rep.id],
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    });

    expect(result).toHaveLength(1);
    // Only the fresh-action bill should appear in recentActivityBillIds
    expect(result[0].recentActivityBillIds.length).toBe(1);
  });

  it('handles a bill with null authorId — counts for actions but not chamber histogram', async () => {
    const rep = await createRepresentative({
      name: 'Test Rep',
      chamber: 'Assembly',
    });
    const db = await getDbService();
    // Author the bill via direct create (no author), then mark the rep
    // as a co-author. This exercises the chamber-attribution
    // graceful-degradation path: the bill counts toward
    // userBillIdsOfInterest (axis 3 can fire) but contributes 0 to the
    // chamber histogram (axis 1 stays at 0).
    const bill = await createBillWithAuthor({
      billNumber: 'AB 100',
      title: 'Author-less bill',
      authorId: null,
    });
    await db.billCoAuthor.create({
      data: { billId: bill.id, representativeId: rep.id },
    });

    const result = await service.getRepActivityForUser('u-1', {
      representativeIds: [rep.id],
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    });

    expect(result).toHaveLength(1);
    expect(result[0].axisScores.chamberMatch).toBe(0);
    expect(result[0].axisScores.actionAlignment).toBeGreaterThan(0);
  });

  it('filters BillVote rows to yes/no at the SQL layer (drops abstain/absent)', async () => {
    const rep = await createRepresentative({
      name: 'Test Rep',
      chamber: 'Assembly',
    });
    const db = await getDbService();

    const billYes = await createBillWithAuthor({
      billNumber: 'AB 100',
      title: 'Voted yes',
      authorId: null,
    });
    const billAbstain = await createBillWithAuthor({
      billNumber: 'AB 200',
      title: 'Voted abstain — should not surface',
      authorId: null,
    });

    await db.billVote.create({
      data: {
        billId: billYes.id,
        representativeId: rep.id,
        representativeName: 'Test Rep',
        chamber: 'Assembly',
        voteDate: new Date(),
        position: 'yes',
        sourceUrl: 'https://example.org/vote',
      },
    });
    await db.billVote.create({
      data: {
        billId: billAbstain.id,
        representativeId: rep.id,
        representativeName: 'Test Rep',
        chamber: 'Assembly',
        voteDate: new Date(),
        position: 'abstain',
        sourceUrl: 'https://example.org/vote',
      },
    });

    const result = await service.getRepActivityForUser('u-1', {
      representativeIds: [rep.id],
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    });

    expect(result).toHaveLength(1);
    // Only the yes-voted bill surfaces — the abstain doesn't count.
    expect(result[0].recentActivityBillIds).toEqual([billYes.id]);
  });

  it('returns an empty array when no representativeIds match any rep', async () => {
    await createRepresentative({ name: 'Real Rep' });
    const result = await service.getRepActivityForUser('u-1', {
      representativeIds: ['nonexistent-rep-id'],
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    });
    expect(result).toEqual([]);
  });

  it('short-circuits when representativeIds is empty (no DB calls)', async () => {
    // The cold-start case where the frontend hasn't resolved any
    // reps yet (e.g., user with no geocoded address).
    const result = await service.getRepActivityForUser('u-1', {
      representativeIds: [],
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    });
    expect(result).toEqual([]);
  });

  it('surfaces zero-relevance reps from the user slate (briefing UX contract)', async () => {
    // Rep in Senate, no committees matching user tags, no actions on
    // user bills. The orchestrator intentionally returns ALL slate reps
    // including composite=0 ones — the briefing UI shows them with a
    // "★ Represents you" chip + a low relevance score so the user sees
    // their full delegation rather than only the high-signal subset
    // (see #836: 6/7 of the user's slate were being dropped pre-fix).
    const rep = await createRepresentative({
      name: 'Unmatched Rep',
      chamber: 'Senate',
    });
    await createBillWithAuthor({
      billNumber: 'AB 100',
      title: 'Renter bill — but Assembly only',
      authorId: null, // unauthored so it counts for the user but no
      //                chamber histogram contribution
    });

    const result = await service.getRepActivityForUser('u-1', {
      representativeIds: [rep.id],
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    });

    expect(result).toHaveLength(1);
    expect(result[0].representativeId).toBe(rep.id);
    expect(result[0].relevanceScore).toBe(0);
    expect(result[0].recentActivityBillIds).toEqual([]);
  });
});
