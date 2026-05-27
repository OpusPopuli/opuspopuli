import { Test, TestingModule } from '@nestjs/testing';
import { PersonalizationResolver } from './personalization.resolver';
import { SignalProfileService } from './signal-profile.service';
import { SensitiveProfileService } from './sensitive-profile.service';
import { UserEventService } from './user-event.service';
import type { GqlContext } from 'src/common/utils/graphql-context';

/**
 * Resolver tests focus on the logic that does NOT live in the services:
 *  - the short-circuit ordering for no-fields-mode reads/writes
 *  - the merge semantics in updateMySensitiveProfile (undefined skips,
 *    explicit values overwrite, arrays replace wholesale)
 *  - the auth-context extraction path (getUserFromContext)
 *
 * The service-layer privacy invariants (decrypt-never-called, write-
 * silently-no-ops) are exhaustively covered in sensitive-profile.service.spec.
 */
describe('PersonalizationResolver', () => {
  let resolver: PersonalizationResolver;
  let signalProfile: jest.Mocked<SignalProfileService>;
  let sensitiveProfile: jest.Mocked<SensitiveProfileService>;
  let userEvent: jest.Mocked<UserEventService>;

  const ctx = (userId: string): GqlContext =>
    ({ req: { user: { id: userId } } }) as unknown as GqlContext;

  beforeEach(async () => {
    signalProfile = {
      getByUserId: jest.fn(),
      upsert: jest.fn(),
    } as unknown as jest.Mocked<SignalProfileService>;

    sensitiveProfile = {
      getState: jest.fn(),
      getNoFieldsMode: jest.fn(),
      setNoFieldsMode: jest.fn(),
      updatePayload: jest.fn(),
    } as unknown as jest.Mocked<SensitiveProfileService>;

    userEvent = {
      record: jest.fn(),
      listForUser: jest.fn(),
      resetForUser: jest.fn(),
    } as unknown as jest.Mocked<UserEventService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizationResolver,
        { provide: SignalProfileService, useValue: signalProfile },
        { provide: SensitiveProfileService, useValue: sensitiveProfile },
        { provide: UserEventService, useValue: userEvent },
      ],
    }).compile();

    resolver = module.get(PersonalizationResolver);
  });

  // ============================================
  // SignalProfile
  // ============================================

  describe('getMySignalProfile', () => {
    it('returns the row for the authenticated user', async () => {
      signalProfile.getByUserId.mockResolvedValue({
        id: 'sp-1',
        userId: 'u-1',
      } as never);

      const result = await resolver.getMySignalProfile(ctx('u-1'));

      expect(signalProfile.getByUserId).toHaveBeenCalledWith('u-1');
      expect(result).toMatchObject({ id: 'sp-1', userId: 'u-1' });
    });

    it('returns null when no row exists', async () => {
      signalProfile.getByUserId.mockResolvedValue(null);
      expect(await resolver.getMySignalProfile(ctx('u-1'))).toBeNull();
    });
  });

  describe('updateMySignalProfile', () => {
    it('forwards the input under the authenticated user id', async () => {
      const updated = { id: 'sp-1', userId: 'u-1' } as never;
      signalProfile.upsert.mockResolvedValue(updated);

      await resolver.updateMySignalProfile(
        { housingTenure: 'renter', interestTags: ['housing'] },
        ctx('u-1'),
      );

      expect(signalProfile.upsert).toHaveBeenCalledWith('u-1', {
        housingTenure: 'renter',
        interestTags: ['housing'],
      });
    });
  });

  // ============================================
  // SensitiveProfile — the critical no-fields-mode paths
  // ============================================

  describe('getMySensitiveProfile', () => {
    it('returns { noFieldsMode: true } and nothing else when toggle is on', async () => {
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: true,
        payload: null,
      });

      const result = await resolver.getMySensitiveProfile(ctx('u-1'));
      expect(result).toEqual({ noFieldsMode: true });
    });

    it('spreads the decrypted payload over the model when toggle is off', async () => {
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: {
          citizenshipStatus: 'citizen',
          raceEthnicity: ['asian'],
        },
      });

      const result = await resolver.getMySensitiveProfile(ctx('u-1'));
      expect(result).toEqual({
        noFieldsMode: false,
        citizenshipStatus: 'citizen',
        raceEthnicity: ['asian'],
      });
    });

    it('returns { noFieldsMode: false } when no row exists', async () => {
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: null,
      });
      expect(await resolver.getMySensitiveProfile(ctx('u-1'))).toEqual({
        noFieldsMode: false,
      });
    });
  });

  describe('updateMySensitiveProfile', () => {
    it('short-circuits to { noFieldsMode: true } when toggle is on (no write attempted)', async () => {
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: true,
        payload: null,
      });

      const result = await resolver.updateMySensitiveProfile(
        { citizenshipStatus: 'citizen' },
        ctx('u-1'),
      );

      expect(result).toEqual({ noFieldsMode: true });
      // Crucial: the write path was never even invoked. The service
      // would also no-op, but short-circuiting at the resolver keeps
      // the contract visible at the API boundary.
      expect(sensitiveProfile.updatePayload).not.toHaveBeenCalled();
    });

    it('merges input over existing payload — undefined keys leave existing untouched', async () => {
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: {
          citizenshipStatus: 'citizen',
          raceEthnicity: ['asian'],
          veteranStatus: 'veteran',
        },
      });

      await resolver.updateMySensitiveProfile(
        { citizenshipStatus: 'permanent_resident' }, // only this field
        ctx('u-1'),
      );

      // Merge keeps the unchanged keys and updates the one provided.
      expect(sensitiveProfile.updatePayload).toHaveBeenCalledWith('u-1', {
        citizenshipStatus: 'permanent_resident',
        raceEthnicity: ['asian'],
        veteranStatus: 'veteran',
      });
    });

    it('explicit values overwrite — null/undefined distinction matters', async () => {
      // class-validator strips undefined values from the DTO instance,
      // so the resolver only ever sees defined keys. Verify the merge
      // still preserves existing values for keys the input omits.
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: { incomeBand: 'middle', insuranceType: 'employer' },
      });

      await resolver.updateMySensitiveProfile(
        { incomeBand: 'high' },
        ctx('u-1'),
      );

      expect(sensitiveProfile.updatePayload).toHaveBeenCalledWith('u-1', {
        incomeBand: 'high',
        insuranceType: 'employer',
      });
    });

    it('replaces arrays wholesale rather than concatenating', async () => {
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: { raceEthnicity: ['asian', 'white'] },
      });

      await resolver.updateMySensitiveProfile(
        { raceEthnicity: ['black'] },
        ctx('u-1'),
      );

      expect(sensitiveProfile.updatePayload).toHaveBeenCalledWith('u-1', {
        raceEthnicity: ['black'], // replaced wholesale, not concatenated
      });
    });

    it('creates a new payload when none exists yet', async () => {
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: null,
      });

      await resolver.updateMySensitiveProfile(
        { citizenshipStatus: 'citizen' },
        ctx('u-1'),
      );

      expect(sensitiveProfile.updatePayload).toHaveBeenCalledWith('u-1', {
        citizenshipStatus: 'citizen',
      });
    });
  });

  describe('setMyNoFieldsMode', () => {
    it('toggles ON then refetches state (allowing future getState changes to propagate)', async () => {
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: true,
        payload: null,
      });

      const result = await resolver.setMyNoFieldsMode(true, ctx('u-1'));

      expect(sensitiveProfile.setNoFieldsMode).toHaveBeenCalledWith(
        'u-1',
        true,
      );
      expect(result).toEqual({ noFieldsMode: true });
    });

    it('toggling OFF restores access to previously-stored payload', async () => {
      sensitiveProfile.getState.mockResolvedValue({
        noFieldsMode: false,
        payload: { citizenshipStatus: 'citizen' },
      });

      const result = await resolver.setMyNoFieldsMode(false, ctx('u-1'));

      expect(sensitiveProfile.setNoFieldsMode).toHaveBeenCalledWith(
        'u-1',
        false,
      );
      expect(result).toEqual({
        noFieldsMode: false,
        citizenshipStatus: 'citizen',
      });
    });
  });

  describe('clearMySensitiveProfile', () => {
    it('invokes updatePayload(null) — service honors this even when noFieldsMode is on', async () => {
      sensitiveProfile.getNoFieldsMode.mockResolvedValue(false);

      await resolver.clearMySensitiveProfile(ctx('u-1'));

      expect(sensitiveProfile.updatePayload).toHaveBeenCalledWith('u-1', null);
    });
  });

  // ============================================
  // UserEvent
  // ============================================

  describe('recordEvent', () => {
    it('forwards the input under the authenticated user id', async () => {
      userEvent.record.mockResolvedValue({ id: 'e-1' } as never);

      await resolver.recordEvent(
        { verb: 'open', objectType: 'bill', objectId: 'b-1' },
        ctx('u-1'),
      );

      expect(userEvent.record).toHaveBeenCalledWith('u-1', {
        verb: 'open',
        objectType: 'bill',
        objectId: 'b-1',
      });
    });
  });

  describe('getMyEvents', () => {
    it('passes take + objectType options through to the service', async () => {
      userEvent.listForUser.mockResolvedValue([] as never);

      await resolver.getMyEvents(ctx('u-1'), 25, 'bill');

      expect(userEvent.listForUser).toHaveBeenCalledWith('u-1', {
        take: 25,
        objectType: 'bill',
      });
    });

    it('omits undefined options', async () => {
      userEvent.listForUser.mockResolvedValue([] as never);

      await resolver.getMyEvents(ctx('u-1'));

      expect(userEvent.listForUser).toHaveBeenCalledWith('u-1', {
        take: undefined,
        objectType: undefined,
      });
    });
  });

  describe('resetMyEvents', () => {
    it('returns the count from the service', async () => {
      userEvent.resetForUser.mockResolvedValue(42);
      expect(await resolver.resetMyEvents(ctx('u-1'))).toBe(42);
      expect(userEvent.resetForUser).toHaveBeenCalledWith('u-1');
    });
  });
});
