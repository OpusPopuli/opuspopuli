import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { PersonalizedRepActivityService } from './personalized-rep-activity.service';
import { RepRelevanceService } from './rep-relevance.service';
import { ScoringService } from '../personalized-feed/scoring.service';
import type { RepPersonalizationInputDto } from './dto/rep-personalization-input.dto';

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
 * Synthetic bill candidate row matching what Prisma's `findMany` returns
 * for the columns we select via BILL_CONTEXT_SELECT. Letting jest see
 * the actual shape (including the nested `author.chamber` from the
 * relation select) catches column-name drift between the SQL select
 * and the in-memory mapping.
 */
type BillRowOverride = {
  id?: string;
  lastActionDate?: Date | null;
  aiSummary?: unknown;
  author?: { chamber: string } | null;
};

const billRow = (overrides: BillRowOverride = {}) => ({
  id: 'b-1',
  lastActionDate: new Date('2026-05-01T00:00:00Z'),
  aiSummary: { topics: ['housing'], whoItAffects: ['renters'] },
  author: { chamber: 'Assembly' },
  ...overrides,
});

/**
 * Synthetic rep row matching what Prisma `findMany` returns with the
 * include shape from `buildRepInclude`. The defaults represent a rep
 * with no committees / authorships / co-authorships / votes — tests
 * layer in only what they exercise.
 */
type RepRowOverride = {
  id?: string;
  chamber?: string;
  committeeAssignments?: { committee: { name: string } }[];
  authoredBills?: { id: string }[];
  billCoAuthorships?: { billId: string }[];
  billVotes?: { billId: string; position: string }[];
};

const repRow = (overrides: RepRowOverride = {}) => ({
  id: 'r-1',
  chamber: 'Assembly',
  committeeAssignments: [] as { committee: { name: string } }[],
  authoredBills: [] as { id: string }[],
  billCoAuthorships: [] as { billId: string }[],
  billVotes: [] as { billId: string; position: string }[],
  ...overrides,
});

describe('PersonalizedRepActivityService', () => {
  let service: PersonalizedRepActivityService;
  let db: {
    bill: { findMany: jest.Mock };
    representative: { findMany: jest.Mock };
  };

  const baseInput = (
    overrides: Partial<RepPersonalizationInputDto> = {},
  ): RepPersonalizationInputDto => ({
    representativeIds: ['r-1'],
    interestTags: [],
    flags: FLAGS_OFF,
    ...overrides,
  });

  beforeEach(async () => {
    db = {
      bill: { findMany: jest.fn().mockResolvedValue([]) },
      representative: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizedRepActivityService,
        RepRelevanceService,
        ScoringService,
        { provide: DbService, useValue: db },
      ],
    }).compile();

    service = module.get(PersonalizedRepActivityService);
  });

  it('returns an empty array when no representativeIds are passed', async () => {
    const result = await service.getRepActivityForUser(
      'u-1',
      baseInput({
        representativeIds: [],
      }),
    );
    expect(result).toEqual([]);
    expect(db.bill.findMany).not.toHaveBeenCalled();
    expect(db.representative.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty array when no reps match', async () => {
    db.representative.findMany.mockResolvedValueOnce([]);
    const result = await service.getRepActivityForUser('u-1', baseInput());
    expect(result).toEqual([]);
  });

  it('drops zero-relevance reps and sorts surviving reps by composite desc', async () => {
    // Rep A: in Assembly with the user's bills, authored b-1 → high score
    // Rep B: in Senate with no user bills, no committees, no actions → zero
    db.bill.findMany.mockResolvedValueOnce([
      billRow({ id: 'b-1', author: { chamber: 'Assembly' } }),
    ]);
    db.representative.findMany.mockResolvedValueOnce([
      repRow({
        id: 'r-A',
        chamber: 'Assembly',
        committeeAssignments: [{ committee: { name: 'Housing' } }],
        authoredBills: [{ id: 'b-1' }],
      }),
      repRow({ id: 'r-B', chamber: 'Senate' }),
    ]);
    const result = await service.getRepActivityForUser(
      'u-1',
      baseInput({
        representativeIds: ['r-A', 'r-B'],
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      }),
    );
    expect(result.length).toBe(1);
    expect(result[0].representativeId).toBe('r-A');
    expect(result[0].relevanceScore).toBeGreaterThan(0);
  });

  it('orders results by composite score descending', async () => {
    db.bill.findMany.mockResolvedValueOnce([
      billRow({ id: 'b-1', author: { chamber: 'Assembly' } }),
      billRow({ id: 'b-2', author: { chamber: 'Assembly' } }),
    ]);
    // r-strong: authored both b-1 and b-2 (2× author)
    // r-mid: voted yes on b-1 (1× voteYes)
    db.representative.findMany.mockResolvedValueOnce([
      repRow({
        id: 'r-mid',
        chamber: 'Assembly',
        billVotes: [{ billId: 'b-1', position: 'yes' }],
      }),
      repRow({
        id: 'r-strong',
        chamber: 'Assembly',
        authoredBills: [{ id: 'b-1' }, { id: 'b-2' }],
      }),
    ]);
    const result = await service.getRepActivityForUser(
      'u-1',
      baseInput({
        representativeIds: ['r-mid', 'r-strong'],
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      }),
    );
    expect(result.map((r) => r.representativeId)).toEqual([
      'r-strong',
      'r-mid',
    ]);
    expect(result[0].relevanceScore).toBeGreaterThan(result[1].relevanceScore);
  });

  it('maps vote positions to voteYes/voteNo and drops other positions', async () => {
    // Bills b-yes and b-no are user-relevant. r-1 votes yes on b-yes and
    // no on b-no. The orchestrator should surface both as recent activity
    // (voteYes weight 0.4, voteNo weight 0.2 — both register on axis 3).
    db.bill.findMany.mockResolvedValueOnce([
      billRow({ id: 'b-yes', author: { chamber: 'Assembly' } }),
      billRow({ id: 'b-no', author: { chamber: 'Assembly' } }),
    ]);
    db.representative.findMany.mockResolvedValueOnce([
      repRow({
        id: 'r-1',
        chamber: 'Assembly',
        billVotes: [
          { billId: 'b-yes', position: 'yes' },
          { billId: 'b-no', position: 'no' },
        ],
      }),
    ]);
    const result = await service.getRepActivityForUser(
      'u-1',
      baseInput({
        representativeIds: ['r-1'],
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      }),
    );
    expect(result.length).toBe(1);
    expect(result[0].recentActivityBillIds).toEqual(
      expect.arrayContaining(['b-yes', 'b-no']),
    );
  });

  it('flattens committee assignments into committeeNames', async () => {
    db.bill.findMany.mockResolvedValueOnce([
      billRow({ id: 'b-1', author: { chamber: 'Assembly' } }),
    ]);
    db.representative.findMany.mockResolvedValueOnce([
      repRow({
        id: 'r-1',
        chamber: 'Assembly',
        committeeAssignments: [
          { committee: { name: 'Housing and Community Development' } },
          { committee: { name: 'Transportation' } },
        ],
      }),
    ]);
    const result = await service.getRepActivityForUser(
      'u-1',
      baseInput({
        representativeIds: ['r-1'],
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      }),
    );
    // Half of r-1's committees match "housing" → committeeMatch = 0.5
    expect(result[0].axisScores.committeeMatch).toBeCloseTo(0.5, 5);
  });

  it('always zeros axes 4-7 (v1.1 placeholders)', async () => {
    db.bill.findMany.mockResolvedValueOnce([
      billRow({ id: 'b-1', author: { chamber: 'Assembly' } }),
    ]);
    db.representative.findMany.mockResolvedValueOnce([
      repRow({
        id: 'r-1',
        chamber: 'Assembly',
        authoredBills: [{ id: 'b-1' }],
      }),
    ]);
    const result = await service.getRepActivityForUser(
      'u-1',
      baseInput({
        representativeIds: ['r-1'],
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      }),
    );
    expect(result[0].axisScores.constituencyOverlap).toBe(0);
    expect(result[0].axisScores.coalitionSignal).toBe(0);
    expect(result[0].axisScores.counterfactual).toBe(0);
    expect(result[0].axisScores.noveltyRepetition).toBe(0);
  });

  it('caps recentActivityBillIds at 3 (briefing card tag limit)', async () => {
    db.bill.findMany.mockResolvedValueOnce([
      billRow({ id: 'b-1', author: { chamber: 'Assembly' } }),
      billRow({ id: 'b-2', author: { chamber: 'Assembly' } }),
      billRow({ id: 'b-3', author: { chamber: 'Assembly' } }),
      billRow({ id: 'b-4', author: { chamber: 'Assembly' } }),
      billRow({ id: 'b-5', author: { chamber: 'Assembly' } }),
    ]);
    db.representative.findMany.mockResolvedValueOnce([
      repRow({
        id: 'r-1',
        chamber: 'Assembly',
        authoredBills: [
          { id: 'b-1' },
          { id: 'b-2' },
          { id: 'b-3' },
          { id: 'b-4' },
          { id: 'b-5' },
        ],
      }),
    ]);
    const result = await service.getRepActivityForUser(
      'u-1',
      baseInput({
        representativeIds: ['r-1'],
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      }),
    );
    expect(result[0].recentActivityBillIds.length).toBeLessThanOrEqual(3);
  });

  it('skips bills with missing or skip-flagged aiSummary when building context', async () => {
    // Three rows: one good, one `{skip: true}`, one null aiSummary.
    // Only the good row should populate `userBillIdsOfInterest`.
    db.bill.findMany.mockResolvedValueOnce([
      billRow({ id: 'b-good', author: { chamber: 'Assembly' } }),
      billRow({ id: 'b-skip', aiSummary: { skip: true } }),
      billRow({ id: 'b-null', aiSummary: null }),
    ]);
    db.representative.findMany.mockResolvedValueOnce([
      repRow({
        id: 'r-1',
        chamber: 'Assembly',
        authoredBills: [{ id: 'b-good' }, { id: 'b-skip' }, { id: 'b-null' }],
      }),
    ]);
    const result = await service.getRepActivityForUser(
      'u-1',
      baseInput({
        representativeIds: ['r-1'],
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      }),
    );
    // Only b-good is in `userBillIdsOfInterest`, so only it surfaces.
    expect(result[0].recentActivityBillIds).toEqual(['b-good']);
  });

  it('drops bills with unresolved author from chamber histogram (still counts in bills-of-interest)', async () => {
    // b-orphan has no author resolved — its content still scores for the
    // user, so it counts as bills-of-interest, but it can't contribute to
    // any chamber histogram. r-1's authorship on it still feeds axis 3.
    db.bill.findMany.mockResolvedValueOnce([
      billRow({ id: 'b-orphan', author: null }),
    ]);
    db.representative.findMany.mockResolvedValueOnce([
      repRow({
        id: 'r-1',
        chamber: 'Assembly',
        authoredBills: [{ id: 'b-orphan' }],
      }),
    ]);
    const result = await service.getRepActivityForUser(
      'u-1',
      baseInput({
        representativeIds: ['r-1'],
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      }),
    );
    // chamberMatch is 0 (no chambers in histogram) but actionAlignment > 0
    expect(result[0].axisScores.chamberMatch).toBe(0);
    expect(result[0].axisScores.actionAlignment).toBeGreaterThan(0);
  });

  it('passes the 180-day recency window to the rep findMany query', async () => {
    db.bill.findMany.mockResolvedValueOnce([]);
    db.representative.findMany.mockResolvedValueOnce([]);
    await service.getRepActivityForUser('u-1', baseInput());
    const call = db.representative.findMany.mock.calls[0][0];
    // include should carry recency-window filters on the bill-relation tables
    expect(call.include.authoredBills.where.lastActionDate.gte).toBeInstanceOf(
      Date,
    );
    expect(call.include.billVotes.where.voteDate.gte).toBeInstanceOf(Date);
    expect(call.include.billVotes.where.position.in).toEqual(['yes', 'no']);
    // The window should be approximately 180 days ago
    const windowStart =
      call.include.authoredBills.where.lastActionDate.gte.getTime();
    const expectedMin = Date.now() - 181 * 24 * 60 * 60 * 1000;
    const expectedMax = Date.now() - 179 * 24 * 60 * 60 * 1000;
    expect(windowStart).toBeGreaterThan(expectedMin);
    expect(windowStart).toBeLessThan(expectedMax);
  });
});
