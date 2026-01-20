/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { ProfileService } from './profile.service';
import { PrismaService } from 'src/db/prisma.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from 'src/test/prisma-mock';
import { ConsentType, ConsentStatus } from 'src/common/enums/consent.enum';
import { AddressType } from 'src/common/enums/address.enum';

describe('ProfileService', () => {
  let service: ProfileService;
  let mockPrisma: MockPrismaService;

  const mockUserId = 'test-user-id';

  // Cast mock objects to any to avoid strict Prisma type checking in tests
  const mockProfile: any = {
    id: 'profile-id',
    userId: mockUserId,
    firstName: 'John',
    middleName: null,
    lastName: 'Doe',
    displayName: 'johndoe',
    preferredName: null,
    dateOfBirth: null,
    phone: '+1234567890',
    phoneVerifiedAt: null,
    preferredLanguage: 'en',
    timezone: 'America/New_York',
    locale: 'en-US',
    avatarUrl: null,
    avatarStorageKey: null,
    bio: null,
    isPublic: false,
    politicalAffiliation: null,
    votingFrequency: null,
    policyPriorities: [],
    occupation: null,
    educationLevel: null,
    incomeRange: null,
    householdSize: null,
    homeownerStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAddress: any = {
    id: 'address-id',
    userId: mockUserId,
    addressType: AddressType.RESIDENTIAL,
    addressLine1: '123 Main St',
    addressLine2: null,
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    country: 'US',
    isPrimary: true,
    isVerified: false,
    latitude: null,
    longitude: null,
    formattedAddress: null,
    placeId: null,
    geocodedAt: null,
    congressionalDistrict: null,
    stateSenatorialDistrict: null,
    stateAssemblyDistrict: null,
    county: null,
    municipality: null,
    schoolDistrict: null,
    precinctId: null,
    pollingPlace: null,
    civicDataUpdatedAt: null,
    verifiedAt: null,
    verificationMethod: null,
    label: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockNotificationPrefs: any = {
    id: 'notif-id',
    userId: mockUserId,
    emailEnabled: true,
    emailProductUpdates: true,
    emailSecurityAlerts: true,
    emailMarketing: false,
    emailFrequency: 'immediate',
    pushEnabled: true,
    pushProductUpdates: true,
    pushSecurityAlerts: true,
    pushMarketing: false,
    smsEnabled: false,
    smsSecurityAlerts: true,
    smsMarketing: false,
    civicElectionReminders: true,
    civicVoterDeadlines: true,
    civicBallotUpdates: true,
    civicLocalNews: true,
    civicRepresentativeUpdates: true,
    civicFrequency: 'daily_digest',
    quietHoursEnabled: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    unsubscribedAllAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockConsent: any = {
    id: 'consent-id',
    userId: mockUserId,
    consentType: ConsentType.TERMS_OF_SERVICE,
    status: ConsentStatus.GRANTED,
    documentVersion: null,
    documentUrl: null,
    ipAddress: null,
    userAgent: null,
    collectionMethod: null,
    collectionContext: null,
    consentText: null,
    grantedAt: new Date(),
    deniedAt: null,
    withdrawnAt: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // Profile Tests
  // ============================================

  describe('getProfile', () => {
    it('should return a profile if found', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);

      const result = await service.getProfile(mockUserId);

      expect(result).toEqual(mockProfile);
      expect(mockPrisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { userId: mockUserId },
      });
    });

    it('should return null if profile not found', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);

      const result = await service.getProfile(mockUserId);

      expect(result).toBeNull();
    });
  });

  describe('getOrCreateProfile', () => {
    it('should return existing profile if found', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);

      const result = await service.getOrCreateProfile(mockUserId);

      expect(result).toEqual(mockProfile);
      expect(mockPrisma.userProfile.create).not.toHaveBeenCalled();
    });

    it('should create new profile if not found', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);
      mockPrisma.userProfile.create.mockResolvedValue(mockProfile);

      const result = await service.getOrCreateProfile(mockUserId);

      expect(result).toEqual(mockProfile);
      expect(mockPrisma.userProfile.create).toHaveBeenCalledWith({
        data: { userId: mockUserId },
      });
    });
  });

  describe('updateProfile', () => {
    it('should update profile with provided fields', async () => {
      const updateDto = { firstName: 'Jane' };
      const updatedProfile = { ...mockProfile, ...updateDto };

      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.userProfile.update.mockResolvedValue(updatedProfile);

      const result = await service.updateProfile(mockUserId, updateDto);

      expect(result).toEqual(updatedProfile);
      expect(mockPrisma.userProfile.update).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        data: updateDto,
      });
    });
  });

  // ============================================
  // Address Tests
  // ============================================

  describe('getAddresses', () => {
    it('should return list of addresses', async () => {
      mockPrisma.userAddress.findMany.mockResolvedValue([mockAddress]);

      const result = await service.getAddresses(mockUserId);

      expect(result).toEqual([mockAddress]);
      expect(mockPrisma.userAddress.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('getAddress', () => {
    it('should return address if found', async () => {
      mockPrisma.userAddress.findFirst.mockResolvedValue(mockAddress);

      const result = await service.getAddress(mockUserId, mockAddress.id);

      expect(result).toEqual(mockAddress);
    });

    it('should return null if address not found', async () => {
      mockPrisma.userAddress.findFirst.mockResolvedValue(null);

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

      mockPrisma.userAddress.create.mockResolvedValue(mockAddress);

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

      mockPrisma.userAddress.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.userAddress.create.mockResolvedValue(mockAddress);

      await service.createAddress(mockUserId, createDto as any);

      expect(mockPrisma.userAddress.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUserId, isPrimary: true },
        data: { isPrimary: false },
      });
    });
  });

  describe('updateAddress', () => {
    it('should update address', async () => {
      const updateDto = { id: mockAddress.id, city: 'Boston' };
      const updatedAddress = { ...mockAddress, city: 'Boston' };

      mockPrisma.userAddress.findFirst.mockResolvedValue(mockAddress);
      mockPrisma.userAddress.update.mockResolvedValue(updatedAddress);

      const result = await service.updateAddress(mockUserId, updateDto);

      expect(result).toEqual(updatedAddress);
    });

    it('should throw NotFoundException if address not found', async () => {
      mockPrisma.userAddress.findFirst.mockResolvedValue(null);

      await expect(
        service.updateAddress(mockUserId, { id: 'non-existent' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteAddress', () => {
    it('should delete address and return true', async () => {
      mockPrisma.userAddress.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteAddress(mockUserId, mockAddress.id);

      expect(result).toBe(true);
    });

    it('should return false if address not found', async () => {
      mockPrisma.userAddress.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.deleteAddress(mockUserId, 'non-existent');

      expect(result).toBe(false);
    });
  });

  describe('setPrimaryAddress', () => {
    it('should set address as primary', async () => {
      mockPrisma.userAddress.findFirst.mockResolvedValue(mockAddress);
      mockPrisma.userAddress.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.userAddress.update.mockResolvedValue({
        ...mockAddress,
        isPrimary: true,
      });

      const result = await service.setPrimaryAddress(
        mockUserId,
        mockAddress.id,
      );

      expect(result.isPrimary).toBe(true);
      expect(mockPrisma.userAddress.updateMany).toHaveBeenCalled();
    });

    it('should throw NotFoundException if address not found', async () => {
      mockPrisma.userAddress.findFirst.mockResolvedValue(null);

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
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(
        mockNotificationPrefs,
      );

      const result = await service.getNotificationPreferences(mockUserId);

      expect(result).toEqual(mockNotificationPrefs);
    });
  });

  describe('updateNotificationPreferences', () => {
    it('should update notification preferences', async () => {
      const updateDto = { emailEnabled: false };
      const updatedPrefs = { ...mockNotificationPrefs, emailEnabled: false };

      mockPrisma.notificationPreference.findUnique.mockResolvedValue(
        mockNotificationPrefs,
      );
      mockPrisma.notificationPreference.update.mockResolvedValue(updatedPrefs);

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

      mockPrisma.notificationPreference.findUnique.mockResolvedValue(
        mockNotificationPrefs,
      );
      mockPrisma.notificationPreference.update.mockResolvedValue(
        unsubscribedPrefs,
      );

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
      mockPrisma.userConsent.findMany.mockResolvedValue([mockConsent]);

      const result = await service.getConsents(mockUserId);

      expect(result).toEqual([mockConsent]);
    });
  });

  describe('getConsent', () => {
    it('should return consent if found', async () => {
      mockPrisma.userConsent.findUnique.mockResolvedValue(mockConsent);

      const result = await service.getConsent(
        mockUserId,
        ConsentType.TERMS_OF_SERVICE,
      );

      expect(result).toEqual(mockConsent);
    });
  });

  describe('updateConsent', () => {
    it('should upsert consent when granting', async () => {
      const updateDto = {
        consentType: ConsentType.PRIVACY_POLICY,
        granted: true,
      };

      mockPrisma.userConsent.upsert.mockResolvedValue({
        ...mockConsent,
        consentType: ConsentType.PRIVACY_POLICY,
        status: ConsentStatus.GRANTED,
      });

      const result = await service.updateConsent(mockUserId, updateDto);

      expect(result.consentType).toBe(ConsentType.PRIVACY_POLICY);
      expect(result.status).toBe(ConsentStatus.GRANTED);
      expect(mockPrisma.userConsent.upsert).toHaveBeenCalled();
    });

    it('should upsert consent when denying', async () => {
      const updateDto = {
        consentType: ConsentType.TERMS_OF_SERVICE,
        granted: false,
      };

      mockPrisma.userConsent.upsert.mockResolvedValue({
        ...mockConsent,
        status: ConsentStatus.DENIED,
      });

      const result = await service.updateConsent(mockUserId, updateDto);

      expect(result.status).toBe(ConsentStatus.DENIED);
    });
  });

  describe('withdrawConsent', () => {
    it('should withdraw consent', async () => {
      mockPrisma.userConsent.findUnique.mockResolvedValue(mockConsent);
      mockPrisma.userConsent.update.mockResolvedValue({
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
      mockPrisma.userConsent.findUnique.mockResolvedValue(null);

      await expect(
        service.withdrawConsent(mockUserId, ConsentType.TERMS_OF_SERVICE),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('hasValidConsent', () => {
    it('should return true for valid granted consent', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(mockConsent);

      const result = await service.hasValidConsent(
        mockUserId,
        ConsentType.TERMS_OF_SERVICE,
      );

      expect(result).toBe(true);
    });

    it('should return false if consent not found', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(null);

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
      mockPrisma.userConsent.findFirst.mockResolvedValue(expiredConsent);

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

      mockPrisma.userConsent.upsert.mockResolvedValue({
        ...mockConsent,
        status: ConsentStatus.GRANTED,
      });

      const result = await service.bulkUpdateConsents(mockUserId, consents);

      expect(result).toHaveLength(2);
      expect(mockPrisma.userConsent.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('getRequiredConsentsStatus', () => {
    it('should return status of required consents', async () => {
      mockPrisma.userConsent.findFirst.mockResolvedValue(mockConsent);

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
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);
      mockPrisma.userAddress.findMany.mockResolvedValue([]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(0);
      expect(result.isComplete).toBe(false);
      expect(result.coreFieldsComplete.hasName).toBe(false);
      expect(result.coreFieldsComplete.hasPhoto).toBe(false);
      expect(result.coreFieldsComplete.hasTimezone).toBe(false);
      expect(result.coreFieldsComplete.hasAddress).toBe(false);
    });

    it('should return 25% for profile with name only', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: null,
        avatarUrl: null,
      });
      mockPrisma.userAddress.findMany.mockResolvedValue([]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(25);
      expect(result.coreFieldsComplete.hasName).toBe(true);
      expect(result.coreFieldsComplete.hasPhoto).toBe(false);
    });

    it('should return 100% for complete core profile', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: 'America/New_York',
        avatarUrl: 'https://example.com/avatar.jpg',
      });
      mockPrisma.userAddress.findMany.mockResolvedValue([mockAddress]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(100);
      expect(result.isComplete).toBe(true);
    });

    it('should add civic field bonus percentage', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: 'America/New_York',
        avatarUrl: 'https://example.com/avatar.jpg',
        politicalAffiliation: 'independent',
        votingFrequency: 'always',
      });
      mockPrisma.userAddress.findMany.mockResolvedValue([mockAddress]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(110); // 100% core + 10% civic (2 fields * 5%)
    });

    it('should add demographic field bonus percentage', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: 'America/New_York',
        avatarUrl: 'https://example.com/avatar.jpg',
        occupation: 'Engineer',
        educationLevel: 'bachelor',
      });
      mockPrisma.userAddress.findMany.mockResolvedValue([mockAddress]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(106); // 100% core + 6% demographic (2 fields * 3%)
    });

    it('should cap percentage at 130%', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue({
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
      mockPrisma.userAddress.findMany.mockResolvedValue([mockAddress]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.percentage).toBe(130); // Capped at 130%
    });

    it('should return suggested steps for incomplete profile', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);
      mockPrisma.userAddress.findMany.mockResolvedValue([]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.suggestedNextSteps.length).toBeGreaterThan(0);
      expect(result.suggestedNextSteps).toContain(
        'Add your name to personalize your profile',
      );
    });

    it('should suggest civic fields when core is complete', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: 'America/New_York',
        avatarUrl: 'https://example.com/avatar.jpg',
      });
      mockPrisma.userAddress.findMany.mockResolvedValue([mockAddress]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.suggestedNextSteps).toContain(
        'Share your political affiliation for personalized insights',
      );
    });

    it('should use displayName if firstName is not set', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        firstName: null,
        displayName: 'johndoe',
        timezone: null,
        avatarUrl: null,
      });
      mockPrisma.userAddress.findMany.mockResolvedValue([]);

      const result = await service.getProfileCompletion(mockUserId);

      expect(result.coreFieldsComplete.hasName).toBe(true);
    });

    it('should use avatarStorageKey if avatarUrl is not set', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        firstName: 'John',
        timezone: null,
        avatarUrl: null,
        avatarStorageKey: 'avatars/user-123/photo.jpg',
      });
      mockPrisma.userAddress.findMany.mockResolvedValue([]);

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

      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.userProfile.update.mockResolvedValue(updatedProfile);

      const result = await service.updateAvatarStorageKey(
        mockUserId,
        storageKey,
      );

      expect(result.avatarStorageKey).toBe(storageKey);
      expect(mockPrisma.userProfile.update).toHaveBeenCalled();
    });

    it('should create profile if not exists and update storage key', async () => {
      const storageKey = 'avatars/user-123/photo.jpg';
      const newProfile = {
        ...mockProfile,
        avatarStorageKey: storageKey,
      };

      mockPrisma.userProfile.findUnique.mockResolvedValue(null);
      mockPrisma.userProfile.create.mockResolvedValue({
        ...mockProfile,
        avatarStorageKey: null,
      });
      mockPrisma.userProfile.update.mockResolvedValue(newProfile);

      const result = await service.updateAvatarStorageKey(
        mockUserId,
        storageKey,
      );

      expect(result.avatarStorageKey).toBe(storageKey);
      expect(mockPrisma.userProfile.create).toHaveBeenCalled();
    });
  });
});
