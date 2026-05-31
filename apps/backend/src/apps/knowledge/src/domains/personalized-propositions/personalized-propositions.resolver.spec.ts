import { Test, TestingModule } from '@nestjs/testing';
import { PersonalizedPropositionsResolver } from './personalized-propositions.resolver';
import {
  PersonalizedPropositionsService,
  PROPOSITION_FEED_DEFAULT_LIMIT,
} from './personalized-propositions.service';
import type { GqlContext } from 'src/common/utils/graphql-context';
import type { PropositionPersonalizationInputDto } from './dto/proposition-personalization-input.dto';

/**
 * Resolver-layer tests verify the auth-context routing and the
 * limit-default branch — the contract surface a future refactor
 * could quietly break. Service is fully mocked; its own logic is
 * exhaustively covered in personalized-propositions.service.spec.
 */
describe('PersonalizedPropositionsResolver', () => {
  let resolver: PersonalizedPropositionsResolver;
  let feed: jest.Mocked<PersonalizedPropositionsService>;

  const ctx = (userId: string): GqlContext =>
    ({ req: { user: { id: userId } } }) as unknown as GqlContext;

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

  beforeEach(async () => {
    feed = {
      getFeedForUser: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PersonalizedPropositionsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizedPropositionsResolver,
        { provide: PersonalizedPropositionsService, useValue: feed },
      ],
    }).compile();
    resolver = module.get(PersonalizedPropositionsResolver);
  });

  it('forwards the authenticated userId, input, and limit to the service', async () => {
    const input = {
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    };
    await resolver.getMyPersonalizedPropositionFeed(input, 7, ctx('u-1'));

    expect(feed.getFeedForUser).toHaveBeenCalledWith('u-1', input, 7);
  });

  it('applies PROPOSITION_FEED_DEFAULT_LIMIT when caller omits the limit arg', async () => {
    const input = { interestTags: [], flags: FLAGS_OFF };
    await resolver.getMyPersonalizedPropositionFeed(
      input,
      undefined,
      ctx('u-1'),
    );

    expect(feed.getFeedForUser).toHaveBeenCalledWith(
      'u-1',
      input,
      PROPOSITION_FEED_DEFAULT_LIMIT,
    );
  });

  it('returns the service result unchanged', async () => {
    const result = [
      {
        propositionId: 'p-1',
        relevanceScore: 0.6,
        axisScores: {
          directMaterial: 0.2,
          valuesAlignment: 1.0,
          actionability: 1.0,
          indirectMaterial: 0,
          coalitionSignal: 0,
          counterfactual: 0,
          noveltyRepetition: 0,
        },
      },
    ];
    feed.getFeedForUser.mockResolvedValue(result as never);

    const out = await resolver.getMyPersonalizedPropositionFeed(
      { interestTags: [], flags: FLAGS_OFF },
      5,
      ctx('u-1'),
    );
    expect(out).toBe(result);
  });

  it('threads different user ids through correctly (no cross-user leak)', async () => {
    const input = { interestTags: [], flags: FLAGS_OFF };
    await resolver.getMyPersonalizedPropositionFeed(input, 5, ctx('u-A'));
    await resolver.getMyPersonalizedPropositionFeed(input, 5, ctx('u-B'));

    expect(feed.getFeedForUser).toHaveBeenNthCalledWith(1, 'u-A', input, 5);
    expect(feed.getFeedForUser).toHaveBeenNthCalledWith(2, 'u-B', input, 5);
  });
});
