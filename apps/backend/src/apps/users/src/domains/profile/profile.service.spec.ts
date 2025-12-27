/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

import { ProfileService } from './profile.service';
import { UserProfileEntity } from 'src/db/entities/user-profile.entity';
import {
  UserAddressEntity,
  AddressType,
} from 'src/db/entities/user-address.entity';
import { NotificationPreferenceEntity } from 'src/db/entities/notification-preference.entity';
import {
  UserConsentEntity,
  ConsentStatus,
  ConsentType,
} from 'src/db/entities/user-consent.entity';

describe('ProfileService', () => {
  let service: ProfileService;
  let profileRepo: Repository<UserProfileEntity>;
  let addressRepo: Repository<UserAddressEntity>;
  let notificationRepo: Repository<NotificationPreferenceEntity>;
  let consentRepo: Repository<UserConsentEntity>;

  const mockUserId = 'test-user-id';

  const mockProfile = {
    id: 'profile-id',
    userId: mockUserId,
    firstName: 'John',
    lastName: 'Doe',
    displayName: 'johndoe',
    phoneNumber: '+1234567890',
    preferredLanguage: 'en',
    timezone: 'America/New_York',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as UserProfileEntity;

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
    isVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as UserAddressEntity;

  const mockNotificationPrefs = {
    id: 'notif-id',
    userId: mockUserId,
    emailEnabled: true,
    pushEnabled: true,
    smsEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as NotificationPreferenceEntity;

  const mockConsent = {
    id: 'consent-id',
    userId: mockUserId,
    consentType: ConsentType.TERMS_OF_SERVICE,
    status: ConsentStatus.GRANTED,
    grantedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as UserConsentEntity;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: getRepositoryToken(UserProfileEntity),
          useValue: createMock<Repository<UserProfileEntity>>(),
        },
        {
          provide: getRepositoryToken(UserAddressEntity),
          useValue: createMock<Repository<UserAddressEntity>>(),
        },
        {
          provide: getRepositoryToken(NotificationPreferenceEntity),
          useValue: createMock<Repository<NotificationPreferenceEntity>>(),
        },
        {
          provide: getRepositoryToken(UserConsentEntity),
          useValue: createMock<Repository<UserConsentEntity>>(),
        },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
    profileRepo = module.get<Repository<UserProfileEntity>>(
      getRepositoryToken(UserProfileEntity),
    );
    addressRepo = module.get<Repository<UserAddressEntity>>(
      getRepositoryToken(UserAddressEntity),
    );
    notificationRepo = module.get<Repository<NotificationPreferenceEntity>>(
      getRepositoryToken(NotificationPreferenceEntity),
    );
    consentRepo = module.get<Repository<UserConsentEntity>>(
      getRepositoryToken(UserConsentEntity),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // Profile Tests
  // ============================================

  describe('getProfile', () => {
    it('should return a profile if found', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue(mockProfile);

      const result = await service.getProfile(mockUserId);

      expect(result).toEqual(mockProfile);
      expect(profileRepo.findOne).toHaveBeenCalledWith({
        where: { userId: mockUserId },
      });
    });

    it('should return null if profile not found', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue(null);

      const result = await service.getProfile(mockUserId);

      expect(result).toBeNull();
    });
  });

  describe('getOrCreateProfile', () => {
    it('should return existing profile if found', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue(mockProfile);

      const result = await service.getOrCreateProfile(mockUserId);

      expect(result).toEqual(mockProfile);
      expect(profileRepo.create).not.toHaveBeenCalled();
    });

    it('should create new profile if not found', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue(null);
      profileRepo.create = jest.fn().mockReturnValue(mockProfile);
      profileRepo.save = jest.fn().mockResolvedValue(mockProfile);

      const result = await service.getOrCreateProfile(mockUserId);

      expect(result).toEqual(mockProfile);
      expect(profileRepo.create).toHaveBeenCalledWith({ userId: mockUserId });
      expect(profileRepo.save).toHaveBeenCalled();
    });
  });

  describe('updateProfile', () => {
    it('should update profile with provided fields', async () => {
      const updateDto = { firstName: 'Jane' };
      const updatedProfile = { ...mockProfile, ...updateDto };

      profileRepo.findOne = jest.fn().mockResolvedValue(mockProfile);
      profileRepo.save = jest.fn().mockResolvedValue(updatedProfile);

      const result = await service.updateProfile(mockUserId, updateDto);

      expect(result).toEqual(updatedProfile);
      expect(profileRepo.save).toHaveBeenCalled();
    });
  });

  // ============================================
  // Address Tests
  // ============================================

  describe('getAddresses', () => {
    it('should return list of addresses', async () => {
      addressRepo.find = jest.fn().mockResolvedValue([mockAddress]);

      const result = await service.getAddresses(mockUserId);

      expect(result).toEqual([mockAddress]);
      expect(addressRepo.find).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        order: { isPrimary: 'DESC', createdAt: 'ASC' },
      });
    });
  });

  describe('getAddress', () => {
    it('should return address if found', async () => {
      addressRepo.findOne = jest.fn().mockResolvedValue(mockAddress);

      const result = await service.getAddress(mockUserId, mockAddress.id);

      expect(result).toEqual(mockAddress);
    });

    it('should return null if address not found', async () => {
      addressRepo.findOne = jest.fn().mockResolvedValue(null);

      const result = await service.getAddress(mockUserId, 'non-existent');

      expect(result).toBeNull();
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
        isPrimary: false,
      };

      addressRepo.create = jest.fn().mockReturnValue(mockAddress);
      addressRepo.save = jest.fn().mockResolvedValue(mockAddress);

      const result = await service.createAddress(mockUserId, createDto as any);

      expect(result).toEqual(mockAddress);
    });

    it('should unset other primary addresses when creating primary', async () => {
      const createDto = {
        addressType: AddressType.RESIDENTIAL,
        addressLine1: '123 Main St',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
        country: 'US',
        isPrimary: true,
      };

      addressRepo.update = jest.fn().mockResolvedValue({ affected: 1 });
      addressRepo.create = jest.fn().mockReturnValue(mockAddress);
      addressRepo.save = jest.fn().mockResolvedValue(mockAddress);

      await service.createAddress(mockUserId, createDto as any);

      expect(addressRepo.update).toHaveBeenCalledWith(
        { userId: mockUserId, isPrimary: true },
        { isPrimary: false },
      );
    });
  });

  describe('updateAddress', () => {
    it('should update address', async () => {
      const updateDto = { id: mockAddress.id, city: 'Boston' };
      const updatedAddress = { ...mockAddress, city: 'Boston' };

      addressRepo.findOne = jest.fn().mockResolvedValue(mockAddress);
      addressRepo.save = jest.fn().mockResolvedValue(updatedAddress);

      const result = await service.updateAddress(mockUserId, updateDto);

      expect(result).toEqual(updatedAddress);
    });

    it('should throw NotFoundException if address not found', async () => {
      addressRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.updateAddress(mockUserId, { id: 'non-existent' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteAddress', () => {
    it('should delete address and return true', async () => {
      addressRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });

      const result = await service.deleteAddress(mockUserId, mockAddress.id);

      expect(result).toBe(true);
    });

    it('should return false if address not found', async () => {
      addressRepo.delete = jest.fn().mockResolvedValue({ affected: 0 });

      const result = await service.deleteAddress(mockUserId, 'non-existent');

      expect(result).toBe(false);
    });
  });

  describe('setPrimaryAddress', () => {
    it('should set address as primary', async () => {
      addressRepo.findOne = jest.fn().mockResolvedValue(mockAddress);
      addressRepo.update = jest.fn().mockResolvedValue({ affected: 1 });
      addressRepo.save = jest
        .fn()
        .mockResolvedValue({ ...mockAddress, isPrimary: true });

      const result = await service.setPrimaryAddress(
        mockUserId,
        mockAddress.id,
      );

      expect(result.isPrimary).toBe(true);
      expect(addressRepo.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if address not found', async () => {
      addressRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.setPrimaryAddress(mockUserId, 'non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================
  // Notification Preferences Tests
  // ============================================

  describe('getNotificationPreferences', () => {
    it('should return notification preferences', async () => {
      notificationRepo.findOne = jest
        .fn()
        .mockResolvedValue(mockNotificationPrefs);

      const result = await service.getNotificationPreferences(mockUserId);

      expect(result).toEqual(mockNotificationPrefs);
    });
  });

  describe('updateNotificationPreferences', () => {
    it('should update notification preferences', async () => {
      const updateDto = { emailEnabled: false };
      const updatedPrefs = { ...mockNotificationPrefs, emailEnabled: false };

      notificationRepo.findOne = jest
        .fn()
        .mockResolvedValue(mockNotificationPrefs);
      notificationRepo.save = jest.fn().mockResolvedValue(updatedPrefs);

      const result = await service.updateNotificationPreferences(
        mockUserId,
        updateDto,
      );

      expect(result).toEqual(updatedPrefs);
    });
  });

  describe('unsubscribeAll', () => {
    it('should disable all notifications', async () => {
      const unsubscribedPrefs = {
        ...mockNotificationPrefs,
        emailEnabled: false,
        pushEnabled: false,
        smsEnabled: false,
        unsubscribedAllAt: expect.any(Date),
      };

      notificationRepo.findOne = jest
        .fn()
        .mockResolvedValue(mockNotificationPrefs);
      notificationRepo.save = jest.fn().mockResolvedValue(unsubscribedPrefs);

      const result = await service.unsubscribeAll(mockUserId);

      expect(result.emailEnabled).toBe(false);
      expect(result.pushEnabled).toBe(false);
      expect(result.smsEnabled).toBe(false);
    });
  });

  // ============================================
  // Consent Tests
  // ============================================

  describe('getConsents', () => {
    it('should return list of consents', async () => {
      consentRepo.find = jest.fn().mockResolvedValue([mockConsent]);

      const result = await service.getConsents(mockUserId);

      expect(result).toEqual([mockConsent]);
    });
  });

  describe('getConsent', () => {
    it('should return consent if found', async () => {
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);

      const result = await service.getConsent(
        mockUserId,
        ConsentType.TERMS_OF_SERVICE,
      );

      expect(result).toEqual(mockConsent);
    });
  });

  describe('updateConsent', () => {
    it('should create new consent if not exists', async () => {
      const updateDto = {
        consentType: ConsentType.PRIVACY_POLICY,
        granted: true,
      };

      consentRepo.findOne = jest.fn().mockResolvedValue(null);
      consentRepo.create = jest.fn().mockReturnValue({
        userId: mockUserId,
        consentType: ConsentType.PRIVACY_POLICY,
      });
      consentRepo.save = jest.fn().mockResolvedValue({
        ...mockConsent,
        consentType: ConsentType.PRIVACY_POLICY,
      });

      const result = await service.updateConsent(mockUserId, updateDto);

      expect(result.consentType).toBe(ConsentType.PRIVACY_POLICY);
      expect(consentRepo.create).toHaveBeenCalled();
    });

    it('should update existing consent to granted', async () => {
      const updateDto = {
        consentType: ConsentType.TERMS_OF_SERVICE,
        granted: true,
      };

      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);
      consentRepo.save = jest.fn().mockResolvedValue({
        ...mockConsent,
        status: ConsentStatus.GRANTED,
      });

      const result = await service.updateConsent(mockUserId, updateDto);

      expect(result.status).toBe(ConsentStatus.GRANTED);
    });

    it('should update existing consent to denied', async () => {
      const updateDto = {
        consentType: ConsentType.TERMS_OF_SERVICE,
        granted: false,
      };

      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);
      consentRepo.save = jest.fn().mockResolvedValue({
        ...mockConsent,
        status: ConsentStatus.DENIED,
      });

      const result = await service.updateConsent(mockUserId, updateDto);

      expect(result.status).toBe(ConsentStatus.DENIED);
    });
  });

  describe('withdrawConsent', () => {
    it('should withdraw consent', async () => {
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);
      consentRepo.save = jest.fn().mockResolvedValue({
        ...mockConsent,
        status: ConsentStatus.WITHDRAWN,
      });

      const result = await service.withdrawConsent(
        mockUserId,
        ConsentType.TERMS_OF_SERVICE,
      );

      expect(result.status).toBe(ConsentStatus.WITHDRAWN);
    });

    it('should throw NotFoundException if consent not found', async () => {
      consentRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.withdrawConsent(mockUserId, ConsentType.TERMS_OF_SERVICE),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('hasValidConsent', () => {
    it('should return true for valid granted consent', async () => {
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);

      const result = await service.hasValidConsent(
        mockUserId,
        ConsentType.TERMS_OF_SERVICE,
      );

      expect(result).toBe(true);
    });

    it('should return false if consent not found', async () => {
      consentRepo.findOne = jest.fn().mockResolvedValue(null);

      const result = await service.hasValidConsent(
        mockUserId,
        ConsentType.TERMS_OF_SERVICE,
      );

      expect(result).toBe(false);
    });

    it('should return false if consent is expired', async () => {
      const expiredConsent = {
        ...mockConsent,
        expiresAt: new Date(Date.now() - 86400000), // expired yesterday
      };
      consentRepo.findOne = jest.fn().mockResolvedValue(expiredConsent);

      const result = await service.hasValidConsent(
        mockUserId,
        ConsentType.TERMS_OF_SERVICE,
      );

      expect(result).toBe(false);
    });
  });

  describe('bulkUpdateConsents', () => {
    it('should update multiple consents', async () => {
      const consents = [
        { consentType: ConsentType.TERMS_OF_SERVICE, granted: true },
        { consentType: ConsentType.PRIVACY_POLICY, granted: true },
      ];

      consentRepo.findOne = jest.fn().mockResolvedValue(null);
      consentRepo.create = jest.fn().mockImplementation((data) => data);
      consentRepo.save = jest.fn().mockImplementation((consent) => ({
        ...consent,
        id: 'new-id',
        status: ConsentStatus.GRANTED,
      }));

      const result = await service.bulkUpdateConsents(mockUserId, consents);

      expect(result).toHaveLength(2);
      expect(consentRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('getRequiredConsentsStatus', () => {
    it('should return status of required consents', async () => {
      consentRepo.findOne = jest.fn().mockResolvedValue(mockConsent);

      const result = await service.getRequiredConsentsStatus(mockUserId);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe(ConsentType.TERMS_OF_SERVICE);
      expect(result[1].type).toBe(ConsentType.PRIVACY_POLICY);
    });
  });

  // ============================================
  // Profile Completion Tests
  // ============================================

  describe('getProfileCompletion', () => {
    it('should return 0% completion for empty profile', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue(null);
      addressRepo.find = jest.fn().mockResolvedValue([]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(0);
      expect(result.isComplete).toBe(false);
      expect(result.coreFieldsComplete.hasName).toBe(false);
      expect(result.coreFieldsComplete.hasPhoto).toBe(false);
      expect(result.coreFieldsComplete.hasTimezone).toBe(false);
      expect(result.coreFieldsComplete.hasAddress).toBe(false);
    });

    it('should return 25% for profile with name only', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: null,
        avatarUrl: null,
      });
      addressRepo.find = jest.fn().mockResolvedValue([]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(25);
      expect(result.coreFieldsComplete.hasName).toBe(true);
      expect(result.coreFieldsComplete.hasPhoto).toBe(false);
    });

    it('should return 100% for complete core profile', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: 'America/New_York',
        avatarUrl: 'https://example.com/avatar.jpg',
      });
      addressRepo.find = jest.fn().mockResolvedValue([mockAddress]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(100);
      expect(result.isComplete).toBe(true);
    });

    it('should add civic field bonus percentage', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: 'America/New_York',
        avatarUrl: 'https://example.com/avatar.jpg',
        politicalAffiliation: 'independent',
        votingFrequency: 'always',
      });
      addressRepo.find = jest.fn().mockResolvedValue([mockAddress]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(110); // 100% core + 10% civic (2 fields * 5%)
    });

    it('should add demographic field bonus percentage', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: 'America/New_York',
        avatarUrl: 'https://example.com/avatar.jpg',
        occupation: 'Engineer',
        educationLevel: 'bachelor',
      });
      addressRepo.find = jest.fn().mockResolvedValue([mockAddress]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(106); // 100% core + 6% demographic (2 fields * 3%)
    });

    it('should cap percentage at 130%', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: 'America/New_York',
        avatarUrl: 'https://example.com/avatar.jpg',
        politicalAffiliation: 'independent',
        votingFrequency: 'always',
        policyPriorities: ['healthcare', 'education'],
        occupation: 'Engineer',
        educationLevel: 'bachelor',
        incomeRange: '50k_75k',
        householdSize: '2',
        homeownerStatus: 'own',
      });
      addressRepo.find = jest.fn().mockResolvedValue([mockAddress]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(130); // Capped at 130%
    });

    it('should return suggested steps for incomplete profile', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue(null);
      addressRepo.find = jest.fn().mockResolvedValue([]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.suggestedNextSteps.length).toBeGreaterThan(0);
      expect(result.suggestedNextSteps).toContain(
        'Add your name to personalize your profile',
      );
    });

    it('should suggest civic fields when core is complete', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: 'America/New_York',
        avatarUrl: 'https://example.com/avatar.jpg',
      });
      addressRepo.find = jest.fn().mockResolvedValue([mockAddress]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.suggestedNextSteps).toContain(
        'Share your political affiliation for personalized insights',
      );
    });

    it('should use displayName if firstName is not set', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue({
        ...mockProfile,
        firstName: null,
        displayName: 'johndoe',
        timezone: null,
        avatarUrl: null,
      });
      addressRepo.find = jest.fn().mockResolvedValue([]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.coreFieldsComplete.hasName).toBe(true);
    });

    it('should use avatarStorageKey if avatarUrl is not set', async () => {
      profileRepo.findOne = jest.fn().mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: null,
        avatarUrl: null,
        avatarStorageKey: 'avatars/user-123/photo.jpg',
      });
      addressRepo.find = jest.fn().mockResolvedValue([]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.coreFieldsComplete.hasPhoto).toBe(true);
    });
  });

  // ============================================
  // Avatar Upload Tests
  // ============================================

  describe('getAvatarUploadUrl', () => {
    it('should throw error when storage provider not configured', async () => {
      await expect(
        service.getAvatarUploadUrl(mockUserId, 'photo.jpg'),
      ).rejects.toThrow('Storage provider not configured');
    });
  });

  describe('updateAvatarStorageKey', () => {
    it('should update avatar storage key', async () => {
      const storageKey = 'avatars/user-123/photo.jpg';
      const updatedProfile = { ...mockProfile, avatarStorageKey: storageKey };

      profileRepo.findOne = jest.fn().mockResolvedValue(mockProfile);
      profileRepo.save = jest.fn().mockResolvedValue(updatedProfile);

      const result = await service.updateAvatarStorageKey(
        mockUserId,
        storageKey,
      );

      expect(result.avatarStorageKey).toBe(storageKey);
      expect(profileRepo.save).toHaveBeenCalled();
    });

    it('should create profile if not exists and update storage key', async () => {
      const storageKey = 'avatars/user-123/photo.jpg';
      const newProfile = { userId: mockUserId, avatarStorageKey: storageKey };

      profileRepo.findOne = jest.fn().mockResolvedValue(null);
      profileRepo.create = jest.fn().mockReturnValue(newProfile);
      profileRepo.save = jest.fn().mockResolvedValue(newProfile);

      const result = await service.updateAvatarStorageKey(
        mockUserId,
        storageKey,
      );

      expect(result.avatarStorageKey).toBe(storageKey);
      expect(profileRepo.create).toHaveBeenCalled();
    });
  });
});
