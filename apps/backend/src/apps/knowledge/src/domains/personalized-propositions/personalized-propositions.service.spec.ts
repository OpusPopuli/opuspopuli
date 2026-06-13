import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  PersonalizedPropositionsService,
  PROPOSITION_FEED_DEFAULT_LIMIT,
  PROPOSITION_FEED_MAX_LIMIT,
} from './personalized-propositions.service';
import { PropositionScoringService } from './proposition-scoring.service';
import type { PropositionPersonalizationInputDto } from './dto/proposition-personalization-input.dto';

const FLAGS_OFF: PropositionPersonalizationInputDto['flags'] = {
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
 * Synthetic proposition row matching what Prisma's `findMany` returns
 * for the columns we select. Letting jest see the actual shape catches
 * column-name drift between the SQL select and the in-memory mapping.
 *
 * NB: the proposition schema has AI-extracted fields as FLAT columns,
 * not an `aiSummary` JSON column like bills. The `keyProvisions` /
 * `existingVsProposed` / `analysisSections` columns are JSONB and can
 * carry strings, arrays, or nested objects — the service flattens
 * them via `stringLeaves` so test fixtures should pass realistic shapes.
 */
type PropRowInput = {
  id?: string;
  summary?: string;
  electionDate?: Date;
  analysisSummary?: string | null;
  keyProvisions?: unknown;
  fiscalImpact?: string | null;
  yesOutcome?: string | null;
  noOutcome?: string | null;
  existingVsProposed?: unknown;
  analysisSections?: unknown;
};

const propRow = (overrides: PropRowInput = {}) => ({
  id: 'p-1',
  summary: '',
  electionDate: new Date('2026-11-03T00:00:00Z'),
  analysisSummary: null,
  keyProvisions: null,
  fiscalImpact: null,
  yesOutcome: null,
  noOutcome: null,
  existingVsProposed: null,
  analysisSections: null,
  ...overrides,
});

describe('PersonalizedPropositionsService', () => {
  let service: PersonalizedPropositionsService;
  let db: {
    proposition: { findMany: jest.Mock };
    propositionRelevanceCache: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    db = {
      proposition: { findMany: jest.fn() },
      // Default to empty cache — the explanation field stays undefined
      // unless a test explicitly seeds the cache (mirrors the day-one
      // user case before the nightly batch runs).
      propositionRelevanceCache: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizedPropositionsService,
        PropositionScoringService,
        { provide: DbService, useValue: db },
      ],
    }).compile();

    service = module.get(PersonalizedPropositionsService);
  });

  it('returns an empty array when no propositions are active', async () => {
    db.proposition.findMany.mockResolvedValue([]);
    const out = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: { ...FLAGS_OFF, isRenter: true } },
      5,
    );
    expect(out).toEqual([]);
  });

  it('drops zero-relevance propositions so the feed never pads with garbage', async () => {
    db.proposition.findMany.mockResolvedValue([
      propRow({
        id: 'unrelated',
        summary: 'Statewide bond issue for completely unrelated topic',
      }),
    ]);
    const out = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: { ...FLAGS_OFF, isRenter: true } },
      5,
    );
    expect(out).toEqual([]);
  });

  it('returns scored props sorted by composite desc', async () => {
    db.proposition.findMany.mockResolvedValue([
      propRow({
        id: 'p-lowmatch',
        summary: 'mentions housing only',
        electionDate: new Date('2027-06-01T00:00:00Z'), // far out
      }),
      propRow({
        id: 'p-highmatch',
        summary: 'protects renters and housing affordability',
        analysisSummary: 'Caps rent increases statewide.',
        electionDate: new Date(Date.now() + 14 * 86_400_000), // 14d out (urgent)
      }),
    ]);

    const out = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: { ...FLAGS_OFF, isRenter: true } },
      5,
    );

    expect(out).toHaveLength(2);
    expect(out[0].propositionId).toBe('p-highmatch');
    expect(out[1].propositionId).toBe('p-lowmatch');
    expect(out[0].relevanceScore).toBeGreaterThan(out[1].relevanceScore);
  });

  it('honors the requested limit', async () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      propRow({
        id: `p-${i}`,
        summary: 'housing',
        electionDate: new Date(Date.now() + (10 + i) * 86_400_000),
      }),
    );
    db.proposition.findMany.mockResolvedValue(rows);

    const out = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      3,
    );
    expect(out).toHaveLength(3);
  });

  it('falls back to the default limit when requestedLimit is 0 or negative', async () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      propRow({
        id: `p-${i}`,
        summary: 'housing',
        electionDate: new Date(Date.now() + (10 + i) * 86_400_000),
      }),
    );
    db.proposition.findMany.mockResolvedValue(rows);

    const out = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      0,
    );
    expect(out).toHaveLength(PROPOSITION_FEED_DEFAULT_LIMIT);
  });

  it('clamps to PROPOSITION_FEED_MAX_LIMIT regardless of caller', async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      propRow({
        id: `p-${i}`,
        summary: 'housing',
        electionDate: new Date(Date.now() + (10 + i) * 86_400_000),
      }),
    );
    db.proposition.findMany.mockResolvedValue(rows);

    const out = await service.getFeedForUser(
      'u-1',
      { interestTags: ['housing'], flags: FLAGS_OFF },
      1_000,
    );
    expect(out).toHaveLength(PROPOSITION_FEED_MAX_LIMIT);
  });

  it('filters at the SQL layer — only active/pending props with future electionDate, not soft-deleted', async () => {
    db.proposition.findMany.mockResolvedValue([]);
    await service.getFeedForUser(
      'u-1',
      { interestTags: [], flags: FLAGS_OFF },
      5,
    );
    const where = db.proposition.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.status.in).toEqual(['active', 'pending']);
    expect(where.electionDate.gte).toBeInstanceOf(Date);
  });

  it('flattens text from multiple analysis columns into the searchable corpus', async () => {
    db.proposition.findMany.mockResolvedValue([
      propRow({
        id: 'p-multi',
        summary: 'Housing affordability act',
        analysisSummary: 'Caps rent increases.',
        // keyProvisions JSONB carries an array of bullets here.
        keyProvisions: ['Includes protections for renters.'],
        fiscalImpact: '$2B annually.',
        // nested JSON should still get its string leaves walked:
        existingVsProposed: {
          current: 'No statewide cap.',
          proposed: 'New annual cap of 5%.',
        },
        electionDate: new Date(Date.now() + 14 * 86_400_000),
      }),
    ]);

    // user's flag matches "renters" in keyProvisions (case-insensitive)
    // → axis 1 should fire
    const out = await service.getFeedForUser(
      'u-1',
      { interestTags: [], flags: { ...FLAGS_OFF, isRenter: true } },
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0].axisScores.directMaterial).toBeGreaterThan(0);
  });

  it('handles propositions with all-null analysis columns by reading only the summary', async () => {
    db.proposition.findMany.mockResolvedValue([
      propRow({
        id: 'p-bare',
        summary: 'Allows renters to vote on rent control.',
        electionDate: new Date(Date.now() + 14 * 86_400_000),
      }),
    ]);
    const out = await service.getFeedForUser(
      'u-1',
      { interestTags: [], flags: { ...FLAGS_OFF, isRenter: true } },
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0].axisScores.directMaterial).toBeGreaterThan(0);
  });

  it('ignores non-string JSON leaves (numbers, booleans, dates) when walking keyProvisions', async () => {
    db.proposition.findMany.mockResolvedValue([
      propRow({
        id: 'p-mixed',
        summary: 'Property tax measure for homeowners',
        // mix of strings + non-strings; only strings get into the corpus
        keyProvisions: [
          'Affects homeowners statewide.',
          {
            caveat: 'Subject to legislative review.',
            priority: 1,
            active: true,
          },
        ],
        electionDate: new Date(Date.now() + 14 * 86_400_000),
      }),
    ]);
    const out = await service.getFeedForUser(
      'u-1',
      { interestTags: [], flags: { ...FLAGS_OFF, isHomeowner: true } },
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0].axisScores.directMaterial).toBeGreaterThan(0);
  });
});
