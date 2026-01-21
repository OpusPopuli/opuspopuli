/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { UserInputError } from '@nestjs/apollo';

import { ProfileResolver } from './profile.resolver';
import { ProfileService } from './profile.service';
import { AddressType } from 'src/common/enums/address.enum';
import { ConsentType, ConsentStatus } from 'src/common/enums/consent.enum';
import { UserProfileModel } from './models/user-profile.model';
import { UserAddressModel } from './models/user-address.model';
import { NotificationPreferenceModel } from './models/notification-preference.model';
import { UserConsentModel } from './models/user-consent.model';

describe('ProfileResolver', () => {
  let resolver: ProfileResolver;
  let profileService: ProfileService;

  const mockUserId = 'test-user-id';
  const mockUserEmail = 'test@example.com';

  const mockUser = {
    id: mockUserId,
    email: mockUserEmail,
    roles: ['User'],
    department: 'Engineering',
    clearance: 'Secret',
  };

  // SECURITY: Tests now use request.user (set by passport) instead of headers.user (spoofable)
  // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/183
  const mockContext = {
    req: {
      ip: '127.0.0.1',
      user: mockUser,
      headers: {
        'user-agent': 'test-agent',
      },
    },
  };

  const mockContextNoUser = {
    req: {
      user: undefined,
      headers: {},
    },
  };

  const mockProfile = {
    id: 'profile-id',
    userId: mockUserId,
    firstName: 'John',
    lastName: 'Doe',
    displayName: 'johndoe',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as UserProfileModel;

  const mockAddress = {
    id: 'address-id',
    userId: mockUserId,
    addressType: AddressType.RESIDENTIAL,
    addressLine1: '123 Main St',
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    country: 'US',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as UserAddressModel;

  const mockNotificationPrefs = {
    id: 'notif-id',
    userId: mockUserId,
    emailEnabled: true,
    pushEnabled: true,
    smsEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as NotificationPreferenceModel;

  const mockConsent = {
    id: 'consent-id',
    userId: mockUserId,
    consentType: ConsentType.TERMS_OF_SERVICE,
    status: ConsentStatus.GRANTED,
    grantedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as UserConsentModel;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileResolver,
        {
          provide: ProfileService,
          useValue: createMock<ProfileService>(),
        },
      ],
    }).compile();

    resolver = module.get<ProfileResolver>(ProfileResolver);
    profileService = module.get<ProfileService>(ProfileService);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });

  // ============================================
  // Profile Tests
  // ============================================

  describe('getMyProfile', () => {
    it('should return profile for authenticated user', async () => {
      profileService.getProfile = jest.fn().mockResolvedValue(mockProfile);

      const result = await resolver.getMyProfile(mockContext as any);

      expect(result).toEqual(mockProfile);
      expect(profileService.getProfile).toHaveBeenCalledWith(mockUserId);
    });

    it('should throw UserInputError if user not authenticated', async () => {
      await expect(
        resolver.getMyProfile(mockContextNoUser as any),
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('updateMyProfile', () => {
    it('should update profile', async () => {
      const updateDto = { firstName: 'Jane' };
      const updatedProfile = { ...mockProfile, firstName: 'Jane' };

      profileService.updateProfile = jest
        .fn()
        .mockResolvedValue(updatedProfile);

      const result = await resolver.updateMyProfile(
        updateDto,
        mockContext as any,
      );

      expect(result).toEqual(updatedProfile);
      expect(profileService.updateProfile).toHaveBeenCalledWith(
        mockUserId,
        updateDto,
      );
    });
  });

  // ============================================
  // Address Tests
  // ============================================

  describe('getMyAddresses', () => {
    it('should return list of addresses', async () => {
      profileService.getAddresses = jest.fn().mockResolvedValue([mockAddress]);

      const result = await resolver.getMyAddresses(mockContext as any);

      expect(result).toEqual([mockAddress]);
      expect(profileService.getAddresses).toHaveBeenCalledWith(mockUserId);
    });
  });

  describe('getMyAddress', () => {
    it('should return specific address', async () => {
      profileService.getAddress = jest.fn().mockResolvedValue(mockAddress);

      const result = await resolver.getMyAddress(
        mockAddress.id,
        mockContext as any,
      );

      expect(result).toEqual(mockAddress);
      expect(profileService.getAddress).toHaveBeenCalledWith(
        mockUserId,
        mockAddress.id,
      );
    });
  });

  describe('createAddress', () => {
    it('should create address', async () => {
      const createDto = {
        addressType: AddressType.RESIDENTIAL,
        addressLine1: '123 Main St',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
        country: 'US',
      };

      profileService.createAddress = jest.fn().mockResolvedValue(mockAddress);

      const result = await resolver.createAddress(
        createDto as any,
        mockContext as any,
      );

      expect(result).toEqual(mockAddress);
      expect(profileService.createAddress).toHaveBeenCalledWith(
        mockUserId,
        createDto,
      );
    });
  });

  describe('updateAddress', () => {
    it('should update address', async () => {
      const updateDto = { id: mockAddress.id, city: 'Boston' };
      const updatedAddress = { ...mockAddress, city: 'Boston' };

      profileService.updateAddress = jest
        .fn()
        .mockResolvedValue(updatedAddress);

      const result = await resolver.updateAddress(
        updateDto,
        mockContext as any,
      );

      expect(result).toEqual(updatedAddress);
      expect(profileService.updateAddress).toHaveBeenCalledWith(
        mockUserId,
        updateDto,
      );
    });
  });

  describe('deleteAddress', () => {
    it('should delete address', async () => {
      profileService.deleteAddress = jest.fn().mockResolvedValue(true);

      const result = await resolver.deleteAddress(
        mockAddress.id,
        mockContext as any,
      );

      expect(result).toBe(true);
      expect(profileService.deleteAddress).toHaveBeenCalledWith(
        mockUserId,
        mockAddress.id,
      );
    });
  });

  describe('setPrimaryAddress', () => {
    it('should set primary address', async () => {
      const primaryAddress = { ...mockAddress, isPrimary: true };
      profileService.setPrimaryAddress = jest
        .fn()
        .mockResolvedValue(primaryAddress);

      const result = await resolver.setPrimaryAddress(
        mockAddress.id,
        mockContext as any,
      );

      expect(result).toEqual(primaryAddress);
      expect(profileService.setPrimaryAddress).toHaveBeenCalledWith(
        mockUserId,
        mockAddress.id,
      );
    });
  });

  // ============================================
  // Notification Preferences Tests
  // ============================================

  describe('getMyNotificationPreferences', () => {
    it('should return notification preferences', async () => {
      profileService.getNotificationPreferences = jest
        .fn()
        .mockResolvedValue(mockNotificationPrefs);

      const result = await resolver.getMyNotificationPreferences(
        mockContext as any,
      );

      expect(result).toEqual(mockNotificationPrefs);
    });
  });

  describe('updateNotificationPreferences', () => {
    it('should update notification preferences', async () => {
      const updateDto = { emailEnabled: false };
      const updatedPrefs = { ...mockNotificationPrefs, emailEnabled: false };

      profileService.updateNotificationPreferences = jest
        .fn()
        .mockResolvedValue(updatedPrefs);

      const result = await resolver.updateNotificationPreferences(
        updateDto,
        mockContext as any,
      );

      expect(result).toEqual(updatedPrefs);
    });
  });

  describe('unsubscribeFromAll', () => {
    it('should unsubscribe from all notifications', async () => {
      const unsubscribedPrefs = {
        ...mockNotificationPrefs,
        emailEnabled: false,
        pushEnabled: false,
        smsEnabled: false,
      };

      profileService.unsubscribeAll = jest
        .fn()
        .mockResolvedValue(unsubscribedPrefs);

      const result = await resolver.unsubscribeFromAll(mockContext as any);

      expect(result).toEqual(unsubscribedPrefs);
    });
  });

  // ============================================
  // Consent Tests
  // ============================================

  describe('getMyConsents', () => {
    it('should return list of consents', async () => {
      profileService.getConsents = jest.fn().mockResolvedValue([mockConsent]);

      const result = await resolver.getMyConsents(mockContext as any);

      expect(result).toEqual([mockConsent]);
    });
  });

  describe('getMyConsent', () => {
    it('should return specific consent', async () => {
      profileService.getConsent = jest.fn().mockResolvedValue(mockConsent);

      const result = await resolver.getMyConsent(
        ConsentType.TERMS_OF_SERVICE,
        mockContext as any,
      );

      expect(result).toEqual(mockConsent);
    });
  });

  describe('updateConsent', () => {
    it('should update consent with metadata', async () => {
      const updateDto = {
        consentType: ConsentType.TERMS_OF_SERVICE,
        granted: true,
      };

      profileService.updateConsent = jest.fn().mockResolvedValue(mockConsent);

      const result = await resolver.updateConsent(
        updateDto,
        mockContext as any,
      );

      expect(result).toEqual(mockConsent);
      expect(profileService.updateConsent).toHaveBeenCalledWith(
        mockUserId,
        updateDto,
        expect.objectContaining({
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
          collectionMethod: 'graphql_api',
        }),
      );
    });
  });

  describe('bulkUpdateConsents', () => {
    it('should bulk update consents', async () => {
      const input = {
        consents: [
          { consentType: ConsentType.TERMS_OF_SERVICE, granted: true },
          { consentType: ConsentType.PRIVACY_POLICY, granted: true },
        ],
      };

      profileService.bulkUpdateConsents = jest
        .fn()
        .mockResolvedValue([mockConsent, mockConsent]);

      const result = await resolver.bulkUpdateConsents(
        input,
        mockContext as any,
      );

      expect(result).toHaveLength(2);
      expect(profileService.bulkUpdateConsents).toHaveBeenCalledWith(
        mockUserId,
        input.consents,
        expect.objectContaining({
          collectionMethod: 'graphql_api',
        }),
      );
    });
  });

  describe('withdrawConsent', () => {
    it('should withdraw consent', async () => {
      const input = { consentType: ConsentType.TERMS_OF_SERVICE };
      const withdrawnConsent = {
        ...mockConsent,
        status: ConsentStatus.WITHDRAWN,
      };

      profileService.withdrawConsent = jest
        .fn()
        .mockResolvedValue(withdrawnConsent);

      const result = await resolver.withdrawConsent(input, mockContext as any);

      expect(result).toEqual(withdrawnConsent);
      expect(profileService.withdrawConsent).toHaveBeenCalledWith(
        mockUserId,
        ConsentType.TERMS_OF_SERVICE,
        expect.objectContaining({
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
        }),
      );
    });
  });

  describe('hasValidConsent', () => {
    it('should check if consent is valid', async () => {
      profileService.hasValidConsent = jest.fn().mockResolvedValue(true);

      const result = await resolver.hasValidConsent(
        ConsentType.TERMS_OF_SERVICE,
        mockContext as any,
      );

      expect(result).toBe(true);
    });
  });

  // ============================================
  // Profile Completion Tests
  // ============================================

  describe('getMyProfileCompletion', () => {
    const mockCompletion = {
      percentage: 75,
      isComplete: false,
      coreFieldsComplete: {
        hasName: true,
        hasPhoto: false,
        hasTimezone: true,
        hasAddress: true,
      },
      suggestedNextSteps: ['Upload a profile photo'],
    };

    it('should return profile completion for authenticated user', async () => {
      profileService.getProfileCompletion = jest
        .fn()
        .mockResolvedValue(mockCompletion);

      const result = await resolver.getMyProfileCompletion(mockContext as any);

      expect(result).toEqual(mockCompletion);
      expect(profileService.getProfileCompletion).toHaveBeenCalledWith(
        mockUserId,
      );
    });

    it('should throw UserInputError if user not authenticated', async () => {
      await expect(
        resolver.getMyProfileCompletion(mockContextNoUser as any),
      ).rejects.toThrow(UserInputError);
    });
  });

  // ============================================
  // Avatar Upload Tests
  // ============================================

  describe('getAvatarUploadUrl', () => {
    it('should return upload URL for authenticated user', async () => {
      const mockUrl = 'https://storage.example.com/upload?signed=abc123';
      profileService.getAvatarUploadUrl = jest.fn().mockResolvedValue(mockUrl);

      const result = await resolver.getAvatarUploadUrl(
        'photo.jpg',
        mockContext as any,
      );

      expect(result).toBe(mockUrl);
      expect(profileService.getAvatarUploadUrl).toHaveBeenCalledWith(
        mockUserId,
        'photo.jpg',
      );
    });

    it('should throw UserInputError if user not authenticated', async () => {
      await expect(
        resolver.getAvatarUploadUrl('photo.jpg', mockContextNoUser as any),
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('updateAvatarStorageKey', () => {
    it('should update avatar storage key for authenticated user', async () => {
      const storageKey = 'avatars/user-123/photo.jpg';
      const updatedProfile = { ...mockProfile, avatarStorageKey: storageKey };

      profileService.updateAvatarStorageKey = jest
        .fn()
        .mockResolvedValue(updatedProfile);

      const result = await resolver.updateAvatarStorageKey(
        storageKey,
        mockContext as any,
      );

      expect(result).toEqual(updatedProfile);
      expect(profileService.updateAvatarStorageKey).toHaveBeenCalledWith(
        mockUserId,
        storageKey,
      );
    });

    it('should throw UserInputError if user not authenticated', async () => {
      await expect(
        resolver.updateAvatarStorageKey(
          'avatars/user-123/photo.jpg',
          mockContextNoUser as any,
        ),
      ).rejects.toThrow(UserInputError);
    });
  });
});
