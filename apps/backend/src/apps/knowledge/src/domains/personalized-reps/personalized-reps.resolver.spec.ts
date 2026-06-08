import { Test, TestingModule } from '@nestjs/testing';
import { PersonalizedRepsResolver } from './personalized-reps.resolver';
import { PersonalizedRepActivityService } from './personalized-rep-activity.service';
import type { GqlContext } from 'src/common/utils/graphql-context';
import type { RepPersonalizationInputDto } from './dto/rep-personalization-input.dto';

/**
 * Resolver-layer tests verify the auth-context routing — the contract
 * surface a future refactor could quietly break. Service is fully
 * mocked; its own logic is exhaustively covered in
 * personalized-rep-activity.service.spec.
 */
describe('PersonalizedRepsResolver', () => {
  let resolver: PersonalizedRepsResolver;
  let briefing: jest.Mocked<PersonalizedRepActivityService>;

  const ctx = (userId: string): GqlContext =>
    ({ req: { user: { id: userId } } }) as unknown as GqlContext;

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

  beforeEach(async () => {
    briefing = {
      getRepActivityForUser: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PersonalizedRepActivityService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizedRepsResolver,
        { provide: PersonalizedRepActivityService, useValue: briefing },
      ],
    }).compile();
    resolver = module.get(PersonalizedRepsResolver);
  });

  it('forwards the authenticated userId and input to the service', async () => {
    const input: RepPersonalizationInputDto = {
      representativeIds: ['r-1', 'r-2'],
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    };
    await resolver.getMyPersonalizedRepActivity(input, ctx('u-1'));

    expect(briefing.getRepActivityForUser).toHaveBeenCalledWith('u-1', input);
  });

  it('returns the service result unchanged', async () => {
    const result = [
      {
        representativeId: 'r-1',
        relevanceScore: 0.85,
        axisScores: {
          chamberMatch: 1.0,
          committeeMatch: 0.5,
          actionAlignment: 1.0,
          constituencyOverlap: 0,
          coalitionSignal: 0,
          counterfactual: 0,
          noveltyRepetition: 0,
        },
        recentActivityBillIds: ['b-1', 'b-2'],
      },
    ];
    briefing.getRepActivityForUser.mockResolvedValue(result as never);

    const out = await resolver.getMyPersonalizedRepActivity(
      {
        representativeIds: ['r-1'],
        interestTags: [],
        flags: FLAGS_OFF,
      },
      ctx('u-1'),
    );
    expect(out).toBe(result);
  });

  it('threads different user ids through correctly (no cross-user leak)', async () => {
    const input: RepPersonalizationInputDto = {
      representativeIds: ['r-1'],
      interestTags: [],
      flags: FLAGS_OFF,
    };
    await resolver.getMyPersonalizedRepActivity(input, ctx('u-A'));
    await resolver.getMyPersonalizedRepActivity(input, ctx('u-B'));

    expect(briefing.getRepActivityForUser).toHaveBeenNthCalledWith(
      1,
      'u-A',
      input,
    );
    expect(briefing.getRepActivityForUser).toHaveBeenNthCalledWith(
      2,
      'u-B',
      input,
    );
  });
});
