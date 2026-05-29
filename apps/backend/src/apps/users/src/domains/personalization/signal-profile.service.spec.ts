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

  it('upsert preserves explicit null so individual fields can be cleared (#752)', async () => {
    db.signalProfile.upsert.mockResolvedValue({ id: 'sp-1' } as never);

    // The model-of-me page sends `{ field: null }` from the
    // "Clear value" affordance. Prisma converts null to SQL NULL,
    // clearing the column. If the upsert merge silently drops nulls
    // (treating them as "no change"), the clear-field UI lies.
    await service.upsert('u-1', { housingTenure: null });

    const call = db.signalProfile.upsert.mock.calls[0][0];
    expect(call.update).toEqual({ housingTenure: null });
    // The create branch should also propagate the explicit null —
    // not coerce it back to a defaulted value.
    expect(call.create.housingTenure).toBeNull();
  });

  it('upsert create branch seeds NOT NULL array columns with [] so partial inputs do not violate the constraint', async () => {
    db.signalProfile.upsert.mockResolvedValue({ id: 'sp-1' } as never);

    // First-time onboarding submits only interestTags — every other
    // array column on SignalProfile must still receive [] or the
    // Postgres NOT NULL constraint trips on create.
    await service.upsert('u-1', { interestTags: ['housing'] });

    const call = db.signalProfile.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({
      interestTags: ['housing'],
      taxExposure: [],
      housingFlags: [],
      childrenAgeBands: [],
      vehicleTypes: [],
      specialLicenses: [],
      parentOfStudent: [],
      trustedOrganizations: [],
      accessibilityNeeds: [],
      user: { connect: { id: 'u-1' } },
    });
  });

  it('upsert create branch resists undefined array values from class-validator DTOs', async () => {
    db.signalProfile.upsert.mockResolvedValue({ id: 'sp-1' } as never);

    // class-validator instantiates the DTO with every optional field
    // present and set to `undefined`. Prisma converts `undefined` to
    // NULL on the wire, so the defaults must survive the spread.
    await service.upsert('u-1', {
      interestTags: ['housing'],
      taxExposure: undefined,
      housingFlags: undefined,
      childrenAgeBands: undefined,
      vehicleTypes: undefined,
      specialLicenses: undefined,
      parentOfStudent: undefined,
      trustedOrganizations: undefined,
      accessibilityNeeds: undefined,
    });

    const call = db.signalProfile.upsert.mock.calls[0][0];
    expect(call.create.interestTags).toEqual(['housing']);
    expect(call.create.taxExposure).toEqual([]);
    expect(call.create.housingFlags).toEqual([]);
    expect(call.create.childrenAgeBands).toEqual([]);
    expect(call.create.vehicleTypes).toEqual([]);
    expect(call.create.specialLicenses).toEqual([]);
    expect(call.create.parentOfStudent).toEqual([]);
    expect(call.create.trustedOrganizations).toEqual([]);
    expect(call.create.accessibilityNeeds).toEqual([]);
  });
});
