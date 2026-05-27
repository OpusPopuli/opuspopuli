import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  createMockDbService,
  type MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';
import { SignalProfileService } from './signal-profile.service';

describe('SignalProfileService', () => {
  let service: SignalProfileService;
  let db: MockDbClient;

  beforeEach(async () => {
    db = createMockDbService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [SignalProfileService, { provide: DbService, useValue: db }],
    }).compile();
    service = module.get(SignalProfileService);
  });

  it('returns null when no row exists', async () => {
    db.signalProfile.findUnique.mockResolvedValue(null);
    const result = await service.getByUserId('u-1');
    expect(result).toBeNull();
  });

  it('returns the row when one exists', async () => {
    const row = {
      id: 'sp-1',
      userId: 'u-1',
      interestTags: ['housing'],
    } as never;
    db.signalProfile.findUnique.mockResolvedValue(row);
    const result = await service.getByUserId('u-1');
    expect(result).toBe(row);
    expect(db.signalProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
    });
  });

  it('upsert passes the user.connect relation form on create', async () => {
    const row = { id: 'sp-1', userId: 'u-1' } as never;
    db.signalProfile.upsert.mockResolvedValue(row);

    await service.upsert('u-1', { interestTags: { set: ['housing'] } });

    // Verify the upsert is shaped per Prisma's CreateInput form
    // (user.connect, not scalar userId — see service comment).
    const call = db.signalProfile.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'u-1' });
    expect(call.create).toMatchObject({
      user: { connect: { id: 'u-1' } },
    });
  });

  it('upsert update branch passes the input through verbatim', async () => {
    db.signalProfile.upsert.mockResolvedValue({ id: 'sp-1' } as never);
    await service.upsert('u-1', { housingTenure: 'renter' });

    const call = db.signalProfile.upsert.mock.calls[0][0];
    expect(call.update).toEqual({ housingTenure: 'renter' });
  });
});
