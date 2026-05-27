import { Test, TestingModule } from '@nestjs/testing';
import { PersonalizedFeedResolver } from './personalized-feed.resolver';
import {
  FEED_DEFAULT_LIMIT,
  PersonalizedFeedService,
} from './personalized-feed.service';
import type { GqlContext } from 'src/common/utils/graphql-context';
import type { PersonalizationInputDto } from './dto/personalization-input.dto';

/**
 * Resolver-layer tests verify the auth-context routing and the
 * limit-default branch — i.e. the contract surface a future refactor
 * could quietly break. The service is fully mocked; its own logic is
 * exhaustively covered in personalized-feed.service.spec.
 */
describe('PersonalizedFeedResolver', () => {
  let resolver: PersonalizedFeedResolver;
  let feed: jest.Mocked<PersonalizedFeedService>;

  const ctx = (userId: string): GqlContext =>
    ({ req: { user: { id: userId } } }) as unknown as GqlContext;

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

  beforeEach(async () => {
    feed = {
      getFeedForUser: jest.fn(),
    } as unknown as jest.Mocked<PersonalizedFeedService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizedFeedResolver,
        { provide: PersonalizedFeedService, useValue: feed },
      ],
    }).compile();
    resolver = module.get(PersonalizedFeedResolver);
  });

  it('forwards the authenticated userId, input, and limit to the service', async () => {
    feed.getFeedForUser.mockResolvedValue([] as never);

    const input = {
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    };
    await resolver.getMyPersonalizedBillFeed(input, 10, ctx('u-1'));

    expect(feed.getFeedForUser).toHaveBeenCalledWith('u-1', input, 10);
  });

  it('applies FEED_DEFAULT_LIMIT when caller omits the limit arg', async () => {
    feed.getFeedForUser.mockResolvedValue([] as never);

    const input = { interestTags: [], flags: FLAGS_OFF };
    await resolver.getMyPersonalizedBillFeed(input, undefined, ctx('u-1'));

    expect(feed.getFeedForUser).toHaveBeenCalledWith(
      'u-1',
      input,
      FEED_DEFAULT_LIMIT,
    );
  });

  it('returns the service result unchanged', async () => {
    const result = [
      {
        billId: 'b-1',
        relevanceScore: 0.85,
        axisScores: {
          directMaterial: 0.6,
          valuesAlignment: 1.0,
          actionability: 0.5,
          indirectMaterial: 0,
          coalitionSignal: 0,
          counterfactual: 0,
          noveltyRepetition: 0,
        },
      },
    ];
    feed.getFeedForUser.mockResolvedValue(result as never);

    const out = await resolver.getMyPersonalizedBillFeed(
      { interestTags: [], flags: FLAGS_OFF },
      5,
      ctx('u-1'),
    );
    expect(out).toBe(result);
  });
});
